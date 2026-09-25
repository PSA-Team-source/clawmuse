import { hostname } from 'node:os'
import { basename } from 'node:path'
import { BrowserWindow, Notification, app, dialog, ipcMain, nativeTheme, shell, systemPreferences } from 'electron'
import log from 'electron-log/main.js'
import type {
  AppInfo,
  BotDraft,
  DeviceSignRequest,
  FsPathRequest,
  HandshakeFailureReport,
  McpServerDefinition,
  NotifyPayload,
  ProviderChoice,
  SecureKey,
  WindowKind,
} from '@shared/ipc'
import { PROTOCOL, isDev, resourcePath } from '../env.js'
import * as fsBridge from '../services/fs-bridge.js'
import { flushPendingDeepLink, handleDeepLink } from '../services/deeplink.js'
import { deviceFingerprint, signHandshake } from '../services/device-identity.js'
import * as runtime from '../services/local-runtime/index.js'
import { detectLocalProviders } from '../services/local-runtime/detect-providers.js'
import { readBrowserShot } from '../services/local-runtime/computer.js'
import { scanForCredentials } from '../services/local-runtime/key-scan.js'
import {
  createBot,
  deleteBot,
  duplicateBot,
  listBots,
  readGuidelines,
  seedRoster,
  updateBot,
} from '../services/local-runtime/bots.js'
import {
  listMcpServers,
  probeMcpServer,
  removeMcpServer,
  setMcpServer,
} from '../services/local-runtime/mcp.js'
import { checkNode } from '../services/local-runtime/node-check.js'
import { run } from '../services/local-runtime/exec.js'
import {
  isSecureStorageAvailable,
  secureDelete,
  secureGet,
  secureSet,
} from '../services/secure-store.js'
import { getShortcut, setShortcut } from '../services/shortcuts.js'
import { refreshTrayMenu, setMenuBarVisible, setTrayConnectionLabel } from '../services/tray.js'
import { getAppPreferences, isPushToTalkKey, setAppPreference } from '../services/app-preferences.js'
import { getKeyMonitorStatus, onKeyMonitorStatus, syncKeyMonitor } from '../services/key-monitor.js'
import { transcribeDictation } from '../services/local-runtime/dictation.js'
import { saveIssueReport } from '../services/issue-report.js'
import { removeClawMuse } from '../services/remove-app.js'
import { ASSISTANT_JOBS, type AssistantJob } from '@shared/assistant'
import { getAssistantState, hideIdea, importLegacy, markFeedUnit, runAssistantJob, setAssistantSettings, setFeedPrompt, stopAssistantJob, syncAssistantContext } from '../services/assistant.js'
import { copyShareCard, registerShareClip, renderShareCard, saveShareCard, shareCardViaSystem } from '../services/share-card.js'
import { exportAgentData } from '../services/local-runtime/data-export.js'
import { setAgentIdentity } from '../services/local-runtime/agent-identity.js'
import { connectWallet, disconnectWallet, walletCardFields, walletCards, walletConfig, walletStatus } from '../services/local-runtime/wallet.js'
import { approvePairingRequest, listPairingRequests } from '../services/local-runtime/channel-pairing.js'
import {
  deliverDroppedFiles,
  isFloatingButtonWindow,
  moveFloatingButton,
  openFromFloatingButton,
  readDroppedFiles,
  resizeFloatingButton,
  setFloatingIdentity,
  setRendererBusy,
  syncFloatingButton,
  takePendingDroppedFiles,
} from '../windows/floating-button.js'
import { checkForUpdates, getUpdateStatus, installUpdate } from '../services/updater.js'
import { openControlUi } from '../windows/control-ui.js'
import { createMainWindow, openSettingsWindow } from '../windows/main-window.js'
import { isQuickChatWindow, showQuickChat } from '../windows/quick-chat.js'
import { getAvatarLook, setAvatarLook } from '../services/avatar-look.js'

/** The window that sent the current IPC message, or null if it has gone away. */
function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/**
 * Only http(s) links may be handed to the OS. Without this check a compromised
 * renderer could pass `file://` or a custom scheme and make the main process
 * launch an arbitrary local handler.
 */
function isSafeExternalUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('app:login-item', () => ({
    supported: !isDev && (process.platform === 'darwin' || process.platform === 'win32'),
    enabled: !isDev && (process.platform === 'darwin' || process.platform === 'win32') ? app.getLoginItemSettings().openAtLogin : false,
  }))
  ipcMain.handle('app:set-login-item', (_event, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid login setting')
    if (isDev || (process.platform !== 'darwin' && process.platform !== 'win32')) throw new Error('Login items require an installed desktop app')
    app.setLoginItemSettings({ openAtLogin: enabled })
    return app.getLoginItemSettings().openAtLogin
  })
  // Settings > Dictation: the OS-level microphone grant, which Chromium's own
  // permission state does not reflect.
  ipcMain.handle('app:microphone-access', () =>
    process.platform === 'darwin' || process.platform === 'win32' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted')
  ipcMain.handle('app:open-microphone-settings', () => {
    if (process.platform === 'darwin') return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
    if (process.platform === 'win32') return shell.openExternal('ms-settings:privacy-microphone')
  })
  // Full Disk Access has no query API; the system TCC database is readable
  // exactly when it has been granted, which is the standard probe.
  ipcMain.handle('app:full-disk-access', async () => {
    if (process.platform !== 'darwin') return 'granted'
    const { access } = await import('node:fs/promises')
    return access('/Library/Application Support/com.apple.TCC/TCC.db').then(() => 'granted', () => 'denied')
  })
  ipcMain.handle('app:open-full-disk-access-settings', () =>
    process.platform === 'darwin' ? shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles') : undefined)
  ipcMain.handle('runtime:export-data', () => exportAgentData())
  ipcMain.handle('app:remove', () => removeClawMuse())
  ipcMain.handle('wallet:status', () => walletStatus())
  ipcMain.handle('wallet:config', () => walletConfig())
  ipcMain.handle('wallet:connect', (_e, token: unknown) => connectWallet(token))
  ipcMain.handle('wallet:disconnect', () => disconnectWallet())
  ipcMain.handle('wallet:cards', (_e, vault: unknown) => walletCards(vault))
  ipcMain.handle('wallet:card-fields', () => walletCardFields())
  ipcMain.handle('runtime:set-agent-identity', (_e, input: unknown) => setAgentIdentity(input))
  ipcMain.handle('runtime:pairing-list', (_e, channel: unknown) => listPairingRequests(channel))
  ipcMain.handle('runtime:pairing-approve', (_e, channel: unknown, code: unknown) => approvePairingRequest(channel, code))
  ipcMain.handle('app:save-issue-report', (_e, description: unknown) => saveIssueReport(description))
  // ── Built-in assistant ────────────────────────────────────────────────────
  const assistantJob = (job: unknown) => {
    if (!ASSISTANT_JOBS.includes(job as AssistantJob)) throw new Error('Unknown assistant job')
    return job as AssistantJob
  }
  ipcMain.handle('assistant:state', () => getAssistantState())
  // Not awaited: the run reports progress through `assistant-state`, and the
  // caller must not hang on a multi-minute edition.
  ipcMain.handle('assistant:run', (_e, job: unknown) => { void runAssistantJob(assistantJob(job), true) })
  ipcMain.handle('assistant:stop', (_e, job: unknown) => stopAssistantJob(assistantJob(job)))
  ipcMain.handle('assistant:settings', (_e, patch: unknown) => setAssistantSettings(patch))
  ipcMain.handle('assistant:feed-prompt', (_e, prompt: unknown) => setFeedPrompt(prompt))
  ipcMain.handle('assistant:feed-unit', (_e, id: unknown, action: unknown) => markFeedUnit(id, action))
  ipcMain.handle('assistant:hide-idea', (_e, id: unknown) => hideIdea(id))
  ipcMain.handle('assistant:import-legacy', (_e, legacy: unknown) => importLegacy(legacy))
  ipcMain.on('assistant:context', (_e, context: unknown) => syncAssistantContext(context))
  // ── Share cards ───────────────────────────────────────────────────────────
  // Input is validated in renderShareCard (parseShareCardInput); ids are opaque.
  ipcMain.handle('avatar:get', () => getAvatarLook())
  ipcMain.handle('avatar:set', (_e, look: unknown) => setAvatarLook(look))
  ipcMain.handle('share:render', (_e, input: unknown) => renderShareCard(input))
  ipcMain.handle('share:clip', (_e, input: unknown) => registerShareClip(input))
  ipcMain.handle('share:copy', (_e, id: unknown) => copyShareCard(id))
  ipcMain.handle('share:save', (event, id: unknown) => saveShareCard(senderWindow(event), id))
  ipcMain.handle('share:system', (event, id: unknown) => shareCardViaSystem(senderWindow(event), id))
  ipcMain.handle('app:preferences', () => getAppPreferences())
  ipcMain.handle('app:set-preference', (_event, key: unknown, value: unknown) => {
    if (key === 'pushToTalk') {
      if (!isPushToTalkKey(value)) throw new Error('Invalid preference')
      const next = setAppPreference('pushToTalk', value)
      syncKeyMonitor()
      return next
    }
    if ((key !== 'showMenuBar' && key !== 'showFloatingButton') || typeof value !== 'boolean') throw new Error('Invalid preference')
    const next = setAppPreference(key, value)
    if (key === 'showMenuBar') setMenuBarVisible(value)
    else syncFloatingButton()
    return next
  })
  ipcMain.handle('keymonitor:status', () => getKeyMonitorStatus())
  // macOS applies a new Accessibility grant only to a freshly started process.
  ipcMain.handle('keymonitor:recheck', () => { syncKeyMonitor(true); return getKeyMonitorStatus() })
  ipcMain.handle('app:open-accessibility-settings', () =>
    process.platform === 'darwin' ? shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility') : undefined)
  onKeyMonitorStatus((status) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send('keymonitor-status', status) })
  // The floating button's own page is the only caller allowed to drive it.
  const fromPill = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    isFloatingButtonWindow(BrowserWindow.fromWebContents(event.sender))
  ipcMain.on('floating:open', (event) => { if (fromPill(event)) openFromFloatingButton() })
  ipcMain.on('floating:move', (event, dx: number, dy: number) => { if (fromPill(event)) moveFloatingButton(dx, dy) })
  ipcMain.on('floating:identity', (_event, name: unknown, image: unknown) => setFloatingIdentity(name, image))
  ipcMain.on('floating:resize', (event, width: number) => { if (fromPill(event)) resizeFloatingButton(width) })
  ipcMain.on('floating:drop', (event, paths: unknown) => { if (fromPill(event)) deliverDroppedFiles(readDroppedFiles(paths)) })
  ipcMain.handle('floating:take-pending', () => takePendingDroppedFiles())
  ipcMain.on('renderer:busy', (event, busy: unknown) => setRendererBusy(event.sender.id, busy === true))
  ipcMain.handle('app:info', (): AppInfo => {
    const platform = process.platform
    return {
      version: app.getVersion(),
      platform: platform === 'darwin' || platform === 'win32' ? platform : 'linux',
      arch: process.arch,
      isDev,
      isDarkMode: nativeTheme.shouldUseDarkColors,
    }
  })

  ipcMain.handle('app:set-badge', (_e, count: number) => {
    // Dock badge for unread agent messages / pending approvals.
    app.setBadgeCount(Number.isFinite(count) && count > 0 ? Math.floor(count) : 0)
  })

  // ── Credentials ───────────────────────────────────────────────────────────
  ipcMain.handle('secure:available', () => isSecureStorageAvailable())
  ipcMain.handle('secure:get', (_e, key: SecureKey) => secureGet(key))
  ipcMain.handle('secure:set', (_e, { key, value }: { key: SecureKey; value: string }) =>
    secureSet(key, value),
  )
  ipcMain.handle('secure:delete', (_e, key: SecureKey) => secureDelete(key))

  // ── Windows ───────────────────────────────────────────────────────────────
  ipcMain.handle('window:open', async (_e, kind: WindowKind) => {
    if (kind === 'settings') {
      openSettingsWindow()
      return
    }
    if (kind === 'quick-chat') {
      showQuickChat()
      return
    }
    if (kind === 'control-ui') {
      const credentials = await runtime.credentials()
      if (credentials) openControlUi(credentials.port)
      return
    }
    createMainWindow()
  })

  ipcMain.handle('window:close-self', (event) => {
    const win = senderWindow(event)
    if (!win) return
    // The quick panel is a singleton we reuse; hiding keeps its React tree (and
    // therefore the gateway subscription) warm for the next ⌥Space.
    if (isQuickChatWindow(win)) win.hide()
    else win.close()
  })

  ipcMain.handle('window:minimize', (event) => senderWindow(event)?.minimize())

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = senderWindow(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('window:set-always-on-top', (event, flag: boolean) =>
    senderWindow(event)?.setAlwaysOnTop(flag),
  )

  // ── Shell ─────────────────────────────────────────────────────────────────
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (!isSafeExternalUrl(url)) {
      log.warn('[ipc] blocked non-http external URL:', url)
      return
    }
    await shell.openExternal(url)
  })

  // ── Notifications ─────────────────────────────────────────────────────────
  ipcMain.handle('notify:show', (_e, payload: NotifyPayload) => {
    if (!Notification.isSupported()) return

    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      silent: payload.silent ?? false,
      icon: resourcePath('icon.png'),
    })

    // Clicking routes the user straight to what the notification was about —
    // the pending approval, the finished task — instead of a generic window.
    notification.on('click', () => {
      handleDeepLink(`${PROTOCOL}://${payload.route ?? 'chat'}`)
    })

    notification.show()
  })

  // ── Updates ───────────────────────────────────────────────────────────────
  ipcMain.handle('updater:check', () => checkForUpdates(true))
  ipcMain.handle('updater:install', () => installUpdate())
  ipcMain.handle('updater:status', () => getUpdateStatus())

  // ── Global shortcut ───────────────────────────────────────────────────────
  ipcMain.handle('shortcut:get', () => getShortcut())
  ipcMain.handle('shortcut:set', (_e, accelerator: unknown) => {
    if (typeof accelerator !== 'string' || accelerator.length > 64) throw new Error('Invalid shortcut')
    const ok = setShortcut(accelerator)
    refreshTrayMenu()
    return ok
  })

  // ── Local runtime ─────────────────────────────────────────────────────────
  ipcMain.handle('runtime:status', () => runtime.getStatus())
  ipcMain.handle('runtime:ensure', () => runtime.ensure())
  ipcMain.handle('runtime:restart', () => runtime.restart())
  ipcMain.handle('runtime:stop', () => runtime.stop())
  ipcMain.handle('runtime:credentials', () => runtime.credentials())
  ipcMain.handle('runtime:logs', () => runtime.readLogs())
  ipcMain.handle('runtime:device-id', async () => {
    // Muse titles "This device" with the computer's own name.
    let name = hostname().replace(/\.local$/, '')
    if (process.platform === 'darwin') {
      const computer = await run('/usr/sbin/scutil', ['--get', 'ComputerName'], { timeoutMs: 3000 }).catch(() => null)
      if (computer?.code === 0 && computer.stdout.trim()) name = computer.stdout.trim()
    }
    return { deviceId: (await deviceFingerprint()).deviceId, name }
  })
  ipcMain.handle('runtime:resolution', () => runtime.getResolution())
  ipcMain.handle('runtime:bots-list', () => listBots())
  ipcMain.handle('runtime:bots-create', (_e, draft: BotDraft) => createBot(draft))
  ipcMain.handle('runtime:bots-update', (_e, input: { id: string; draft: BotDraft }) =>
    updateBot(input.id, input.draft),
  )
  ipcMain.handle('runtime:bots-duplicate', (_e, input: { id: string; name: string }) =>
    duplicateBot(input.id, input.name),
  )
  ipcMain.handle('runtime:bots-delete', (_e, id: string) => deleteBot(id))
  ipcMain.handle('runtime:bots-seed', () => seedRoster())
  ipcMain.handle('runtime:bots-guidelines', (_e, id: string) => readGuidelines(id))

  ipcMain.handle('runtime:read-shot', (_e, path: string) => readBrowserShot(path))
  ipcMain.handle('dictation:transcribe', (_e, wav: unknown, language: unknown) => transcribeDictation(wav, language))
  ipcMain.handle('runtime:mcp-list', () => listMcpServers())
  ipcMain.handle('runtime:mcp-set', (_e, input: { name: string; definition: McpServerDefinition }) =>
    setMcpServer(input.name, input.definition),
  )
  ipcMain.handle('runtime:mcp-remove', (_e, name: string) => removeMcpServer(name))
  ipcMain.handle('runtime:mcp-probe', (_e, name: string) => probeMcpServer(name))
  ipcMain.handle('runtime:node-check', () => checkNode())
  ipcMain.handle('runtime:detect-providers', () => detectLocalProviders())
  ipcMain.handle('runtime:scan-credentials', () => scanForCredentials())
  ipcMain.handle('runtime:apply-provider', (_e, choice: ProviderChoice) =>
    runtime.applyProvider(choice),
  )
  ipcMain.handle('runtime:provider-configured', () => runtime.isProviderConfigured())

  // Signs the gateway handshake. Without this the connection succeeds but comes
  // back with zero scopes, and every later RPC fails — see device-identity.ts.
  ipcMain.handle('runtime:device-sign', (_e, request: DeviceSignRequest) => signHandshake(request))

  // A renderer-side socket failure is invisible in `main.log` unless it is sent
  // here — which is how "closed before connect, code=1008 pairing-required"
  // went undiagnosed while the app showed a spinner and nothing else.
  ipcMain.handle('runtime:handshake-failed', (_e, failure: HandshakeFailureReport) =>
    runtime.reportHandshakeFailure(failure),
  )

  ipcMain.handle('runtime:open-logs', async () => {
    // `openPath` rather than `openExternal`: this is a local file, and the
    // external-URL guard deliberately rejects non-http schemes.
    //
    // Resolved, not hardcoded: the service log is stdout-only and stays empty
    // when the gateway dies on startup — exactly when someone clicks this.
    await shell.openPath(await runtime.resolveLogPath())
  })

  // ── Filesystem ────────────────────────────────────────────────────────────
  // Every handler takes { rootId, path }. There is deliberately no channel that
  // accepts an absolute path — see the note in fs-bridge.ts.
  ipcMain.handle('fs:roots', () => fsBridge.ensureDefaultRoots())

  ipcMain.handle('fs:add-root', async (event) => {
    const win = senderWindow(event)
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Open folder',
    })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    // A user-chosen id keeps roots stable across restarts without leaking the
    // absolute path into the renderer's routing.
    const id = `dir-${Buffer.from(picked).toString('base64url').slice(0, 16)}`
    return fsBridge.registerRoot(id, basename(picked) || picked, picked)
  })

  ipcMain.handle('fs:list', (_e, { rootId, path }: FsPathRequest) => fsBridge.list(rootId, path))
  ipcMain.handle('fs:read', (_e, { rootId, path }: FsPathRequest) => fsBridge.read(rootId, path))
  ipcMain.handle('fs:write', (_e, { rootId, path, content }: FsPathRequest & { content: string }) =>
    fsBridge.write(rootId, path, content),
  )
  ipcMain.handle('fs:mkdir', (_e, { rootId, path }: FsPathRequest) =>
    fsBridge.createDirectory(rootId, path),
  )
  ipcMain.handle('fs:delete', (_e, { rootId, path }: FsPathRequest) => fsBridge.remove(rootId, path))
  ipcMain.handle('fs:rename', (_e, { rootId, from, to }: { rootId: string; from: string; to: string }) =>
    fsBridge.move(rootId, from, to),
  )
  ipcMain.handle('fs:reveal', (_e, { rootId, path }: FsPathRequest) => fsBridge.reveal(rootId, path))

  // ── Renderer-driven side channels ─────────────────────────────────────────
  // Fire-and-forget: the renderer reports gateway state so the tray menu can
  // show it, and announces readiness so buffered deep links can be replayed.
  ipcMain.on('renderer:connection-state', (_e, label: string) => {
    if (typeof label === 'string') setTrayConnectionLabel(label)
  })

  ipcMain.on('renderer:ready', () => {
    flushPendingDeepLink()
    const status = getUpdateStatus()
    if (status.state !== 'idle') {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('update-status', status)
      }
    }
  })
}
