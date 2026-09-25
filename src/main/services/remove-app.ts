import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { app, shell } from 'electron'
import log from 'electron-log/main.js'
import { stopAssistant } from './assistant.js'
import { run } from './local-runtime/exec.js'
import { LAUNCHD_LABEL, LEGACY_HOMES, LEGACY_LAUNCHD_LABEL, LEGACY_LAUNCH_AGENT, LEGACY_PROFILE, PROFILE, openclawEnv, paths } from './local-runtime/paths.js'
import { resolveOpenclaw } from './local-runtime/resolve.js'
import { stopSupervised } from './local-runtime/gateway-supervisor.js'

/**
 * Settings → Data controls → Remove ClawMuse from this Mac.
 *
 * Dragging the app to the Trash leaves ~3 GB behind and — worse — a
 * LaunchAgent that keeps the agent gateway running (and listed under Login
 * Items) for an app that no longer exists. This removes everything ClawMuse
 * put on the machine, and nothing else: the user's own `~/.openclaw` and any
 * other OpenClaw profile are never touched.
 *
 * Order matters: the service is unregistered before its files go, so launchd
 * cannot respawn a gateway into a half-deleted profile. The app's own data
 * directory is deleted by a detached shell after the app has exited, because
 * Chromium rewrites parts of it on shutdown.
 */
export async function removeClawMuse(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    stopAssistant()
    if (process.platform === 'win32') await stopSupervised()
    const bin = (await resolveOpenclaw())?.bin
    if (bin) {
      for (const profile of [PROFILE, LEGACY_PROFILE]) {
        await run(bin, ['--profile', profile, 'gateway', 'uninstall', '--json'], { env: openclawEnv(), timeoutMs: 60_000 })
      }
    }
    // Belt and braces for a CLI that could not run: launchd by label (macOS;
    // on Windows `gateway uninstall` owns the Scheduled Task).
    if (process.platform === 'darwin') {
      const uid = process.getuid?.() ?? 501
      for (const label of [LAUNCHD_LABEL, LEGACY_LAUNCHD_LABEL]) {
        await run('/bin/launchctl', ['bootout', `gui/${uid}/${label}`], { timeoutMs: 15_000 })
      }
    }
    const logs = join(homedir(), 'Library', 'Logs', 'openclaw')
    for (const target of [
      paths.launchAgent,
      LEGACY_LAUNCH_AGENT,
      paths.home,
      ...LEGACY_HOMES,
      join(logs, `gateway-${PROFILE}.log`),
      join(logs, `gateway-${LEGACY_PROFILE}.log`),
    ]) {
      await rm(target, { recursive: true, force: true })
    }
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: false })
    log.info('[remove-app] agent service and profile removed; removing app data after exit')
    const later = [app.getPath('userData'), app.getPath('logs')]
    if (process.platform === 'win32') {
      // Same idea as below, in cmd.exe: wait for this process to exit, delete
      // the app data, then run the NSIS uninstaller silently — the Windows
      // equivalent of the Trash, and it also clears Apps & features.
      const uninstaller = join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`)
      const steps = [
        'timeout /t 3 /nobreak >nul',
        ...later.map((path) => `rmdir /s /q "${path}"`),
        ...(app.isPackaged && existsSync(uninstaller) ? [`"${uninstaller}" /S`] : []),
      ]
      spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', steps.join(' & ')], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref()
      setTimeout(() => app.exit(0), 300)
      return { ok: true }
    }
    // `sleep` outlives this process; `rm -rf` then runs on files no one holds.
    spawn('/bin/sh', ['-c', 'sleep 3; rm -rf "$@"', 'sh', ...later], { detached: true, stdio: 'ignore' }).unref()
    if (app.isPackaged) {
      // The running bundle can be moved; macOS keeps the process alive until exit.
      const bundle = join(app.getAppPath(), '..', '..', '..')
      if (bundle.endsWith('.app')) await shell.trashItem(bundle).catch((err: Error) => log.warn('[remove-app] could not move the app to the Trash:', err.message))
    }
    setTimeout(() => app.exit(0), 300)
    return { ok: true }
  } catch (err) {
    log.error('[remove-app] failed:', err)
    return { ok: false, error: (err as Error).message || 'Could not remove ClawMuse' }
  }
}
