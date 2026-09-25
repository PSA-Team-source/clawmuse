import {
  WS_HANDSHAKE_TIMEOUT_MS,
  WS_HEARTBEAT_INTERVAL,
  WS_MAX_RECONNECT_DELAY,
  WS_RECONNECT_BASE_DELAY,
} from '@/constants/gateway'
import { canonicalSessionKey } from '@/services/session-key'
import type { HandshakeFailureKind } from '@shared/ipc'
import type {
  Attachment,
  GatewayEventFrame,
  SessionPatch,
  ThinkingLevel,
} from '@/types'
import { gatewayEventFrameSchema, gatewayResponseFrameSchema } from '@/types'

/**
 * Singleton client for the OpenClaw gateway bridge.
 *
 * Wire protocol: newline-free JSON frames of three kinds — `req` (client→server,
 * carries an `id`), `res` (server→client, replies to that `id`) and `event`
 * (server→client push, no `id`). Ported from mobile
 * `src/services/gateway-ws.service.ts`; the timings, the handshake payload and
 * the reconnect curve are all load-bearing and must not drift.
 *
 * One connection per app, shared by every window in this renderer process.
 */

type GatewayEvents = {
  connected: []
  disconnected: [code: number, reason: string]
  error: [failure: GatewayFailure]
  event: [frame: GatewayEventFrame]
}

/**
 * A connection failure, classified.
 *
 * `error` used to carry a bare string, which meant the one failure the app can
 * actually do something about — a device waiting for pairing approval — was
 * indistinguishable from a network blip and got the same silent retry.
 */
export interface GatewayFailure {
  kind: HandshakeFailureKind
  message: string
  code?: number
  reason?: string
}

/** Machine-readable marker the gateway puts in `error.details` for a refused pairing. */
const PAIRING_DETAIL_CODE = 'PAIRING_REQUIRED'
/**
 * Fallback for the paths that carry no structured details: a 1008 close, whose
 * `reason` is the only thing the browser hands back.
 */
const PAIRING_TEXT = /pairing[ -]required|device is not approved/i

/** Carries the gateway's structured error through the promise rejection. */
class GatewayCallError extends Error {
  constructor(
    message: string,
    readonly detailCode?: string,
    readonly requestId?: string,
    /** `details.reason`, e.g. `QUESTION_ALREADY_TERMINAL`. */
    readonly detailReason?: string,
    /** The whole `error.details` record, for refusals that carry a payload (plugin capability consent). */
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'GatewayCallError'
  }
}

/** The gateway's machine-readable refusal reason (`error.details.reason`), when the call carried one. */
export function gatewayErrorReason(error: unknown): string | undefined {
  const reason = (error as { detailReason?: unknown } | null)?.detailReason
  return typeof reason === 'string' ? reason : undefined
}

/** The gateway's structured refusal (`error.details`), when the call carried one. */
export function gatewayErrorDetails(error: unknown): Record<string, unknown> | undefined {
  return error instanceof GatewayCallError ? error.details : undefined
}

function classify(error: unknown, closeCode?: number, closeReason?: string): GatewayFailure {
  const message = error instanceof Error ? error.message : String(error)
  const detailCode = error instanceof GatewayCallError ? error.detailCode : undefined
  const pairing =
    detailCode === PAIRING_DETAIL_CODE || PAIRING_TEXT.test(message) || PAIRING_TEXT.test(closeReason ?? '')
  return {
    kind: pairing ? 'pairing-required' : 'handshake',
    message,
    ...(closeCode !== undefined ? { code: closeCode } : {}),
    ...(closeReason ? { reason: closeReason } : {}),
  }
}

/** Minimal typed event emitter — avoids pulling in eventemitter3 for four events. */
class TypedEmitter<Events extends Record<string, unknown[]>> {
  // Handlers are erased to a common signature internally; the public methods
  // are what enforce the per-event argument types.
  private listeners = new Map<keyof Events, Set<(...args: unknown[]) => void>>()

