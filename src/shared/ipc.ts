/**
 * IPC contract shared by the main process, the preload bridge and the renderer.
 *
 * Every channel is declared once here so a rename breaks typecheck on both
 * sides instead of failing silently at runtime. Main uses `ipcMain.handle` for
 * everything in `IpcInvokeMap`, and `webContents.send` for `IpcEventMap`.
 */

import type { AssistantJob, AssistantSettings, AssistantState } from './assistant'

/** Keys allowed in the OS-encrypted credential store. Deliberately closed: the
 *  renderer must not be able to make the main process write arbitrary files. */
/**
 * Keychain slots.
 *
 * `refresh_token` is a historical misnomer — it holds the sandbox record, whose
 * embedded `gateway_token` is why it must be encrypted. The actual refresh
 * token lives in `session_refresh`; renaming the old slot would strand every
 * existing install's sandbox, so the new name went to the new value instead.
 */
export const SECURE_KEYS = ['access_token', 'refresh_token', 'session_refresh'] as const

/**
 * The model a provider gets when nobody has picked one.
 *
 * Shared rather than duplicated: the automatic path (a key found on this Mac)
 * and the manual path (the provider picker) have to agree, or the same key
 * produces two different models depending on which screen the user came
 * through.
 */
export const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: 'anthropic/claude-opus-4-8',
  openai: 'openai/gpt-5.5',
  // Free by default: ClawMuse is free, and a key with no credits (common for a
  // new OpenRouter account) fails every message on a paid model. Same free
  // model FangBot runs; paid ones are one pick away in the model menu.
  openrouter: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
  zai: 'zai/glm-5.2',
  // Zen's $0 catalogue model. OpenCode refuses its free tier outside OpenCode
  // (403 FreeTierError), so a key is only adopted if this model answers — see
  // KEY_CHECKS in adopt-host.ts.
  opencode: 'opencode/big-pickle',
}
export type SecureKey = (typeof SECURE_KEYS)[number]

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; bytesPerSecond: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

/** Settings > General > App behavior, persisted by the main process. */
export interface AppPreferences {
  /** Tray icon in the macOS menu bar. */
  showMenuBar: boolean
  /** Floating pill shown while no ClawMuse window is open. */
  showFloatingButton: boolean
  /** Hold this key anywhere to dictate into the frontmost app (Muse's push to talk). */
  pushToTalk: PushToTalkKey
}

export type PushToTalkKey = 'off' | 'fn' | 'option' | 'control'

/** State of the native key monitor behind push to talk and "Tap Option twice". */
export interface KeyMonitorStatus {
  /** False on platforms/OS versions without the helper. */
  available: boolean
  running: boolean
  /** macOS Accessibility grant; global key events arrive only when true. */
  trusted: boolean | null
}

/** Result of transcribing one dictation recording. */
export type DictationResult = { ok: true; text: string } | { ok: false; error: string }

/** A file dropped on the floating button, read by main and handed to a chat. */
export interface DroppedFile {
  name: string
  type: string
  data: Uint8Array
}

export interface AppInfo {
  version: string
  /** `process.platform`, narrowed here so the renderer tsconfig needs no @types/node. */
  platform: 'darwin' | 'win32' | 'linux'
  arch: string
  isDev: boolean
  /** macOS accent/appearance so the renderer can match system chrome. */
  isDarkMode: boolean
}

export interface NotifyPayload {
  title: string
  body: string
  /** Routed back through `deeplink` when the user clicks the notification. */
  route?: string
  silent?: boolean
}

/** Window kinds the renderer can ask the main process to open. */
export type WindowKind = 'main' | 'quick-chat' | 'control-ui' | 'settings'

// ── Connectors (MCP) ────────────────────────────────────────────────────────

/**
 * A model credential found on this Mac, ready to use as-is.
 *
 * `source` is shown to the user verbatim — "~/.claude/settings.json", "your
 * shell environment" — because "we found a key" without saying where is a
 * request to trust the app with a credential it will not name.
 */
export interface CredentialFinding {
  provider: ProviderChoice
  /** Display name of the provider, e.g. `Anthropic`. */
  label: string
  /** Where it was found, in the user's own terms. */
  source: string
  /** `false` for a local server that needs no credential at all. */
  needsKey: boolean
}

/**
 * One bot in the roster — an OpenClaw agent, as the sidebar shows it.
 *
 * `id` is the addressable half: sessions are keyed `agent:<id>:<conversation>`,
 * so it is fixed at creation and a rename never touches it.
 */
export interface BotSummary {
  id: string
  name: string
  /** The one-line job, stored as `identity.theme`. */
  job: string
  emoji: string | null
  /** Workspace-relative path, `http(s)` URL, or `data:` URI. */
  avatar: string | null
  /** The built-in `main` bot, which cannot be deleted. */
  isDefault: boolean
  /** The bot's *private* workspace, not the shared computer. */
  workspace: string | null
  model: string | null
  permissions: BotPermissions
}

