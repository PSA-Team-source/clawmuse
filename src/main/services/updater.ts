import { BrowserWindow, dialog } from 'electron'
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
 * The update feed, if this build has one.
 *
 * A source build has none, and that is the normal case for an open-source app
 * someone cloned and ran: `electron-builder` only writes `app-update.yml` into
 * the bundle when a `publish` target is configured, and without it every launch
 * throws on a file that was never meant to exist. Distributors set
 * `CLAWMUSE_UPDATE_FEED` (formerly `LOCALFANG_UPDATE_FEED`) at build time to point at their own releases.
 */
const UPDATE_FEED = (process.env.CLAWMUSE_UPDATE_FEED ?? process.env.LOCALFANG_UPDATE_FEED)?.trim()

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
function isChannelMissing(error: Error): boolean {
  const text = `${error.message}`
  return /HttpError:\s*404|status(?:Code)?[:=]\s*404|cannot find channel/i.test(text)
}

function broadcast(status: UpdateStatus): void {
  lastStatus = status
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update-status', status)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus
}

export function initUpdater(): void {
  if (isDev) {
    log.info('[updater] disabled in development')
    return
  }
  if (!UPDATE_FEED) {
    log.info('[updater] no update feed configured — this build does not self-update')
    return
  }
  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED })

  autoUpdater.logger = log
  // Download in the background, but never restart under the user — a surprise
  // relaunch mid-conversation would drop a streaming agent response.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Lets a build be pointed at a staging or self-hosted channel without a
  // rebuild — the packaged default lives in `electron-builder.yml`.
  const feedUrl = (process.env.CLAWMUSE_UPDATE_FEED_URL ?? process.env.LOCALFANG_UPDATE_FEED_URL)
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
    log.info(`[updater] feed overridden → ${feedUrl}`)
  }

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => broadcast({ state: 'available', version: info.version }))
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
    log.error('[updater] check failed', err)
  }
}

/** Applies a downloaded update. No-op unless `update-downloaded` has fired. */
export function installUpdate(): void {
  if (lastStatus.state !== 'downloaded') return
  autoUpdater.quitAndInstall()
}