  on<K extends keyof Events>(event: K, handler: (...args: Events[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler as unknown as (...args: unknown[]) => void)
    return () => this.off(event, handler)
  }

  off<K extends keyof Events>(event: K, handler: (...args: Events[K]) => void): void {
    this.listeners.get(event)?.delete(handler as unknown as (...args: unknown[]) => void)
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    // Copy before iterating: a handler may unsubscribe itself.
    for (const handler of [...(this.listeners.get(event) ?? [])]) {
      handler(...(args as unknown[]))
    }
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }
}

interface Deferred {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

/** Reported in the handshake and pinned into the device record by the gateway. */
const APP_VERSION = '1.0.0'

/** Matches mobile's id generator: short, unique enough, cheap. */
function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** Sets `obj.a.b.c = value`, creating intermediate objects as needed. */
function setDeep(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let node = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!
    const next = node[key]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  node[parts[parts.length - 1]!] = value
}

export interface EncodedAttachment {
  type: 'image' | 'file' | 'audio'
  name: string
  mimeType?: string
  /** base64, without a data: prefix — the gateway will not fetch URLs. */
  data: string
}

/**
 * There is one transport, and it is loopback.
 *
 * This used to be a union with a cloud arm carrying a base URL and a user JWT.
 * Removing it is not tidying: a type that cannot express a remote host is the
 * strongest possible statement that this app does not have one.
 */
type Transport = { port: number; gatewayToken: string }

/**
 * Client identity for the local handshake.
 *
 * `client.id` is a closed enum on the wire — `clawmuse` is rejected
 * outright. `webchat-ui` / mode `webchat` is accepted but triggers the browser
 * origin check, which a packaged renderer on `file://` (Origin: null) can never
 * pass. `openclaw-macos` + mode `ui` is the native-app slot: it skips the origin
 * check and qualifies for silent pairing on loopback. `displayName` is what
 * actually shows up in `openclaw devices list`.
 */
const LOCAL_CLIENT = {
  id: 'openclaw-macos',
  displayName: 'ClawMuse',
  mode: 'ui',
} as const

const OPERATOR_SCOPES = ['operator.read', 'operator.write', 'operator.admin'] as const

class GatewayWSService extends TypedEmitter<GatewayEvents> {
  private ws: WebSocket | null = null
  private token = ''
  private transport: Transport = { port: 0, gatewayToken: '' }

  private pending = new Map<string, Deferred>()
  private handshakeDone = false
  private isConnecting = false
  private shouldReconnect = false

  private reconnectDelay = WS_RECONNECT_BASE_DELAY
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private handshakeFallbackTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Set when the handshake itself failed, cleared on the next attempt.
   *
   * Exists so `onclose` can tell "the gateway refused us" from "the socket
   * dropped": the first must not be reported twice, and the second must be
   * reported at all when the refusal arrived only as a close code.
   */
  private handshakeFailure: GatewayFailure | null = null

  get isConnected(): boolean {
    // readyState alone is not enough: a socket can be OPEN while the protocol
    // handshake is still outstanding, during which no method call will succeed.
    return this.handshakeDone && this.ws?.readyState === WebSocket.OPEN
  }

  /** Connects straight to the gateway this machine runs — no bridge, no login. */
  connectLocal(port: number, gatewayToken: string): void {
    const changed = this.transport.port !== port || this.transport.gatewayToken !== gatewayToken
    this.transport = { port, gatewayToken }
    this.token = gatewayToken
    this.shouldReconnect = true
    // A restarted runtime has a new port or token: the open socket is stale.
    if (changed && this.ws && this.ws.readyState !== WebSocket.CLOSED) { this.reconnectNow(); return }
    // Already connected to this runtime: listeners attached since (a boot
    // retry, a fresh store) would otherwise wait forever for 'connected'.
    if (this.isConnected) { this.emit('connected'); return }
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) return
    this.open()
  }

