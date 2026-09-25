import { BrowserWindow, app, nativeTheme } from 'electron'
import log from 'electron-log/main.js'
import { PROTOCOL, isDev } from './env.js'
import { registerIpcHandlers } from './ipc/register.js'
import { deepLinkFromArgv, handleDeepLink, registerProtocol } from './services/deeplink.js'
import { applyDevDockIcon } from './services/dock.js'
import { installApplicationMenu } from './services/menu.js'
import { registerShortcut, unregisterShortcuts } from './services/shortcuts.js'
import { createTray, destroyTray } from './services/tray.js'
import { startAssistant, stopAssistant } from './services/assistant.js'
import { stopSupervised } from './services/local-runtime/gateway-supervisor.js'
import { initUpdater } from './services/updater.js'
import { getAppPreferences } from './services/app-preferences.js'
import { watchWindowsForFloatingButton } from './windows/floating-button.js'
import { stopKeyMonitor, syncKeyMonitor } from './services/key-monitor.js'
import { createMainWindow, getMainWindows } from './windows/main-window.js'

/**
 * Must run at module scope, before anything touches `app.getPath()` and before
 * Chromium resolves its profile directory during startup — `whenReady` is
 * already too late. Called late, every dev run stores its userData under
 * ~/Library/Application Support/**Electron**, the shared bucket every other
 * unpackaged Electron app on the machine also writes to; sessions, cookies and
 * the `secure/` token store end up mixed in with them.
 *
 * This fixes `app.name` only. The menu bar, Dock tooltip and Force Quit read
 * the name from CFBundleName in the Info.plist of the bundle that is *running*,
 * which AppKit loads before any JavaScript executes — in dev that bundle is
 * node_modules/electron/dist/Electron.app. scripts/patch-dev-app-name.mjs
 * patches it there; packaged builds get it from `productName`.
 */
app.setName('ClawMuse')

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = isDev ? 'debug' : 'warn'

/**
 * Single-instance lock.
 *
 * A second launch (or a `clawmuse://` link opened while we are running) must
 * hand its arguments to the live process instead of starting a rival one —
 * two instances would open two gateway WebSockets for the same user.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = deepLinkFromArgv(argv)
    if (url) {
      handleDeepLink(url)
      return
    }
    const win = getMainWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    } else {
      createMainWindow()
    }
  })

  // macOS delivers deep links through this event, and it can fire before
  // `whenReady`, so it is registered at module scope.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  bootstrap()
}

function bootstrap(): void {
  // The mobile app is dark-only; keep native dialogs and scrollbars in step.
  nativeTheme.themeSource = 'dark'

  app.whenReady().then(() => {
    applyDevDockIcon()

    registerProtocol()
    registerIpcHandlers()
    installApplicationMenu()
    if (getAppPreferences().showMenuBar) createTray()

    syncKeyMonitor()
    const shortcutOk = registerShortcut()
    if (!shortcutOk) {
      log.warn('[main] Quick Chat shortcut could not be registered — another app may own it')
    }

    watchWindowsForFloatingButton()
    createMainWindow()
    initUpdater()
    startAssistant()

    // A cold launch triggered by a deep link carries the URL in argv.
    const initial = deepLinkFromArgv(process.argv)
    if (initial) handleDeepLink(initial)

    nativeTheme.on('updated', () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('system-theme-changed', nativeTheme.shouldUseDarkColors)
      }
    })

    app.on('activate', () => {
      // macOS: clicking the dock icon with no windows open should reopen one.
      if (getMainWindows().length === 0) createMainWindow()
    })
  })

  // An app with a tray/menu-bar presence stays alive with no windows — that is
  // the whole point of the tray + ⌥Space panel, and the built-in assistant
  // (Feed, check-ins) runs here. Windows keeps it in the notification area the
  // same way; only a platform with no tray quits with its last window.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') app.quit()
  })

  app.on('will-quit', () => {
    unregisterShortcuts()
    stopKeyMonitor()
    destroyTray()
    stopAssistant()
    // Windows runs the gateway as our child (no Scheduled Task); it goes with us.
    if (process.platform === 'win32') void stopSupervised()
  })

  app.on('web-contents-created', (_event, contents) => {
    // Defence in depth: even if a window forgets its own handler, no renderer
    // may attach a webview or navigate to an unexpected origin.
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

export { PROTOCOL }
