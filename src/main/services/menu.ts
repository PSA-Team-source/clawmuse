import { Menu, app } from 'electron'
import { createMainWindow, focusedOrFirstWindow, openSettingsWindow } from '../windows/main-window.js'
import { checkForUpdates } from './updater.js'

/** Routes the renderer to a section, reusing the deep-link channel. */
function go(route: string): void {
  const win = focusedOrFirstWindow() ?? createMainWindow()
  win.show()
  win.focus()
  win.webContents.send('deeplink', `clawmuse://${route}`)
}

export function buildApplicationMenu(): Menu {
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => void checkForUpdates(true) },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => { openSettingsWindow() } },
        // Services and Hide are macOS concepts; Windows gets a plain Exit.
        ...(process.platform === 'darwin'
          ? ([
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
            ] as const)
          : []),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Speech',
          submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' },
      ],
    },
    {
      role: 'help',
      submenu: [{ label: 'ClawMuse Help', click: () => go('settings/about') }],
    },
  ])

  return menu
}

export function installApplicationMenu(): void {
  Menu.setApplicationMenu(buildApplicationMenu())
}