  private url(): string {
    // The gateway serves WS at the root and wants its own token. 127.0.0.1 is
    // written literally rather than configured: there is no other host this
    // client is allowed to reach.
    return `ws://127.0.0.1:${this.transport.port}/?token=${encodeURIComponent(this.transport.gatewayToken)}`
  }

  private open(): void {
    this.isConnecting = true
    this.handshakeDone = false
    this.handshakeFailure = null

    try {
      this.ws = new WebSocket(this.url())
    } catch (error) {
      this.isConnecting = false
      this.emit('error', {
        kind: 'transport',
        message: error instanceof Error ? error.message : 'WebSocket failed to open',
      })
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      // Cloud only. Some bridge versions never send `connect.challenge`, so the
      // web client sends `connect` unprompted after a grace period. Local must
      // NOT do that: the device signature covers the challenge nonce, so
      // without a challenge there is nothing valid to sign — better to let the
      // handshake time out with a clear error than to send an unsigned frame
      // that connects with zero scopes.
      // Deliberately no fallback `connect`: the device signature covers the
      // challenge nonce, so without a challenge there is nothing valid to
      // sign. Timing out with a clear error beats connecting with zero scopes.
    }

    this.ws.onmessage = (message) => this.onMessage(message)

    this.ws.onerror = () => {
      // Deliberately not emitted as a failure: `onerror` fires with no detail
      // for ordinary drops, and `onclose` follows immediately with the code
      // that actually explains what happened.
    }

    this.ws.onclose = (event) => {
      this.isConnecting = false
      this.handshakeDone = false
      this.stopHeartbeat()
      this.clearHandshakeFallback()
      this.rejectAllPending()

      // A policy close (1008) is the gateway refusing this client, not a
      // dropped connection. If the refusal never reached `sendConnect` — an
      // unparseable frame, or a close with no `res` at all — this is the only
      // place it can still be reported, and before this the app swallowed it
      // entirely and span at "Connecting" forever.
      if (event.code === 1008 && !this.handshakeFailure) {
        const failure = classify(
          new Error(event.reason || 'The gateway refused this connection'),
          event.code,
          event.reason,
        )
        this.handshakeFailure = failure
        this.emit('error', failure)
      }

      this.emit('disconnected', event.code, event.reason)
      // 1000 means we closed it deliberately (sign-out, app quit).
      if (this.shouldReconnect && event.code !== 1000) this.scheduleReconnect()
    }
  }

  private onMessage(message: MessageEvent<unknown>): void {
    if (typeof message.data !== 'string') return

    let raw: unknown
    try {
      raw = JSON.parse(message.data)
    } catch {
      return
    }

    const asFrame = raw as { type?: unknown }

    if (asFrame.type === 'res') {
      const parsed = gatewayResponseFrameSchema.safeParse(raw)
      if (!parsed.success) return
      const frame = parsed.data
      const deferred = this.pending.get(frame.id)
      if (!deferred) return
      this.pending.delete(frame.id)

      if (frame.ok === false || frame.error) {
        deferred.reject(
          new GatewayCallError(
            frame.error?.message ?? 'Gateway request failed',
            frame.error?.details?.code,
            frame.error?.details?.requestId,
            typeof frame.error?.details?.reason === 'string' ? frame.error.details.reason : undefined,
            frame.error?.details,
          ),
        )
      } else {
        deferred.resolve(frame.payload ?? frame.result)
      }
      return
    }

    if (asFrame.type === 'event') {
      const parsed = gatewayEventFrameSchema.safeParse(raw)
      if (!parsed.success) return
      const frame = parsed.data

      if (frame.event === 'connect.challenge') {
        this.clearHandshakeFallback()
        const payload = frame.payload as { nonce?: unknown } | undefined
        const nonce = typeof payload?.nonce === 'string' ? payload.nonce : undefined
        void this.sendConnect(nonce)
        return
      }
      if (frame.event === 'pong') return

      this.emit('event', frame)
    }
  }