/**
 * How much of the machine a bot may touch.
 *
 * Prose guidelines are advisory — a model can talk itself past them. This is
 * the half that is not: it becomes a tool deny-list on the agent, enforced by
 * the gateway before the tool is ever offered.
 */
export type BotPermissions = 'read-only' | 'full'

/** The three fields the New Bot sheet asks for, plus an optional emoji. */
export interface BotDraft {
  name: string
  job: string
  guidelines: string
  emoji?: string
  /** Defaults to `full`, which is what an unrestricted teammate is. */
  permissions?: BotPermissions
}

/** `bot` is null for mutations that do not produce one, such as delete. */
export type BotMutation = { ok: true; bot: BotSummary | null } | { ok: false; error: string }

export interface McpServerSummary {
  name: string
  enabled: boolean
  /** `false` when the entry exists but the runtime could not make sense of it. */
  configured: boolean
  /** Whether a probe reached it. `null` when nothing has probed it yet. */
  ok: boolean | null
  transport: string | null
  /** Human-readable launch line, e.g. `stdio uvx context7-mcp`. */
  launch: string | null
  auth: string | null
}

/** The two shapes OpenClaw documents: a command to spawn, or a URL to reach. */
export type McpServerDefinition =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { url: string; transport?: 'streamable-http' | 'sse'; auth?: 'oauth' }

export type McpMutation = { ok: true } | { ok: false; error: string }

/** Facebook Ads, run from this machine through the bundled MCP server. */
export interface FacebookConnection {
  connected: boolean
  adAccountId: string | null
  adAccountName: string | null
}
export type McpProbe = { ok: true; tools: string[] } | { ok: false; error: string }

// ── Local runtime ───────────────────────────────────────────────────────────

/** Ordered stages of `runtime:ensure`, mirrored by the onboarding progress list. */
export type LocalRuntimeStep =
  | 'idle'
  | 'checking-node'
  | 'checking-cli'
  | 'installing-cli'
  | 'writing-config'
  | 'installing-service'
  | 'starting'
  | 'health'
  | 'ready'

export type LocalRuntimeStatus =
  | { state: 'idle' }
  | { state: 'starting'; step: LocalRuntimeStep; detail?: string }
  | {
      state: 'ready'
      port: number
      wsUrl: string
      cliVersion: string
      /** True when we joined a gateway that was already running on this port. */
      attached: boolean
    }
  | {
      state: 'error'
      step: LocalRuntimeStep
      message: string
      /** Actionable next step shown under the error, e.g. "Install Node 24". */
      hint?: string
      /** False ⇒ retrying without user action will fail the same way. */
      recoverable: boolean
    }

/** How the `openclaw` binary was found — surfaced in Settings for diagnosis. */
export type OpenclawSource = 'env-override' | 'managed' | 'path'

export interface OpenclawResolution {
  bin: string
  version: string
  source: OpenclawSource
}

export interface NodeCheck {
  ok: boolean
  version: string
  /** Set when the version works but is outside OpenClaw's supported matrix. */
  warning?: string
}

/** Credentials the renderer needs to open its own WebSocket to the local gateway. */
export interface LocalRuntimeCredentials {
  port: number
  token: string
  wsUrl: string
}

/**
 * A signed device identity for one `connect` handshake.
 *
 * The private key never leaves the main process: the renderer sends the
 * challenge nonce, main returns only the signature. Without this the gateway
 * accepts the connection but clears every scope, so all later RPCs fail.
 */
export interface DeviceSignature {
  id: string
  publicKey: string
  signature: string
  signedAt: number
  nonce: string
  /** The platform baked into the signature; the connect frame must send exactly this as `client.platform`. */
  platform: string
}

export interface DeviceSignRequest {
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  nonce: string
  token: string
}

/**
 * Why a gateway handshake failed, as far as the renderer can tell.
 *
 * `pairing-required` is the one the main process can act on: the gateway raised
 * a device pairing request and closed the socket, and approving that request is
 * something this machine is allowed to do for its own device.
 */
export type HandshakeFailureKind = 'pairing-required' | 'handshake' | 'transport'

export interface HandshakeFailureReport {
  kind: HandshakeFailureKind
  message: string
  /** WebSocket close code, when the socket got that far. */
  code?: number
  reason?: string
}

export interface HandshakeFailureOutcome {
  /** True ⇒ the cause was removed and an immediate retry is worth making. */
  repaired: boolean
  /** Shown to the user when the failure stands. */
  detail?: string
}

