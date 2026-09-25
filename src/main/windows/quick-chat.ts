import { BrowserWindow, screen, shell } from 'electron'
import { PRELOAD_PATH, isDev, rendererEntry } from '../env.js'
import { loadRenderer } from './main-window.js'

/**
 * The ⌥Space panel: a frameless, always-on-top window pinned near the top of
 * the active display. It renders the same React app at the `#/quick` route,
 * so it shares the WebSocket store and streaming state with the main window's
 * process — no second gateway connection.
 */

let quickWin: BrowserWindow | null = null

const WIDTH = 720
const HEIGHT = 480

function positionOnActiveDisplay(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    // Slightly above centre reads as a launcher rather than a dialog.
    y: Math.round(workArea.y + workArea.height * 0.18),
    width: WIDTH,
    height: HEIGHT,
  })
}

function create(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    // NSPanel: floats over full-screen apps without making ClawMuse a UIElement.
    type: 'panel',
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'hud',
    visualEffectState: 'active',
    roundedCorners: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Float above full-screen apps too — the point of a global hotkey is that it
  // works without leaving whatever you were doing. `skipTransformProcessType`
  // is load-bearing: without it Electron turns the whole app into a
  // UIElement to reach full-screen spaces, which removes ClawMuse from the
  // Dock. As an NSPanel (`type: 'panel'`) the window reaches them on its own.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.setAlwaysOnTop(true, 'floating')

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dismiss on focus loss, the way Spotlight and Raycast behave. Keeping it
  // open in dev would make DevTools unusable, so only do it when packaged.
  if (!isDev) {
    win.on('blur', () => win.hide())
  }

  win.on('closed', () => {
    quickWin = null
  })

  void loadRenderer(win, '/quick')
  return win
}

export function toggleQuickChat(): void {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible()) {
    quickWin.hide()
    return
  }
  showQuickChat()
}

export function showQuickChat(): void {
  if (!quickWin || quickWin.isDestroyed()) quickWin = create()

  positionOnActiveDisplay(quickWin)
  quickWin.show()
  quickWin.focus()
  quickWin.webContents.send('menu-command', 'focus-composer')
}

export function hideQuickChat(): void {
  if (quickWin && !quickWin.isDestroyed()) quickWin.hide()
}

export function getQuickChatWindow(): BrowserWindow | null {
  return quickWin && !quickWin.isDestroyed() ? quickWin : null
}

/** True when `win` is the quick panel — used so ⌘W closes vs. hides correctly. */
export function isQuickChatWindow(win: BrowserWindow): boolean {
  return quickWin !== null && !quickWin.isDestroyed() && win.id === quickWin.id
}

export { rendererEntry }