  private async buildConnectParams(nonce?: string): Promise<Record<string, unknown>> {
    if (!nonce) throw new Error('Gateway did not issue a connect challenge')

    // A local handshake without a signed device block still returns ok:true —
    // and then the gateway clears every scope, so the socket looks healthy while
    // sessions.list, chat.send and cron.list all fail on "missing scope". The
    // signature is produced in the main process; the private key never gets here.
    const { platform: devicePlatform, ...signedDevice } = await window.clawmuse.runtime.deviceSign({
      clientId: LOCAL_CLIENT.id,
      clientMode: LOCAL_CLIENT.mode,
      role: 'operator',
      scopes: [...OPERATOR_SCOPES],
      nonce,
      token: this.transport.gatewayToken,
    })

    return {
      minProtocol: 3,
      maxProtocol: 4,
      client: {
        id: LOCAL_CLIENT.id,
        displayName: LOCAL_CLIENT.displayName,
        version: APP_VERSION,
        // Must match the `platform` baked into the signature, or the gateway
        // rejects it ("device signature invalid") — so it is the value main
        // signed, not a constant (a hard-coded 'darwin' broke every Windows handshake).
        platform: devicePlatform,
        mode: LOCAL_CLIENT.mode,
      },
      role: 'operator',
      scopes: [...OPERATOR_SCOPES],
      auth: { token: this.transport.gatewayToken },
      device: signedDevice,
    }
  }

  private async sendConnect(nonce?: string): Promise<void> {
    this.clearHandshakeFallback()
    if (this.handshakeDone) return

    try {
      const params = await this.buildConnectParams(nonce)
      const reply = await withTimeout(
        this.call<{ auth?: { scopes?: string[] } }>('connect', params),
        WS_HANDSHAKE_TIMEOUT_MS,
        'Gateway handshake',
      )

      // Fail loudly on a scope-less session instead of letting it surface three
      // layers later as an unexplained "missing scope: operator.read".
      if ((reply?.auth?.scopes?.length ?? 0) === 0) {
        throw new Error('Gateway rejected this device — no permissions were granted')
      }
    } catch (error) {
      const failure = classify(error)
      this.handshakeFailure = failure
      this.emit('error', failure)
      // Close rather than sit in a half-open state forever; `onclose` will
      // schedule the retry.
      this.ws?.close()
      return
    }

    this.handshakeDone = true
    this.isConnecting = false
    this.reconnectDelay = WS_RECONNECT_BASE_DELAY
    this.startHeartbeat()
    this.emit('connected')
  }

  private clearHandshakeFallback(): void {
    if (this.handshakeFallbackTimer) {
      clearTimeout(this.handshakeFallbackTimer)
      this.handshakeFallbackTimer = null
    }
  }

