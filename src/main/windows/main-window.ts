import { BrowserWindow, shell } from 'electron'
import { PRELOAD_PATH, isDev, rendererEntry, resourcePath } from '../env.js'

/** Every non-quick-chat window, so menu/deeplink commands can broadcast. */
const windows = new Set<BrowserWindow>()
let settingsWindow: BrowserWindow | null = null

/** Reuse one compact settings window without replacing the current conversation. */
export function openSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }
  settingsWindow = createMainWindow(true)
  settingsWindow.on('closed', () => { settingsWindow = null })
  return settingsWindow
}

export function getMainWindows(): BrowserWindow[] {
  return [...windows].filter((w) => !w.isDestroyed())
}

/** The window a command should target: focused first, else the most recent. */
export function focusedOrFirstWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? getMainWindows().at(-1) ?? null
}

export function createMainWindow(settings = false): BrowserWindow {
  const win = new BrowserWindow({
    width: settings ? 800 : 1440,
    height: settings ? 620 : 900,
    minWidth: settings ? 700 : 960,
    minHeight: settings ? 520 : 640,
    title: settings ? 'Settings' : 'ClawMuse',
    show: false,
    // Match the renderer's initial light surface while the first frame loads.
    backgroundColor: '#fcfcfc',
    // macOS-native chrome: traffic lights float over our own header bar, which
    // is how the design system's glass surfaces are meant to read. Windows
    // keeps its standard title bar (nothing can collide with our header's
    // right-hand controls) and shows the menu only when Alt is pressed.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 6, y: 6 }, vibrancy: 'under-window' as const, visualEffectState: 'active' as const }
      : { autoHideMenuBar: true, icon: resourcePath('icon.png') }),
    webPreferences: {
      preload: PRELOAD_PATH,
      // Hard requirements — the renderer runs remote-influenced content
      // (markdown, agent output) and must never reach Node directly.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs `node:` builtins for the IPC bridge
      webviewTag: false,
      spellcheck: true,
    },
  })

  windows.add(win)
  win.on('closed', () => windows.delete(win))
  if (settings) win.on('page-title-updated', (event) => event.preventDefault())

  // Avoid the white flash: paint only once the renderer has content.
  win.once('ready-to-show', () => win.show())

  // Anything that isn't our own app opens in the user's real browser —
  // Stripe checkout, Facebook OAuth, PlatformDTC, docs.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-place navigation away from the app shell; a stray link must not
  // turn our privileged renderer into a browser tab.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererEntry.origin)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  void loadRenderer(win, settings ? '/settings' : undefined)
  if (isDev && !settings) win.webContents.openDevTools({ mode: 'detach' })

  return win
}

export async function loadRenderer(win: BrowserWindow, hashRoute?: string): Promise<void> {
  if (rendererEntry.devServerUrl) {
    await win.loadURL(rendererEntry.devServerUrl + (hashRoute ? `#${hashRoute}` : ''))
  } else {
    await win.loadFile(rendererEntry.file, hashRoute ? { hash: hashRoute } : undefined)
  }
}
