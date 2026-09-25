import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paths } from './paths.js'

/**
 * Recovers the reason a gateway start failed.
 *
 * The LaunchAgent that `openclaw gateway install` writes sends **stderr to
 * `/dev/null`** and only stdout to `~/Library/Logs/openclaw/gateway-<profile>.log`.
 * A gateway that dies during startup therefore leaves that log empty, and the
 * app could only say "did not become ready in time" while pointing the user at
 * a file containing nothing — the failure was undiagnosable by design.
 *
 * OpenClaw does keep its own log, in a `openclaw/` directory under the temp
 * dir, and that one does capture startup errors. This reads it so the app can
 * show what actually happened instead of a timeout.
 */

/** Both candidates: the service env sets a private TMPDIR, the CLI may not honour it. */
function logDirs(): string[] {
  return [join(tmpdir(), 'openclaw'), join(paths.home, 'tmp', 'openclaw'), '/tmp/openclaw']
}

/** Newest `openclaw-*.log` across the candidate directories. */
export function findLatestGatewayLog(): string | null {
  let newest: { path: string; mtimeMs: number } | null = null

  for (const dir of logDirs()) {
    if (!existsSync(dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('openclaw-') || !entry.endsWith('.log')) continue
      const full = join(dir, entry)
      try {
        const { mtimeMs } = statSync(full)
        if (!newest || mtimeMs > newest.mtimeMs) newest = { path: full, mtimeMs }
      } catch {
        /* raced with rotation */
      }
    }
  }

  return newest?.path ?? null
}

/**
 * A cheap "has the gateway written anything since last time" fingerprint.
 *
 * Used by the readiness wait to tell "still booting" from "wedged". Size and
 * mtime together survive log rotation: a fresh file resets the size but the
 * path changes with it.
 */
export function gatewayLogMark(): string | null {
  const file = findLatestGatewayLog()
  if (!file) return null
  try {
    const { size, mtimeMs } = statSync(file)
    return `${file}:${size}:${mtimeMs}`
  } catch {
    return null
  }
}

/** Lines worth showing a user; everything else in that log is routine chatter. */
const FAILURE_PATTERN =
  /\b(error|fatal|cannot find module|eaddrinuse|eacces|permission denied|unhandled|uncaught|exited|failed)\b/i

/** Noise that matches the pattern but says nothing about why startup failed. */
const IGNORE_PATTERN = /\b(errorCode=INVALID_REQUEST|missing scope|deprecat)/i

/**
 * The startup-migration lease, when one is blocking the gateway.
 *
 * A virgin state directory has migrations to run, and OpenClaw takes a
 * five-minute lease before running them so two gateways cannot both migrate.
 * A gateway killed mid-migration leaves that lease behind, and every relaunch
 * until it expires dies with:
 *
 *     OpenClaw startup migrations are already running for this state directory;
 *     retry after the other gateway finishes or after 2026-07-27T08:08:55.862Z.
 *
 * That is a wait, not a failure — launchd keeps retrying every ten seconds and
 * the next attempt after the deadline succeeds. Reading the deadline lets the
 * app wait for it instead of reporting a dead agent thirty seconds in.
 */
const MIGRATION_LEASE_PATTERN =
  /startup migrations are already running[^\n]*?after\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i

/** Epoch ms the lease frees up, or null when nothing is holding one. */
export function readMigrationLease({ tailLines = 120 } = {}): number | null {
  const file = findLatestGatewayLog()
  if (!file) return null
  try {
    const lines = readFileSync(file, 'utf8').split('\n').slice(-tailLines)
    // Last match wins: an older lease that has already expired must not mask a
    // current one, and vice versa.
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const match = MIGRATION_LEASE_PATTERN.exec(lines[i]!)
      if (!match) continue
      const expiry = Date.parse(match[1]!)
      return Number.isNaN(expiry) ? null : expiry
    }
  } catch {
    /* unreadable — treat as no lease */
  }
  return null
}

/**
 * A second OpenClaw gateway on this machine.
 *
 * Before binding, a gateway in service mode kills processes it considers stale
 * — and that sweep is **not scoped to a profile**. So a machine that already
 * runs OpenClaw (a developer's own `~/.openclaw`, or an older ClawMuse profile)
 * ends up with two services terminating each other on every launchd restart.
 * The gateway reaches `ready`, takes a SIGTERM seconds later, and launchd
 * starts it again: a crash loop whose only outward symptom is a health probe
 * that never passes.
 *
 * Worth naming explicitly, because the log line that proves it ("killing N
 * stale gateway process(es)") reads like routine housekeeping.
 */
const RIVAL_GATEWAY_PATTERN = /killing \d+ stale gateway process|cleared \d+ stale gateway pid/i

function tidy(line: string): string {
  // Strip the leading ISO timestamp; the app shows this inline, not as a log.
  return line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.+-]+\s*/, '').trim()
}

/**
 * The most recent startup failure, or null when the log explains nothing.
 *
 * Only the tail is considered: an older failure that has since been fixed must
 * not be reported as the reason for today's timeout.
 */
export async function readStartupFailure(
  { tailLines = 80, maxAgeMs = 5 * 60_000 } = {},
): Promise<string | null> {
  const file = findLatestGatewayLog()
  if (!file) return null

  try {
    // A log older than the attempt itself belongs to a previous run.
    if (Date.now() - statSync(file).mtimeMs > maxAgeMs) return null

    const content = await readFile(file, 'utf8')
    const lines = content.split('\n').slice(-tailLines)

    // Checked before the rival-gateway sweep, and that order is load-bearing.
    // The sweep line and the lease failure appear together whenever a gateway
    // was killed mid-migration — which on a first run is *our own* restart, not
    // a rival. Matching the rival first told a user with no other OpenClaw
    // installed to go and stop it, which is unfollowable advice.
    const lease = lines
      .map((line) => MIGRATION_LEASE_PATTERN.exec(line)?.[1])
      .filter((value): value is string => typeof value === 'string')
      .at(-1)
    if (lease) {
      const at = new Date(lease)
      const when = Number.isNaN(at.getTime())
        ? 'shortly'
        : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      return `the agent is still preparing its data directory and another attempt holds the lock until ${when}. It retries by itself — wait, then press Retry.`
    }

    // A rival gateway produces a clean `ready` followed by a SIGTERM, so
    // scanning for error lines finds nothing and the real cause — two services
    // fighting — goes unreported.
    if (lines.some((line) => RIVAL_GATEWAY_PATTERN.test(line))) {
      return 'another OpenClaw gateway is restarting this one. If you run OpenClaw outside ClawMuse, stop it (`openclaw gateway stop`) and retry.'
    }

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]!
      if (!FAILURE_PATTERN.test(line) || IGNORE_PATTERN.test(line)) continue
      const cleaned = tidy(line)
      if (cleaned.length === 0) continue
      // Long stack traces are unreadable inline; the first frame carries it.
      return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned
    }
  } catch {
    /* unreadable — fall through to null */
  }

  return null
}

export const __testing = {
  FAILURE_PATTERN,
  IGNORE_PATTERN,
  RIVAL_GATEWAY_PATTERN,
  MIGRATION_LEASE_PATTERN,
  tidy,
}
