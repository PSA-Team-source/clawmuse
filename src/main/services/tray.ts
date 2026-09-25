import { Menu, Tray, app, nativeImage } from 'electron'
import { resourcePath } from '../env.js'
import { createMainWindow, focusedOrFirstWindow, getMainWindows } from '../windows/main-window.js'
import { showQuickChat } from '../windows/quick-chat.js'
import { getShortcut } from './shortcuts.js'
import { checkForUpdates } from './updater.js'

let tray: Tray | null = null

/** Latest connection state pushed up from the renderer, shown in the menu. */
let connectionLabel = 'Connecting…'

function openApp(route?: string): void {
  const win = focusedOrFirstWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (route) win.webContents.send('deeplink', `clawmuse://${route}`)
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: `ClawMuse — ${connectionLabel}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Quick Chat',
      accelerator: getShortcut() && getShortcut() !== 'DoubleOption' ? getShortcut() : undefined,
      click: () => showQuickChat(),
    },
    { label: 'Open ClawMuse', click: () => openApp() },
    { type: 'separator' },
    { label: 'New Chat', click: () => openApp('chat?new=1') },
    { label: 'Scheduled Tasks', click: () => openApp('tasks') },
    { label: 'Facebook Ads', click: () => openApp('facebook-ads') },
    { label: '3D Room', click: () => openApp('room') },
    { type: 'separator' },
    { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => openApp('settings') },
    { label: 'Check for Updates…', click: () => void checkForUpdates(true) },
    { type: 'separator' },
    { label: 'Quit ClawMuse', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  ])
}

export function createTray(): Tray {
  // macOS: a template glyph the system recolours for light/dark menu bars and
  // inverts while the menu is open. Windows has no template images — a black
  // glyph vanishes on the dark taskbar — so it gets the full-colour app icon.
  const image = process.platform === 'darwin'
    ? nativeImage.createFromPath(resourcePath('trayTemplate.png'))
    : nativeImage.createFromPath(resourcePath('icon.png')).resize({ width: 32, height: 32, quality: 'best' })
  if (process.platform === 'darwin') image.setTemplateImage(true)

  tray = new Tray(image)
  tray.setToolTip('ClawMuse')
  tray.setContextMenu(buildMenu())

  // Left-click opens the quick panel (menu stays on right-click), matching the
  // behaviour of Raycast and the ChatGPT desktop app.
  tray.on('click', () => showQuickChat())

  return tray
}

export function setTrayConnectionLabel(label: string): void {
  if (connectionLabel === label) return
  connectionLabel = label
  tray?.setContextMenu(buildMenu())
}

/** Rebuild after the user changes the global shortcut so the hint stays true. */
export function refreshTrayMenu(): void {
  tray?.setContextMenu(buildMenu())
}

/** Settings > App behavior > Show in menu bar. */
export function setMenuBarVisible(visible: boolean): void {
  if (visible && !tray) createTray()
  else if (!visible) destroyTray()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

export function hasOpenWindows(): boolean {
  return getMainWindows().length > 0
}
