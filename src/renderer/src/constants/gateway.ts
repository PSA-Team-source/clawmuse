/**
 * WebSocket timings for the gateway on this machine.
 *
 * There is no base URL here and no endpoint table: the only address this app
 * knows is `ws://127.0.0.1:<port>`, supplied by the main process from the
 * config it wrote itself. Nothing in the renderer can name a host.
 */

export const WS_HEARTBEAT_INTERVAL = 30_000
export const WS_RECONNECT_BASE_DELAY = 1000
export const WS_MAX_RECONNECT_DELAY = 30_000
export const WS_HANDSHAKE_TIMEOUT_MS = 8000
