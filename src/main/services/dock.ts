import { app, nativeImage } from 'electron'
import log from 'electron-log/main.js'
import { devBuildPath, isDev } from '../env.js'

/**
 * Gives `npm run dev` the ClawMuse Dock icon instead of the Electron logo.
 *
 * macOS reads an app's Dock icon from the Info.plist of the bundle that is
 * *running*. In dev that bundle is node_modules/electron/dist/Electron.app,
 * whose plist says `CFBundleIconFile = electron.icns` — so `mac.icon` in
 * electron-builder.yml, which only applies at package time, can never reach it.
 * `app.dock.setIcon()` is the sole runtime override.
 *
 * Packaged builds are deliberately left alone: macOS 26 composes their icon from
 * Assets.car via `CFBundleIconName`, which yields the layered treatment
 * (specular lighting, dark/tinted appearances) that a flat bitmap cannot. Calling
 * `setIcon` there would replace a live icon with a static picture of one.
 *
 * `build/dock-dev.png` is macOS's own render of that composed icon, produced by
 * scripts/generate-icons.sh, so the two surfaces agree pixel for pixel.
 */
export function applyDevDockIcon(): void {
  // `app.dock` is undefined off macOS; the guard also documents that the whole
  // mechanism is macOS-only.
  if (!isDev || process.platform !== 'darwin') return

  const iconPath = devBuildPath('dock-dev.png')
  const icon = nativeImage.createFromPath(iconPath)

  // `createFromPath` reports a missing or unreadable file as an empty image
  // rather than throwing, and `setIcon` would then silently clear the icon.
  if (icon.isEmpty()) {
    log.warn(`[dock] no dev icon at ${iconPath} — run scripts/generate-icons.sh`)
    return
  }

  app.dock?.setIcon(icon)
}
