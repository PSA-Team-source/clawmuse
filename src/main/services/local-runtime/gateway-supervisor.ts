import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import log from 'electron-log/main.js'
import { resolveWindowsCommand } from './exec.js'
import { PROFILE, openclawEnv, paths } from './paths.js'

/**
 * Windows: ClawMuse runs the gateway itself (`openclaw gateway run`) instead of
 * installing a Scheduled Task.
 *
 * Measured on a fresh Windows Server 2022 VM: OpenClaw's Scheduled Task
 * inspection launches PowerShell, whose first COM calls take ~5 s cold —
 * exactly its default probe budget — so `gateway install` reported
 * SERVICE_DEFINITION_UNKNOWN, and a retry hung for minutes. OpenClaw documents
 * `gateway run` as the supported path "without a managed Gateway service", and
 * ClawMuse is already resident (notification area + launch at login), which is
 * the supervision a service would have given: this restarts a crashed gateway
 * with backoff (auto-heal) and stops it with the app.
 */

let child: ChildProcess | null = null
let port: number | null = null
let stopping = false
let restarts = 0
let restartTimer: NodeJS.Timeout | null = null

export function rememberPort(value: number): void {
  port = value
}

export function supervisedAlive(): boolean {
  return child !== null && child.exitCode === null && !child.killed
}

export function startSupervised(): void {
  if (supervisedAlive() || port === null) return
  stopping = false
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = null
  const target = resolveWindowsCommand(paths.runtimeBin, ['--profile', PROFILE, 'gateway', 'run', '--port', String(port)])
  mkdirSync(dirname(paths.gatewayLog), { recursive: true })
  const out = createWriteStream(paths.gatewayLog, { flags: 'a' })
  const started = Date.now()
  child = spawn(target.command, target.args, {
    env: { ...openclawEnv(), ...(target.node ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.pipe(out)
  child.stderr?.pipe(out)
  log.info(`[gateway] supervised gateway started (pid ${child.pid}, port ${port})`)
  child.on('exit', (code, signal) => {
    child = null
    out.end()
    if (stopping) return
    // A run that lasted a while resets the backoff; a crash loop backs off to 30 s.
    if (Date.now() - started > 60_000) restarts = 0
    const delay = Math.min(30_000, 1_000 * 2 ** restarts)
    restarts += 1
    log.warn(`[gateway] gateway exited (code ${code ?? '-'}, ${signal ?? 'no signal'}); restarting in ${delay} ms`)
    restartTimer = setTimeout(startSupervised, delay)
  })
}

export async function stopSupervised(): Promise<void> {
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = null
  const current = child
  if (!current?.pid) return
  // The gateway has children (tools, browsers); end the whole tree.
  await new Promise<void>((resolve) => {
    const kill = spawn('taskkill', ['/pid', String(current.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    kill.on('exit', () => resolve())
    kill.on('error', () => resolve())
  })
  child = null
}

export async function restartSupervised(): Promise<void> {
  await stopSupervised()
  restarts = 0
  startSupervised()
}
