import { session } from 'electron'
import log from 'electron-log/main.js'

/**
 * Removes the `Origin` header from the app's own WebSocket to the local gateway.
 *
 * The gateway decides how much to trust a connection from a single question:
 * *did this request carry an `Origin` header?* (`hasBrowserOriginHeader` in
 * `gateway/server/ws-connection/handshake-auth-helpers.ts`). Answering "yes"
 * puts the connection on the browser path, and that path has two consequences:
 *
 *   1. it runs `checkBrowserOrigin`, which a packaged renderer on `file://`
 *      cannot pass — Chromium sends `Origin: null`, which matches no allowlist
 *      entry and is not a loopback host (`CONTROL_UI_ORIGIN_NOT_ALLOWED`); and
 *   2. `shouldAllowSilentLocalPairing` returns **false** for any client that is
 *      not the Control UI or a webchat page — which is exactly what
 *      `openclaw-macos` / mode `ui` is not.
 *
 * An earlier version of this file rewrote the header to the gateway's own
 * origin. That fixed (1) and caused (2): every fresh install passed auth,
 * reached `phase=auth_validated`, and was then closed with
 * `1008 pairing required: device is not approved yet`. The device sat in
 * `~/.openclaw-clawmuse/devices/pending.json` waiting for an approval no surface in the
 * app could give, and onboarding span at "Connecting" forever.
 *
 * Deleting the header answers "no" to both questions at once: the origin check
 * is skipped for native-app clients, and `direct_local` + `isNativeAppUi` makes
 * the gateway silently pair us — first connect *and* after an app version bump,
 * which is the `metadata-upgrade` branch of the same function.
 *
 * Scope is deliberately narrow — only `ws://127.0.0.1:<port>` for the port this
 * app manages, and only on `defaultSession`. The gateway's own Control UI runs
 * in its own partition (`windows/control-ui.ts`) precisely so this never
 * reaches it: that page *is* a browser client and needs its real origin to pass
 * the check this bypasses.
 */

let registeredPort: number | null = null

/**
 * Returns the headers with any `Origin` removed.
 *
 * Header names are case-insensitive on the wire and Chromium's casing has
 * changed between versions, so this matches on the lowercased name — a literal
 * `delete headers.Origin` is a bug waiting for an Electron upgrade.
 */
export function withoutOriginHeader(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers }
  for (const name of Object.keys(next)) {
    if (name.toLowerCase() === 'origin') delete next[name]
  }
  return next
}

export function installGatewayOriginStrip(port: number): void {
  if (registeredPort === port) return
  registeredPort = port

  const filter = { urls: [`ws://127.0.0.1:${port}/*`, `ws://localhost:${port}/*`] }

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    callback({ requestHeaders: withoutOriginHeader(details.requestHeaders) })
  })

  log.info(`[ws-origin] Origin stripped for ws://127.0.0.1:${port} — native-app handshake`)
}

/** Test seam — lets a suite re-register against a different port. */
export function resetGatewayOriginStrip(): void {
  registeredPort = null
}