  /**
   * Reconnects at once, cancelling any pending backoff.
   *
   * For the case where something has actually changed since the last attempt —
   * a pending device request approved, say. Waiting out an exponential backoff
   * there is time spent on a problem that has already been fixed.
   */
  reconnectNow(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectDelay = WS_RECONNECT_BASE_DELAY
    this.shouldReconnect = true

    const stale = this.ws
    if (stale && stale.readyState !== WebSocket.CLOSED) {
      // Detached first: this socket's `onclose` must not schedule a second
      // attempt on top of the one starting here.
      stale.onopen = null
      stale.onmessage = null
      stale.onerror = null
      stale.onclose = null
      stale.close(1000, 'Reconnecting')
    }
    this.ws = null
    this.open()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = this.reconnectDelay
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldReconnect) this.open()
    }, delay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, WS_MAX_RECONNECT_DELAY)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // `health`, not `ping`: this used to send `ping`, which the gateway
        // does not implement — so every 30 seconds it answered
        // `unknown method: ping` and wrote an error line to the log. The
        // socket stayed up (any traffic keeps it warm), so the only symptom
        // was a log full of failures on a perfectly healthy connection.
        //
        // Sent raw rather than through `call()`: nothing needs the reply, and
        // a pending promise per beat would leak.
        this.ws.send(JSON.stringify({ type: 'req', id: uid(), method: 'health' }))
      }
    }, WS_HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private rejectAllPending(): void {
    for (const deferred of this.pending.values()) {
      deferred.reject(new Error('WebSocket disconnected'))
    }
    this.pending.clear()
  }

  /** Issues a `req` frame and resolves with its `res` payload. */
  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Gateway not connected'))
        return
      }
      const id = uid()
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.stopHeartbeat()
    this.clearHandshakeFallback()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.rejectAllPending()
    this.ws?.close(1000, 'User disconnected')
    this.ws = null
    this.handshakeDone = false
    this.isConnecting = false
  }

  // ── Sessions & chat ───────────────────────────────────────────────────────

  getSessions(): Promise<unknown> {
    return this.call('sessions.list', { includeLastMessage: true, limit: 100 })
  }

  /** Only the archived sessions — `sessions.list` leaves them out unless asked. */
  getArchivedSessions(): Promise<unknown> {
    return this.call('sessions.list', { archived: true, includeLastMessage: true, limit: 100 })
  }

  /**
   * OpenClaw's full-text transcript search (`sessions.search`): ranked user and
   * assistant messages with the stable message id, capped at 25 per call.
   * Scoped by explicit keys (at most 200) — the gateway takes no agent filter
   * on its own.
   */
  searchSessions(query: string, sessionKeys: string[]): Promise<unknown> {
    return this.call('sessions.search', { query, limit: 25, sessionKeys: sessionKeys.slice(0, 200) })
  }

  /** One session's live record — carries `lastRunError`, the real reason a turn failed. */
  describeSession(sessionKey: string): Promise<unknown> {
    return this.call('sessions.describe', { key: canonicalSessionKey(sessionKey) })
  }

  getSessionHistory(sessionKey: string): Promise<unknown> {
    return this.call('chat.history', { sessionKey: canonicalSessionKey(sessionKey) })
  }

  sendMessage(sessionKey: string, message: string, attachments?: EncodedAttachment[]): Promise<unknown> {
    return this.call('chat.send', {
      sessionKey: canonicalSessionKey(sessionKey),
      message,
      // Lets the gateway drop a duplicate if a reconnect replays the send.
      idempotencyKey: uid(),
      ...(attachments?.length ? { attachments } : {}),
    })
  }

  /**
   * Not implemented against the current gateway.
   *
   * `chat.inject` existed on the 2026.5.x bridge but is absent from the method
   * list a 2026.7 gateway advertises, so calling it fails at runtime rather
   * than at build time. Nothing in the app uses it today; kept as an explicit
   * gap so the next person does not wire it up and find out the hard way.
   */
  injectMessage(): Promise<never> {
    return Promise.reject(new Error('chat.inject is not supported by this gateway'))
  }

  abort(sessionKey: string): Promise<unknown> {
    return this.call('chat.abort', { sessionKey: canonicalSessionKey(sessionKey) })
  }

  resetSession(key: string): Promise<unknown> {
    return this.call('sessions.reset', { key: canonicalSessionKey(key) })
  }

  deleteSession(key: string): Promise<unknown> {
    return this.call('sessions.delete', { key: canonicalSessionKey(key) })
  }

  patchSession(key: string, patch: SessionPatch): Promise<unknown> {
    // The gateway's rename field is `label`; its schema is closed, so a `name`
    // sent as-is failed every rename with "unexpected property".
    const { name, ...rest } = patch
    // "Auto" (`model: 'default'`) goes out as `null`, the only value that clears
    // a pin: the string 'default' is resolved as a model name and pinned the
    // session to a nonexistent `<provider>/default`.
    return this.call('sessions.patch', { key: canonicalSessionKey(key), ...rest, ...(name === undefined ? {} : { label: name }), ...(rest.model === 'default' ? { model: null } : {}) })
  }

  /**
   * Proxies one request to the browser control API through the gateway.
   *
   * The alternative is the loopback HTTP server, which is opt-in
   * (`OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1`) and needs a second port and a
   * second set of credentials. This rides the socket that is already open and
   * already authenticated — the same path `openclaw browser` itself takes.
   *
   * Requires `operator.admin`, which is the scope this client connects with.
   */
  browserRequest(request: {
    method: 'GET' | 'POST' | 'DELETE'
    path: string
    query?: Record<string, string>
    body?: unknown
    timeoutMs?: number
  }): Promise<unknown> {
    return this.call('browser.request', request)
  }

  // ── Models & config ───────────────────────────────────────────────────────

  listModels(): Promise<unknown> {
    return this.call('models.list')
  }

  getConfig(): Promise<{ config?: Record<string, unknown>; sourceConfig?: Record<string, unknown>; hash?: string }> {
    return this.call('config.get')
  }

  /**
   * `config.patch` does not take a path/value pair — it replaces the whole
   * document. So: read the config, mutate a clone of `sourceConfig` (the raw
   * user document, not the resolved one, whose defaults can fail validation on
   * the way back in), and send it with the hash we based it on.
   */
  async setConfig(path: string, value: unknown): Promise<unknown> {
    const current = await this.getConfig()
    const base = structuredClone(current.sourceConfig ?? current.config ?? {})
    setDeep(base, path, value)
    return this.call('config.patch', {
      raw: JSON.stringify(base),
      baseHash: current.hash ?? '',
      restartDelayMs: 500,
    })
  }

  /**
   * Model selection lives at `agents.defaults.model.primary`.
   *
   * Not `agent.model` — that was the older bridge's flattened shape. Writing it
   * against a current gateway does not error: `config.patch` accepts the
   * document, the key is simply unknown, so the model never changes and the
   * next validation run reports the config as invalid.
   */
  setModel(model: string): Promise<unknown> {
    return this.setConfig('agents.defaults.model.primary', model)
  }

  setThinkingLevel(level: ThinkingLevel): Promise<unknown> {
    return this.setConfig('agents.defaults.thinkingDefault', level)
  }

  // ── Channels ──────────────────────────────────────────────────────────────

  getChannelStatus(): Promise<unknown> {
    return this.call('channels.status')
  }

  channelLogout(channel: string, accountId?: string): Promise<unknown> {
    return this.call('channels.logout', { channel, ...(accountId ? { accountId } : {}) })
  }

  // ── QR / web login (WhatsApp pairing) ─────────────────────────────────────

  /**
   * Starts the gateway's own QR login flow for the current QR-capable channel.
   *
   * This is the only way to pair WhatsApp without a ClawMuse server: the CLI
   * prints the QR to its log, but `web.login.start` returns it over RPC so the
   * app can render it.
   *
   * `timeoutMs` is the gateway's own deadline, carried in the params. This
   * client has no separate call timeout — a pending request is settled by the
   * reply or by the socket dropping — which suits a flow whose whole point is
   * to wait for a human to pick up their phone.
   */
  webLoginStart(force = false, timeoutMs = 30_000): Promise<unknown> {
    return this.call('web.login.start', { force, timeoutMs })
  }

  /** Resolves once the pairing completes; the gateway then starts the channel. */
  webLoginWait(timeoutMs = 120_000): Promise<unknown> {
    return this.call('web.login.wait', { timeoutMs })
  }

  // ── Skills ────────────────────────────────────────────────────────────────

  getSkillsStatus(): Promise<unknown> {
    return this.call('skills.status')
  }

  /**
   * `skills.update` writes `skills.entries.<key>.enabled` itself. Not
   * `config.patch`: that replaces the whole document and schedules a gateway
   * restart, while the `skills` prefix needs no reload at all — the next
   * `skills.status` already reads the new value.
   */
  setSkillEnabled(skillKey: string, enabled: boolean): Promise<unknown> {
    return this.call('skills.update', { skillKey, enabled })
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  /**
   * The gateway's agents, and which one is the default.
   *
   * Needed because an *agent* id and a *skill* id are different things:
   * `webchat:skill:create-store` is a conversation with a skill, but the files
   * behind it belong to the agent running it (`main` on a local profile).
   * Passing the skill id to `agents.files.*` gets `unknown agent id`.
   */
  agentsList(): Promise<{ defaultId?: string; agents?: { id: string; name?: string }[] }> {
    return this.call('agents.list')
  }

  // ── Agent files (SOUL.md / IDENTITY.md / SKILL.md) ─────────────────────────

  agentFilesGet(agentId: string, name: string): Promise<{ file?: { content?: string } }> {
    return this.call('agents.files.get', { agentId, name })
  }

  agentFilesSet(agentId: string, name: string, content: string): Promise<unknown> {
    return this.call('agents.files.set', { agentId, name, content })
  }

  // ── Cron ──────────────────────────────────────────────────────────────────

  cronList(includeDisabled = true): Promise<unknown> {
    return this.call('cron.list', { includeDisabled })
  }

  /**
   * `cron.add` takes the whole job, not three loose fields.
   *
   * The omitted parts matter: without an explicit `sessionTarget` the gateway
   * files the job against `main`, and `main` only accepts `systemEvent`
   * payloads — an `agentTurn` sent that way is rejected. Callers build the
   * full job so the target and the payload kind always agree.
   */
  cronAdd(job: Record<string, unknown>): Promise<unknown> {
    return this.call('cron.add', job)
  }

  cronUpdate(jobId: string, patch: Record<string, unknown>): Promise<unknown> {
    return this.call('cron.update', { jobId, patch })
  }

  cronRemove(id: string): Promise<unknown> {
    return this.call('cron.remove', { id })
  }

  cronRun(id: string): Promise<unknown> {
    return this.call('cron.run', { id })
  }

  /** Per-run history for one job — the only place a failure reason is recorded. */
  cronRuns(id: string): Promise<unknown> {
    return this.call('cron.runs', { id })
  }

  // ── Usage ─────────────────────────────────────────────────────────────────

  /** Token and cost totals from the gateway's own session logs. */
  usageCost(days = 30): Promise<unknown> {
    return this.call('usage.cost', { days })
  }

}

export const gatewayWS = new GatewayWSService()

/** Test seam — the classification is the whole reason a pairing failure is recoverable. */
export const __testing = { classify, GatewayCallError }

/** Reads a browser File into the base64 payload shape the gateway expects. */
export async function encodeAttachment(attachment: Attachment, file?: File): Promise<EncodedAttachment | null> {
  const defaultMime =
    attachment.type === 'image' ? 'image/jpeg' : attachment.type === 'audio' ? 'audio/m4a' : 'application/octet-stream'

  if (attachment.data) {
    return {
      type: attachment.type,
      name: attachment.name ?? 'attachment',
      mimeType: attachment.mimeType ?? defaultMime,
      data: attachment.data,
    }
  }

  if (!file) return null

  try {
    const buffer = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    // Chunked to avoid blowing the argument limit of String.fromCharCode on
    // multi-megabyte images.
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return {
      type: attachment.type,
      name: attachment.name ?? file.name,
      mimeType: attachment.mimeType ?? file.type ?? defaultMime,
      data: btoa(binary),
    }
  } catch {
    // Mirrors mobile: a bad attachment must not block the message itself.
    return null
  }
}
