import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppInfo,
  AppPreferences,
  KeyMonitorStatus,
  DictationResult,
  DroppedFile,
  BotDraft,
  BotMutation,
  BotSummary,
  CredentialFinding,
  DetectedLocalProvider,
  DeviceSignRequest,
  DeviceSignature,
  FsEntry,
  FsReadResult,
  FsRoot,
  HandshakeFailureOutcome,
  HandshakeFailureReport,
  IpcEventMap,
  LocalRuntimeCredentials,
  LocalRuntimeStatus,
  McpMutation,
  McpProbe,
  McpServerDefinition,
  McpServerSummary,
  MenuCommand,
  NodeCheck,
  NotifyPayload,
  OpenclawResolution,
  ProviderChoice,
  RuntimeLogs,
  SecureKey,
  UpdateStatus,
  WindowKind,
} from '@shared/ipc'
import type { AssistantContext, AssistantJob, AssistantSettings, AssistantState } from '@shared/assistant'
import type { ShareCardAction, ShareCardInput, ShareCardRender, ShareClipInput, ShareClipResult } from '@shared/share-card'

/**
 * The only surface the renderer gets onto the main process.
 *
 * Every listener wrapper deliberately drops the `IpcRendererEvent` argument:
 * handing that object to renderer code would leak `event.sender`, i.e. a live
 * `ipcRenderer` handle, defeating context isolation.
 */

type Unsubscribe = () => void

