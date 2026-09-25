import { BrowserWindow, shell } from 'electron'
import log from 'electron-log/main.js'

/**
 * The gateway's own Control UI, in a separate window.
 *
 * ClawMuse's native screens cover the day-to-day surface; this is the escape
 * hatch for everything the gateway can do that the app has not modelled —
 * raw config, node/device pairing, activity streams.
 *
 * A separate `BrowserWindow` rather than an iframe or a `<webview>`, for three
 * reasons: the renderer's CSP would have to be widened to frame an http origin,
 * `webviewTag` is off and `will-attach-webview` is blocked app-wide, and this
 * page is third-party code relative to ours — it has no business sharing a
 * process with a window that holds the preload bridge. So: no preload,
 * `sandbox: true`, and nothing from `window.clawmuse` is reachable from it.
 *
 * It also runs in its own session partition, and that is load-bearing rather
 * than tidiness: `services/ws-origin.ts` strips the `Origin` header from every
 * gateway WebSocket on `defaultSession`, because the app's native handshake
 * must not look like a browser's. This page is the opposite case — it is a
 * genuine browser client, the gateway runs `checkBrowserOrigin` on it, and an
 * absent origin fails that check outright ("origin missing or invalid"). A
 * separate partition keeps the two policies from ever meeting.
 */

/**
 * Persistent so the Control UI keeps its own session across app restarts; it
 * shares nothing with the app renderer's storage.
 */
const CONTROL_UI_PARTITION = 'persist:openclaw-control-ui'

let controlWindow: BrowserWindow | null = null

export function openControlUi(port: number): void {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.focus()
    return
  }

  controlWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'OpenClaw Control UI',
    backgroundColor: '#050810',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: CONTROL_UI_PARTITION,
      // Deliberately no preload: this page must not see the IPC bridge.
    },
  })

  const url = `http://127.0.0.1:${port}/`
  void controlWindow.loadURL(url)

  // Keep it pinned to the local gateway. Anything else opens in the real
  // browser rather than inside a window the user will read as part of the app.
  controlWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault()
      void shell.openExternal(target)
    }
  })
  controlWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })

  controlWindow.on('closed', () => {
    controlWindow = null
  })

  log.info(`[control-ui] opened ${url}`)
}
