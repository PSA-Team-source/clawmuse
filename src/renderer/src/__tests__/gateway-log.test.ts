import { describe, expect, it } from 'vitest'
import { __testing } from '../../../main/services/local-runtime/gateway-log'

const { FAILURE_PATTERN, IGNORE_PATTERN, RIVAL_GATEWAY_PATTERN, tidy } = __testing

/**
 * The LaunchAgent that `openclaw gateway install` writes sends stderr to
 * `/dev/null`. A gateway that dies on startup therefore leaves the service log
 * empty — the one moment a user opens it is the one moment it says nothing, and
 * the app could only report "did not become ready in time".
 *
 * These pin the line classification: report the failure, ignore the routine
 * request-level noise that also contains the word "error".
 */
describe('startup failure detection', () => {
  const failures = [
    "2026-07-25T10:00:00.000+07:00 Error: Cannot find module '/Users/x/.openclaw-clawmuse/runtime/node_modules/openclaw/dist/index.js'",
    '2026-07-25T10:00:00.000+07:00 [gateway] FATAL: listen EADDRINUSE: address already in use :::18789',
    '2026-07-25T10:00:00.000+07:00 Error: EACCES: permission denied, open …',
    '2026-07-25T10:00:00.000+07:00 [gateway] uncaught exception in startup',
    '2026-07-25T10:00:00.000+07:00 gateway exited with code 1',
  ]

  it.each(failures)('treats a real startup failure as reportable: %s', (line) => {
    expect(FAILURE_PATTERN.test(line)).toBe(true)
    expect(IGNORE_PATTERN.test(line)).toBe(false)
  })

  const noise = [
    '2026-07-24T15:01:21.933+07:00 [ws] ⇄ res ✗ cron.list 0ms errorCode=INVALID_REQUEST errorMessage=missing scope: operator.read',
    '2026-07-24T15:12:55.104+07:00 [ws] ⇄ res ✗ cron.add 8ms errorCode=INVALID_REQUEST errorMessage=invalid cron.add params',
  ]

  it.each(noise)('ignores per-request noise that merely contains "error": %s', (line) => {
    // These appear in a perfectly healthy gateway; reporting one as the reason
    // a startup failed would send the user chasing the wrong thing.
    expect(IGNORE_PATTERN.test(line)).toBe(true)
  })

  it('does not flag ordinary startup chatter', () => {
    for (const line of [
      '2026-07-24T14:58:47.816+07:00 [gateway] ready',
      '2026-07-24T14:58:47.072+07:00 [gateway] starting...',
      '2026-07-24T14:58:47.464+07:00 [health-monitor] started (interval: 300s)',
    ]) {
      expect(FAILURE_PATTERN.test(line)).toBe(false)
    }
  })
})

/**
 * The failure mode that produces no error line at all.
 *
 * A gateway entering service mode kills processes it thinks are stale, and that
 * sweep ignores profiles. On a machine that already runs OpenClaw the two
 * services terminate each other: the log shows a clean `ready` followed by a
 * SIGTERM, launchd restarts it, and the health probe never passes. Scanning for
 * errors finds nothing, so this line has to be recognised on its own.
 *
 * Observed on a real machine 2026-07-25 while reproducing the first-run bug.
 */
describe('rival gateway detection', () => {
  it.each([
    '2026-07-25T11:58:55.108+07:00 [restart] killing 1 stale gateway process(es) before restart: 41002',
    '2026-07-25T11:58:56.148+07:00 [gateway] service-mode: cleared 1 stale gateway pid(s) before bind on port 51999',
    '[restart] killing 3 stale gateway processes before restart',
  ])('recognises the sweep that kills the other gateway: %s', (line) => {
    expect(RIVAL_GATEWAY_PATTERN.test(line)).toBe(true)
  })

  it('does not fire on an ordinary restart', () => {
    for (const line of [
      '2026-07-25T11:58:57.830+07:00 [gateway] received SIGTERM; shutting down',
      '2026-07-25T11:58:57.944+07:00 [shutdown] completed cleanly in 87ms',
      '2026-07-24T14:58:47.816+07:00 [gateway] ready',
    ]) {
      expect(RIVAL_GATEWAY_PATTERN.test(line)).toBe(false)
    }
  })
})

describe('tidy', () => {
  it('strips the ISO timestamp so the message reads inline', () => {
    expect(tidy('2026-07-25T10:00:00.000+07:00 [gateway] boom')).toBe('[gateway] boom')
  })

  it('leaves a line that has no timestamp alone', () => {
    expect(tidy('  Error: nope  ')).toBe('Error: nope')
  })
})

/**
 * The lease that made every first run fail.
 *
 * A virgin state directory has migrations to run, and OpenClaw takes a
 * five-minute lease before running them. The app used to install the service
 * (which launchd starts at once) and then run `gateway start` on top, whose
 * "stale process" sweep killed the gateway mid-migration — leaving the lease
 * behind and every relaunch failing for the next five minutes.
 *
 * Two things have to be true about that log line: it must be *recognised*, and
 * it must be recognised **before** the stale-process sweep, which appears in
 * the same log and reads like a completely different problem.
 */
describe('the startup-migration lease', () => {
  const { MIGRATION_LEASE_PATTERN, RIVAL_GATEWAY_PATTERN } = __testing

  const leaseLine =
    '2026-07-27T15:04:28.075+07:00 [openclaw] Reason: OpenClaw startup migrations are already running for this state directory; retry after the other gateway finishes or after 2026-07-27T08:08:55.862Z.'

  it('reads the deadline out of the failure', () => {
    const match = MIGRATION_LEASE_PATTERN.exec(leaseLine)
    expect(match?.[1]).toBe('2026-07-27T08:08:55.862Z')
    expect(Number.isNaN(Date.parse(match![1]!))).toBe(false)
  })

  it('does not fire on ordinary migration chatter', () => {
    for (const line of [
      '2026-07-27T15:03:55.862+07:00 [gateway] running startup migrations',
      '2026-07-27T15:03:56.100+07:00 [gateway] migrations complete',
    ]) {
      expect(MIGRATION_LEASE_PATTERN.test(line)).toBe(false)
    }
  })

  it('coexists with the stale-process sweep, which is why order matters', () => {
    // Both lines are present on a first run that lost this race. Matching the
    // sweep first told users to stop an OpenClaw they do not have installed.
    const sweep = '2026-07-27T15:03:56.000+07:00 killing 1 stale gateway process(es) before restart: 11407'
    expect(RIVAL_GATEWAY_PATTERN.test(sweep)).toBe(true)
    expect(MIGRATION_LEASE_PATTERN.test(leaseLine)).toBe(true)
  })
})