function on<K extends keyof IpcEventMap>(
  channel: K,
  callback: (payload: IpcEventMap[K]) => void,
): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: IpcEventMap[K]): void =>
    callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
    setBadge: (count: number): Promise<void> => ipcRenderer.invoke('app:set-badge', count),
    loginItem: (): Promise<{ supported: boolean; enabled: boolean }> => ipcRenderer.invoke('app:login-item'),
    setLoginItem: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('app:set-login-item', enabled),
    preferences: (): Promise<AppPreferences> => ipcRenderer.invoke('app:preferences'),
    /** OS microphone permission: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'. */
    microphoneAccess: (): Promise<string> => ipcRenderer.invoke('app:microphone-access'),
    openMicrophoneSettings: (): Promise<void> => ipcRenderer.invoke('app:open-microphone-settings'),
    fullDiskAccess: (): Promise<'granted' | 'denied'> => ipcRenderer.invoke('app:full-disk-access'),
    openAccessibilitySettings: (): Promise<void> => ipcRenderer.invoke('app:open-accessibility-settings'),
    keyMonitorStatus: (): Promise<KeyMonitorStatus> => ipcRenderer.invoke('keymonitor:status'),
    recheckKeyMonitor: (): Promise<KeyMonitorStatus> => ipcRenderer.invoke('keymonitor:recheck'),
    onKeyMonitorStatus: (cb: (status: KeyMonitorStatus) => void): Unsubscribe => on('keymonitor-status', cb),
    openFullDiskAccessSettings: (): Promise<void> => ipcRenderer.invoke('app:open-full-disk-access-settings'),
    /** Writes the description plus diagnostics to Downloads and reveals it. */
    saveIssueReport: (description: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('app:save-issue-report', description),
    setPreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]): Promise<AppPreferences> =>
      ipcRenderer.invoke('app:set-preference', key, value),
    /** Whether any reply is generating in this window — drives the floating button's "Thinking". */
    reportBusy: (busy: boolean): void => ipcRenderer.send('renderer:busy', busy),
    /** Tells main the renderer has mounted its listeners. */
    ready: (): void => ipcRenderer.send('renderer:ready'),
  },

  /** OS keychain-backed token storage. Never falls back to plaintext. */
  secure: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('secure:available'),
    get: (key: SecureKey): Promise<string | null> => ipcRenderer.invoke('secure:get', key),
    set: (key: SecureKey, value: string): Promise<void> =>
      ipcRenderer.invoke('secure:set', { key, value }),
    delete: (key: SecureKey): Promise<void> => ipcRenderer.invoke('secure:delete', key),
  },

  window: {
    open: (kind: WindowKind): Promise<void> => ipcRenderer.invoke('window:open', kind),
    closeSelf: (): Promise<void> => ipcRenderer.invoke('window:close-self'),
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggle-maximize'),
    setAlwaysOnTop: (flag: boolean): Promise<void> =>
      ipcRenderer.invoke('window:set-always-on-top', flag),
  },

  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  },

  notifications: {
    show: (payload: NotifyPayload): Promise<void> => ipcRenderer.invoke('notify:show', payload),
  },

  updater: {
    check: (): Promise<void> => ipcRenderer.invoke('updater:check'),
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    onStatus: (cb: (status: UpdateStatus) => void): Unsubscribe => on('update-status', cb),
  },

  /** Speech to text through OpenClaw's audio.transcribe; `wav` is 16 kHz mono PCM16. */
  dictation: {
    transcribe: (wav: Uint8Array, language?: string): Promise<DictationResult> =>
      ipcRenderer.invoke('dictation:transcribe', wav, language),
  },

  /** Settings > Wallet: 1Password CLI + service account behind OpenClaw's onepassword broker. */
  wallet: {
    status: (): Promise<{ opPath: string | null; connected: boolean; vaults: { id: string; name: string }[]; error?: string }> => ipcRenderer.invoke('wallet:status'),
    connect: (token: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('wallet:connect', token),
    disconnect: (): Promise<void> => ipcRenderer.invoke('wallet:disconnect'),
    config: (): Promise<unknown> => ipcRenderer.invoke('wallet:config'),
    cards: (vault: string): Promise<{ id: string; title: string }[]> => ipcRenderer.invoke('wallet:cards', vault),
    cardFields: (): Promise<{ key: string; label: string }[]> => ipcRenderer.invoke('wallet:card-fields'),
  },

  shortcut: {
    get: (): Promise<string> => ipcRenderer.invoke('shortcut:get'),
    set: (accelerator: string): Promise<boolean> => ipcRenderer.invoke('shortcut:set', accelerator),
  },

  /**
   * The local OpenClaw gateway this app manages.
   *
   * `deviceSign` is the security-critical one: the renderer hands over a
   * challenge nonce and gets back a signature. The Ed25519 private key stays in
   * the main process and has no channel that could return it.
   */
  runtime: {
    status: (): Promise<LocalRuntimeStatus> => ipcRenderer.invoke('runtime:status'),
    ensure: (): Promise<LocalRuntimeStatus> => ipcRenderer.invoke('runtime:ensure'),
    restart: (): Promise<LocalRuntimeStatus> => ipcRenderer.invoke('runtime:restart'),
    stop: (): Promise<void> => ipcRenderer.invoke('runtime:stop'),
    credentials: (): Promise<LocalRuntimeCredentials | null> =>
      ipcRenderer.invoke('runtime:credentials'),
    deviceSign: (request: DeviceSignRequest): Promise<DeviceSignature> =>
      ipcRenderer.invoke('runtime:device-sign', request),
    /** Logs a socket failure into `main.log`, and repairs it when it is repairable. */
    handshakeFailed: (failure: HandshakeFailureReport): Promise<HandshakeFailureOutcome> =>
      ipcRenderer.invoke('runtime:handshake-failed', failure),
    logs: (): Promise<RuntimeLogs> => ipcRenderer.invoke('runtime:logs'),
    /** Pending DM pairing requests for a messaging channel (telegram | discord). */
    pairingList: (channel: string): Promise<{ id: string; code: string; createdAt?: string; name?: string }[]> =>
      ipcRenderer.invoke('runtime:pairing-list', channel),
    pairingApprove: (channel: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('runtime:pairing-approve', channel, code),
    /** Agent name and/or avatar (square PNG, base64) via `openclaw agents set-identity`. */
    setAgentIdentity: (input: { name?: string; pngBase64?: string }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('runtime:set-agent-identity', input),
    /** OpenClaw backup of config, credentials, sessions and workspaces into Downloads. */
    exportData: (): Promise<{ ok: true; path: string } | { ok: false; error: string }> => ipcRenderer.invoke('runtime:export-data'),
    /** Stops the agent service, deletes everything ClawMuse stored, moves the app to the Trash and quits. */
    removeApp: (): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('app:remove'),
    /** This install's gateway device id (public, derived from its key). */
    deviceId: (): Promise<{ deviceId: string; name: string }> => ipcRenderer.invoke('runtime:device-id'),
    openLogs: (): Promise<void> => ipcRenderer.invoke('runtime:open-logs'),
    resolution: (): Promise<OpenclawResolution | null> => ipcRenderer.invoke('runtime:resolution'),
    botsList: (): Promise<BotSummary[]> => ipcRenderer.invoke('runtime:bots-list'),
    botsCreate: (draft: BotDraft): Promise<BotMutation> =>
      ipcRenderer.invoke('runtime:bots-create', draft),
    botsUpdate: (id: string, draft: BotDraft): Promise<BotMutation> =>
      ipcRenderer.invoke('runtime:bots-update', { id, draft }),
    botsDuplicate: (id: string, name: string): Promise<BotMutation> =>
      ipcRenderer.invoke('runtime:bots-duplicate', { id, name }),
    botsDelete: (id: string): Promise<BotMutation> => ipcRenderer.invoke('runtime:bots-delete', id),
    botsSeed: (): Promise<BotSummary[]> => ipcRenderer.invoke('runtime:bots-seed'),
    botsGuidelines: (id: string): Promise<string> =>
      ipcRenderer.invoke('runtime:bots-guidelines', id),
    readShot: (path: string): Promise<string | null> =>
      ipcRenderer.invoke('runtime:read-shot', path),
    mcpList: (): Promise<McpServerSummary[]> => ipcRenderer.invoke('runtime:mcp-list'),
    mcpSet: (name: string, definition: McpServerDefinition): Promise<McpMutation> =>
      ipcRenderer.invoke('runtime:mcp-set', { name, definition }),
    mcpRemove: (name: string): Promise<McpMutation> => ipcRenderer.invoke('runtime:mcp-remove', name),
    mcpProbe: (name: string): Promise<McpProbe> => ipcRenderer.invoke('runtime:mcp-probe', name),
    nodeCheck: (): Promise<NodeCheck> => ipcRenderer.invoke('runtime:node-check'),
    detectProviders: (): Promise<DetectedLocalProvider[]> =>
      ipcRenderer.invoke('runtime:detect-providers'),
    scanCredentials: (): Promise<CredentialFinding[]> =>
      ipcRenderer.invoke('runtime:scan-credentials'),
    applyProvider: (choice: ProviderChoice): Promise<void> =>
      ipcRenderer.invoke('runtime:apply-provider', choice),
    providerConfigured: (): Promise<boolean> => ipcRenderer.invoke('runtime:provider-configured'),
    onStatus: (cb: (status: LocalRuntimeStatus) => void): Unsubscribe => on('runtime-status', cb),
  },

  /**
   * Workspace files.
   *
   * Note every method takes a `rootId`: the renderer addresses files relative
   * to a folder the user opened, and cannot name a path outside it.
   */
  fs: {
    roots: (): Promise<FsRoot[]> => ipcRenderer.invoke('fs:roots'),
    addRoot: (): Promise<FsRoot | null> => ipcRenderer.invoke('fs:add-root'),
    list: (rootId: string, path: string): Promise<FsEntry[]> =>
      ipcRenderer.invoke('fs:list', { rootId, path }),
    read: (rootId: string, path: string): Promise<FsReadResult> =>
      ipcRenderer.invoke('fs:read', { rootId, path }),
    write: (rootId: string, path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('fs:write', { rootId, path, content }),
    mkdir: (rootId: string, path: string): Promise<void> =>
      ipcRenderer.invoke('fs:mkdir', { rootId, path }),
    delete: (rootId: string, path: string): Promise<void> =>
      ipcRenderer.invoke('fs:delete', { rootId, path }),
    rename: (rootId: string, from: string, to: string): Promise<void> =>
      ipcRenderer.invoke('fs:rename', { rootId, from, to }),
    reveal: (rootId: string, path: string): Promise<void> =>
      ipcRenderer.invoke('fs:reveal', { rootId, path }),
  },

  /** Reported so the tray menu can show live gateway state. */
  reportConnectionState: (label: string): void =>
    ipcRenderer.send('renderer:connection-state', label),

  /** Used only by the floating button's own page; main ignores other senders. */
  floating: {
    open: (): void => ipcRenderer.send('floating:open'),
    moveBy: (dx: number, dy: number): void => ipcRenderer.send('floating:move', dx, dy),
    resize: (width: number): void => ipcRenderer.send('floating:resize', width),
    /** Any window: the agent's name and avatar image for the pill. */
    setIdentity: (name: string | null, image: string | null): void => ipcRenderer.send('floating:identity', name, image),
    onIdentity: (cb: (identity: { name: string; image: string }) => void): Unsubscribe => {
      const listener = (_event: Electron.IpcRendererEvent, identity: { name: string; image: string }): void => cb(identity)
      ipcRenderer.on('floating-identity', listener)
      return () => ipcRenderer.removeListener('floating-identity', listener)
    },
    drop: (files: File[]): void =>
      ipcRenderer.send('floating:drop', files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
    onBusy: (cb: (busy: boolean) => void): Unsubscribe => {
      const listener = (_event: Electron.IpcRendererEvent, busy: boolean): void => cb(busy)
      ipcRenderer.on('floating-busy', listener)
      return () => ipcRenderer.removeListener('floating-busy', listener)
    },
  },

  onAttachFiles: (cb: (files: DroppedFile[]) => void): Unsubscribe => on('attach-files', cb),
  takeDroppedFiles: (): Promise<DroppedFile[]> => ipcRenderer.invoke('floating:take-pending'),
  /** Feed, Ideas and check-ins — app functions run by main, never chats. */
  assistant: {
    state: (): Promise<AssistantState> => ipcRenderer.invoke('assistant:state'),
    run: (job: AssistantJob): Promise<void> => ipcRenderer.invoke('assistant:run', job),
    stop: (job: AssistantJob): Promise<void> => ipcRenderer.invoke('assistant:stop', job),
    setSettings: (patch: Partial<AssistantSettings>): Promise<AssistantState> => ipcRenderer.invoke('assistant:settings', patch),
    setFeedPrompt: (prompt: string): Promise<AssistantState> => ipcRenderer.invoke('assistant:feed-prompt', prompt),
    markFeedUnit: (id: string, action: 'like' | 'unlike' | 'hide'): Promise<AssistantState> => ipcRenderer.invoke('assistant:feed-unit', id, action),
    hideIdea: (id: string): Promise<AssistantState> => ipcRenderer.invoke('assistant:hide-idea', id),
    importLegacy: (legacy: unknown): Promise<AssistantState> => ipcRenderer.invoke('assistant:import-legacy', legacy),
    /** What main needs for background runs; goals and chats live in the renderer. */
    syncContext: (context: AssistantContext): void => ipcRenderer.send('assistant:context', context),
    onState: (cb: (state: AssistantState) => void): Unsubscribe => on('assistant-state', cb),
  },
  /** ClawMuse's avatar look (style, accessory, colours) — also changed by the assistant. */
  avatar: {
    get: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('avatar:get'),
    set: (look: Record<string, unknown>): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('avatar:set', look),
    onChange: (cb: (look: Record<string, unknown> | null) => void): Unsubscribe => on('avatar-look', cb),
  },
  /** Share cards: a PNG drawn on this computer, then copied, saved or shared by the user. */
  share: {
    render: (input: ShareCardInput): Promise<ShareCardRender> => ipcRenderer.invoke('share:render', input),
    clip: (input: ShareClipInput): Promise<ShareClipResult> => ipcRenderer.invoke('share:clip', input),
    copy: (id: string): Promise<ShareCardAction> => ipcRenderer.invoke('share:copy', id),
    save: (id: string): Promise<ShareCardAction> => ipcRenderer.invoke('share:save', id),
    system: (id: string): Promise<ShareCardAction> => ipcRenderer.invoke('share:system', id),
  },
  onDeepLink: (cb: (url: string) => void): Unsubscribe => on('deeplink', cb),
  onMenuCommand: (cb: (command: MenuCommand) => void): Unsubscribe => on('menu-command', cb),
  onSystemThemeChanged: (cb: (isDark: boolean) => void): Unsubscribe =>
    on('system-theme-changed', cb),
} as const

export type ClawMuseBridge = typeof api

contextBridge.exposeInMainWorld('clawmuse', api)
