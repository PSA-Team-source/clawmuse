import { app } from 'electron'
import log from 'electron-log/main.js'
import { LEGACY_PROTOCOL, PROTOCOL, isDev } from '../env.js'
import { createMainWindow, focusedOrFirstWindow, getMainWindows } from '../windows/main-window.js'

/**
 * `clawmuse://` deep links.
 *
 * Two producers matter: the Facebook OAuth callback (the backend redirects to
 * the web app, which bounces to `clawmuse://oauth/facebook`) and links a user
 * clicks in the browser or in a notification.
 *
 * A link can arrive before any window exists, so URLs received early are
 * buffered and replayed once a renderer is listening.
 */

let pending: string | null = null

/**
 * The link as the renderer understands it: `clawmuse://…`. A `localfang://…`
 * link (the pre-rename scheme — still what the Facebook OAuth bounce sends) is
 * rewritten to the current scheme; anything else is not ours and returns null.
 */
export function normalizeDeepLink(url: string): string | null {
  if (url.startsWith(`${PROTOCOL}://`)) return url
  if (url.startsWith(`${LEGACY_PROTOCOL}://`)) return `${PROTOCOL}://${url.slice(LEGACY_PROTOCOL.length + 3)}`
  return null
}

export function registerProtocol(): void {
  if (isDev) {
    // In dev the executable is Electron itself, so the launcher needs the path
    // to our project or macOS registers the wrong bundle.
    for (const scheme of [PROTOCOL, LEGACY_PROTOCOL]) {
      app.setAsDefaultProtocolClient(scheme, process.execPath, [app.getAppPath()])
    }
  } else {
    for (const scheme of [PROTOCOL, LEGACY_PROTOCOL]) app.setAsDefaultProtocolClient(scheme)
  }
}

export function handleDeepLink(raw: string): void {
  const url = normalizeDeepLink(raw)
  if (!url) return
  log.info('[deeplink]', url)

  const win = focusedOrFirstWindow()
  if (!win) {
    pending = url
    createMainWindow()
    return
  }

  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('deeplink', url)
}

/** Called by the renderer once it has mounted its deep-link listener. */
export function flushPendingDeepLink(): void {
  if (!pending) return
  const url = pending
  pending = null
  for (const win of getMainWindows()) win.webContents.send('deeplink', url)
}

/** Pulls a `clawmuse://` URL out of argv (how Windows/Linux deliver links). */
export function deepLinkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    const url = normalizeDeepLink(arg)
    if (url) return url
  }
  return null
}