export interface ProviderChoice {
  /** Provider id as OpenClaw knows it: `anthropic`, `openai`, `ollama`, … */
  id: string
  apiKey?: string
  /**
   * Run the model through a local CLI instead of an API key. `claude-cli` =
   * the Claude Code login already on this Mac (see claude-cli.ts).
   */
  runtime?: 'claude-cli'
  baseUrl?: string
  /** Model ref to set as `agent.model`, e.g. `ollama/qwen3:0.6b`. */
  model: string
  /**
   * Bare model ids to declare under the provider.
   *
   * Local servers need this: OpenClaw does not enumerate an Ollama or LM Studio
   * catalogue on its own, so without an explicit list `models.list` comes back
   * empty and the model picker looks broken.
   */
  models?: string[]
  /**
   * Marks the declared models as reasoning models.
   *
   * Load-bearing for GLM: OpenClaw only sends `enable_thinking` when the model
   * declares reasoning (`openai-completions.ts`, `thinkingFormat === 'zai'`).
   * Without it the thinking is not separated from the reply and the user reads
   * the chain of thought as the answer.
   */
  reasoning?: boolean
  contextWindow?: number
  maxTokens?: number
}

export interface DetectedLocalProvider {
  id: 'ollama' | 'lmstudio'
  baseUrl: string
  models: string[]
}

export interface RuntimeLogs {
  path: string
  lines: string[]
}

// ── Filesystem ──────────────────────────────────────────────────────────────

/**
 * A folder the user has opened.
 *
 * Every `fs:*` call names a root and a path *relative* to it. No channel takes
 * an absolute path, which is what makes traversal out of the workspace
 * impossible by construction rather than by validation.
 */
export interface FsRoot {
  id: string
  label: string
  path: string
}

export interface FsEntry {
  name: string
  /** Relative to the root — never absolute. */
  path: string
  isDirectory: boolean
  size?: number
  modifiedMs?: number
}

export interface FsReadResult {
  path: string
  content: string
  size: number
  /** Set when the file is over the read limit; `content` is empty. */
  tooLarge?: boolean
  /** Set when a NUL byte was found; `content` is empty. */
  binary?: boolean
  /** Safe inline preview for supported media inside an explicitly opened root. */
  dataUrl?: string
  mimeType?: string
}

export interface FsPathRequest {
  rootId: string
  path: string
}

export interface IpcInvokeMap {
  'app:info': { req: void; res: AppInfo }
  'app:set-badge': { req: number; res: void }
  'app:login-item': { req: void; res: { supported: boolean; enabled: boolean } }
  'app:set-login-item': { req: boolean; res: boolean }

  'secure:get': { req: SecureKey; res: string | null }
  'secure:set': { req: { key: SecureKey; value: string }; res: void }
  'secure:delete': { req: SecureKey; res: void }
  /** True when the OS keychain is usable; false ⇒ renderer must degrade. */
  'secure:available': { req: void; res: boolean }

  'window:open': { req: WindowKind; res: void }
  'window:close-self': { req: void; res: void }
  'window:minimize': { req: void; res: void }
  'window:toggle-maximize': { req: void; res: void }
  'window:set-always-on-top': { req: boolean; res: void }

  'shell:open-external': { req: string; res: void }

  // ── Google sign-in (loopback OAuth + PKCE, main process only) ─────────────
  /** False when no Desktop OAuth client is configured; the button stays hidden. */
  /** Resolves with a Google `id_token`, or null if the user abandoned the flow. */

  'notify:show': { req: NotifyPayload; res: void }

  // ── Built-in assistant (Feed, Ideas, check-ins) ───────────────────────────
  'assistant:state': { req: void; res: AssistantState }
  'assistant:run': { req: AssistantJob; res: void }
  'assistant:stop': { req: AssistantJob; res: void }
  'assistant:settings': { req: Partial<AssistantSettings>; res: AssistantState }
  'assistant:feed-prompt': { req: string; res: AssistantState }
  'assistant:feed-unit': { req: [id: string, action: 'like' | 'unlike' | 'hide']; res: AssistantState }
  'assistant:hide-idea': { req: string; res: AssistantState }
  'assistant:import-legacy': { req: unknown; res: AssistantState }

  'updater:check': { req: void; res: void }
  'updater:install': { req: void; res: void }

  'shortcut:get': { req: void; res: string }
  'shortcut:set': { req: string; res: boolean }

