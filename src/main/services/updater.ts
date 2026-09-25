import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BrowserWindow, Notification, app, dialog, shell } from 'electron'
import log from 'electron-log/main.js'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/ipc'
import { isDev } from '../env.js'

// electron-updater ships CommonJS; this is the interop-safe way to reach the
// named export from an ESM main process.
const { autoUpdater } = electronUpdater

let lastStatus: UpdateStatus = { state: 'idle' }
/** True when the user asked explicitly, so we surface "you're up to date". */
let interactive = false
/** Logged loudly once per launch, then quietly — see `isChannelMissing`. */
let channelMissingReported = false

/**
 * An explicit update feed, for distributors and staging channels.
 *
 * Release builds need none: `electron-builder.yml` publishes to GitHub
 * Releases, which writes `app-update.yml` into the bundle, and electron-updater
 * reads it on its own. A source build has no such file, so it does not
 * self-update rather than throwing on every launch.
 */
const UPDATE_FEED = process.env.CLAWMUSE_UPDATE_FEED?.trim()

/** Written by electron-builder when the build has a `publish` target. */
function hasBundledFeed(): boolean {
  return existsSync(join(process.resourcesPath, 'app-update.yml'))
}

/**
 * A feed that has not been published yet, rather than a broken update.
 *
 * Even with a feed configured, nothing uploads the manifest on its own — so
 * until someone publishes a release, every launch asks for `latest-mac.yml`
 * and gets a 404. That is not an error the user can act on; it means "there is
 * no update channel here yet".
 *
 * A real failure — DNS, TLS, a corrupt manifest — still surfaces as an error.
 */
function isChannelMissing(error: unknown): boolean {
  // electron-updater's HttpError carries the status; its message starts with
  // "404" and does not contain the class name, so the text alone missed it.
  if ((error as { statusCode?: unknown })?.statusCode === 404) return true
  const text = `${(error as Error)?.message ?? error}`
  return /HttpError:\s*404|^\s*404\b|status(?:Code)?[:=]\s*404|cannot find channel/i.test(text)
}

function broadcast(status: UpdateStatus): void {
  lastStatus = status
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update-status', status)
  }
}

/**
 * macOS installs an update in place only for a Developer ID-signed app
 * (Squirrel.Mac validates the new bundle against the running one's signature;
 * Electron: "Your application must be signed for automatic updates on macOS").
 * An ad-hoc-signed build would download the update and then fail to apply it,
 * so it checks and points the user at the installer instead. Signing the build
 * turns full auto-update on with no code change.
 */
async function macNeedsManualUpdate(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const bundle = join(app.getPath('exe'), '..', '..', '..')
  try {
    const { stderr } = await promisify(execFile)('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], { timeout: 10_000 })
    return !/Authority=Developer ID Application/.test(stderr)
  } catch {
    return true
  }
}

let manualInstall = false
let notifiedVersion: string | null = null
const manualUrl = () => `https://clawmuse.app/download/${process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'}`

function offerManualUpdate(version: string): void {
  const url = manualUrl()
  broadcast({ state: 'manual', version, url })
  if (interactive) {
    interactive = false
    void dialog.showMessageBox({
      type: 'info',
      message: `ClawMuse ${version} is available.`,
      detail: 'Download the new version and drag it into Applications to replace this one. Your chats and settings stay.',
      buttons: ['Download', 'Later'],
      defaultId: 0,
    }).then(({ response }) => { if (response === 0) void shell.openExternal(url) })
    return
  }
  // Once per version, not on every 6-hourly check.
  if (notifiedVersion === version || !Notification.isSupported()) return
  notifiedVersion = version
  const notice = new Notification({ title: `ClawMuse ${version} is available`, body: 'Click to download the new version.' })
  notice.on('click', () => void shell.openExternal(url))
  notice.show()
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus
}

export function initUpdater(): void {
  if (isDev) {
    log.info('[updater] disabled in development')
    return
  }
  if (UPDATE_FEED) {
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED })
    log.info(`[updater] feed overridden → ${UPDATE_FEED}`)
  } else if (!hasBundledFeed()) {
    log.info('[updater] no update feed in this build — it does not self-update')
    return
  }

  // electron-updater logs its own errors before emitting them; keep the
  // no-release-yet 404 out of the error log (handled quietly below).
  autoUpdater.logger = {
    info: (...args: unknown[]) => log.info(...args),
    warn: (...args: unknown[]) => log.warn(...args),
    debug: (...args: unknown[]) => log.debug(...args),
    error: (...args: unknown[]) => (args.some(isChannelMissing) ? log.debug(...args) : log.error(...args)),
  }
  // Download in the background, but never restart under the user — a surprise
  // relaunch mid-conversation would drop a streaming agent response.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  void macNeedsManualUpdate().then((manual) => {
    manualInstall = manual
    if (!manual) return
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    log.info('[updater] macOS build is not Developer ID-signed: updates are offered as a download')
  })

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    if (manualInstall) offerManualUpdate(info.version)
    else broadcast({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    broadcast({ state: 'not-available' })
    if (interactive) {
      interactive = false
      void dialog.showMessageBox({
        type: 'info',
        message: 'ClawMuse is up to date.',
        buttons: ['OK'],
      })
    }
  })
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond }),
  )
  autoUpdater.on('update-downloaded', (info) => broadcast({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => {
    if (isChannelMissing(err)) {
      // Once per launch at warn so it is diagnosable, then silent: this fires
      // on every scheduled check and filled the log with a 404 that says
      // nothing new the second time.
      if (!channelMissingReported) {
        channelMissingReported = true
        log.warn('[updater] no update channel published at the configured feed — treating as up to date')
      }
      broadcast({ state: 'not-available' })
      if (interactive) {
        interactive = false
        void dialog.showMessageBox({
          type: 'info',
          message: 'ClawMuse is up to date.',
          detail: 'No newer release has been published yet.',
          buttons: ['OK'],
        })
      }
      return
    }

    log.error('[updater]', err)
    broadcast({ state: 'error', message: err.message })
    if (interactive) {
      interactive = false
      void dialog.showMessageBox({
        type: 'error',
        message: 'Could not check for updates.',
        detail: err.message,
        buttons: ['OK'],
      })
    }
  })

  // First check a little after launch so it never competes with the sandbox
  // boot sequence for bandwidth, then every 6 hours.
  setTimeout(() => void checkForUpdates(), 30_000)
  setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000)
}

export async function checkForUpdates(fromUser = false): Promise<void> {
  if (isDev) {
    if (fromUser) {
      await dialog.showMessageBox({
        type: 'info',
        message: 'Updates are disabled in development builds.',
        buttons: ['OK'],
      })
    }
    return
  }
  interactive = fromUser
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    // The 'error' event already reported it (quietly, for a missing channel).
    if (!isChannelMissing(err)) log.error('[updater] check failed', err)
  }
}

/** Applies a downloaded update. No-op unless `update-downloaded` has fired. */
export function installUpdate(): void {
  if (lastStatus.state === 'manual') {
    void shell.openExternal(lastStatus.url)
    return
  }
  if (lastStatus.state !== 'downloaded') return
  autoUpdater.quitAndInstall()
}