  // ── Local runtime ─────────────────────────────────────────────────────────
  /**
   * The persisted Offline/Online choice. `null` means the user has never been
   * asked, which is what routes first launch to the mode picker — deliberately
   * distinct from a stored `'local'`.
   */
  'runtime:status': { req: void; res: LocalRuntimeStatus }
  /** Idempotent: attaches to a running gateway, or installs and starts one. */
  'runtime:ensure': { req: void; res: LocalRuntimeStatus }
  'runtime:restart': { req: void; res: LocalRuntimeStatus }
  /** Explicit user action only — quitting the app leaves the agent running. */
  'runtime:stop': { req: void; res: void }
  'runtime:credentials': { req: void; res: LocalRuntimeCredentials | null }
  /** Signs one handshake. The private key never crosses this boundary. */
  'runtime:device-sign': { req: DeviceSignRequest; res: DeviceSignature }
  /**
   * Reports a failed gateway handshake so it lands in `main.log`, and lets main
   * repair the one failure a machine can fix for itself — its own device
   * waiting for pairing approval.
   */
  'runtime:handshake-failed': { req: HandshakeFailureReport; res: HandshakeFailureOutcome }
  'runtime:logs': { req: void; res: RuntimeLogs }
  'runtime:open-logs': { req: void; res: void }
  'runtime:resolution': { req: void; res: OpenclawResolution | null }
  /**
   * Connectors — the MCP servers this machine hosts.
   *
   * The registry belongs to OpenClaw, not to this app: it spawns the servers,
   * handles OAuth, and reloads a live gateway. These channels drive its CLI
   * rather than editing `openclaw.json`, so there is only ever one editor.
   */
  // ── Bots ──────────────────────────────────────────────────────────────────
  'runtime:bots-list': { req: void; res: BotSummary[] }
  'runtime:bots-create': { req: BotDraft; res: BotMutation }
  'runtime:bots-update': { req: { id: string; draft: BotDraft }; res: BotMutation }
  'runtime:bots-duplicate': { req: { id: string; name: string }; res: BotMutation }
  'runtime:bots-delete': { req: string; res: BotMutation }
  /** Creates the starting roster; a no-op once any bot beyond `main` exists. */
  'runtime:bots-seed': { req: void; res: BotSummary[] }
  /** A bot's own words from its `AGENTS.md`, for the Edit profile sheet. */
  'runtime:bots-guidelines': { req: string; res: string }

  /** A browser screenshot from inside the profile, as a `data:` URL. */
  'runtime:read-shot': { req: string; res: string | null }

  'runtime:mcp-list': { req: void; res: McpServerSummary[] }
  'runtime:mcp-set': { req: { name: string; definition: McpServerDefinition }; res: McpMutation }
  'runtime:mcp-remove': { req: string; res: McpMutation }
  /** Opens a live connection — the only way to learn a command is missing from PATH. */
  'runtime:mcp-probe': { req: string; res: McpProbe }

  'runtime:node-check': { req: void; res: NodeCheck }
  'runtime:detect-providers': { req: void; res: DetectedLocalProvider[] }
  /** Model credentials this Mac already has, best first. Reads only. */
  'runtime:scan-credentials': { req: void; res: CredentialFinding[] }
  'runtime:apply-provider': { req: ProviderChoice; res: void }
  /** False until BYOK onboarding has produced a usable model provider. */
  'runtime:provider-configured': { req: void; res: boolean }

  // ── Filesystem (root-scoped; see FsRoot) ──────────────────────────────────
  'fs:roots': { req: void; res: FsRoot[] }
  /** Opens a native folder picker and registers the result as a new root. */
  'fs:add-root': { req: void; res: FsRoot | null }
  'fs:list': { req: FsPathRequest; res: FsEntry[] }
  'fs:read': { req: FsPathRequest; res: FsReadResult }
  'fs:write': { req: FsPathRequest & { content: string }; res: void }
  'fs:mkdir': { req: FsPathRequest; res: void }
  'fs:delete': { req: FsPathRequest; res: void }
  'fs:rename': { req: { rootId: string; from: string; to: string }; res: void }
  'fs:reveal': { req: FsPathRequest; res: void }
}

export interface IpcEventMap {
  /** `clawmuse://…` opened from a browser, or a notification click. */
  deeplink: string
  'update-status': UpdateStatus
  /** Main asks the focused renderer to run a menu command (⌘N, ⌘K, …). */
  'menu-command': MenuCommand
  'system-theme-changed': boolean
  /** Progress of `runtime:ensure`, so onboarding shows real steps not a spinner. */
  'runtime-status': LocalRuntimeStatus
  'keymonitor-status': KeyMonitorStatus
  /** Files dropped on the floating button — start a new chat with them attached. */
  'attach-files': DroppedFile[]
  /** The built-in assistant's state changed (a run started, finished, or a setting moved). */
  'assistant-state': AssistantState
}

export type MenuCommand =
  | 'new-chat'
  | 'new-window'
  | 'focus-composer'
  | 'toggle-room'
  | 'open-settings'
  | 'open-tasks'
  | 'abort-stream'

export type IpcInvokeChannel = keyof IpcInvokeMap
export type IpcEventChannel = keyof IpcEventMap
