import log from 'electron-log/main.js'
import { rememberPort, restartSupervised, startSupervised, stopSupervised, supervisedAlive } from './gateway-supervisor.js'
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { firstMeaningfulLine, run, runJson } from './exec.js'
import { gatewayLogMark, readMigrationLease } from './gateway-log.js'
import { LAUNCHD_LABEL, PROFILE, openclawEnv, paths, wsUrlFor } from './paths.js'

const IS_WINDOWS = process.platform === 'win32'

/**
 * Drives the gateway service through the `openclaw` CLI.
 *
 * Nothing here re-implements process supervision: `gateway install` writes the
 * LaunchAgent, launchd keeps it alive across app quits and crashes, and
 * `gateway restart --safe` knows how to drain in-flight agent work before
 * bouncing. Reproducing any of that in Electron would be strictly worse and is
 * explicitly out of scope (`LOCAL-RUNTIME.md` §3).
 */

/** Every invocation carries the profile, or the CLI would act on `~/.openclaw`. */
function argv(args: string[]): string[] {
  return ['--profile', PROFILE, ...args]
}

export interface HealthPayload {
  ok?: boolean
  ts?: number
  durationMs?: number
}

export interface ServiceStatus {
  loaded: boolean
  running: boolean
  version?: string
}

/**
 * Installs (or rewrites) the LaunchAgent.
 *
 * Returns the CLI's own outcome word — `already-installed` matters to the
 * caller: the CLI leaves an existing service untouched, so if that service was
 * installed against a different port or an older profile it will never answer
 * on the port we just configured, and the only symptom is a health timeout.
 * `force` rewrites it.
 */
export async function installService(
  bin: string,
  port: number,
  options: { force?: boolean } = {},
): Promise<string> {
  // Windows: the app supervises `gateway run` itself (gateway-supervisor.ts).
  if (IS_WINDOWS) {
    rememberPort(port)
    return 'supervised'
  }
  const args = [
    'gateway',
    'install',
    '--port',
    String(port),
    '--runtime-path',
    paths.nodeShim,
    '--json',
  ]
  if (options.force) args.push('--force')
  let result = await runJson<{ ok?: boolean; result?: string }>(bin, argv(args), {
    env: openclawEnv(),
    timeoutMs: 180_000,
  })
  if (!result.ok && /state database schema migration required/i.test(`${result.error}\n${result.result.stdout}\n${result.result.stderr}`)) {
    if (existsSync(paths.stateDatabase)) {
      await copyFile(paths.stateDatabase, `${paths.stateDatabase}.bak-pre-2026.9.5`)
    }
    log.warn('[local-runtime] OpenClaw state schema changed; backed up the database and applying its safe migration')
    const repaired = await run(bin, argv(['doctor', '--fix', '--non-interactive', '--yes']), {
      env: openclawEnv(),
      timeoutMs: 180_000,
    })
    if (repaired.code !== 0) {
      throw new Error(`gateway migration failed: ${firstMeaningfulLine(repaired.stderr) || firstMeaningfulLine(repaired.stdout) || repaired.code}`)
    }
    result = await runJson<{ ok?: boolean; result?: string }>(bin, argv(args), {
      env: openclawEnv(),
      timeoutMs: 180_000,
    })
  }
  if (!result.ok) throw new Error(`gateway install failed: ${result.error}`)
  const outcome = result.data.result ?? 'ok'
  log.info(`[local-runtime] gateway install${options.force ? ' --force' : ''} → ${outcome}`)
  return outcome
}

export async function startService(bin: string): Promise<void> {
  if (IS_WINDOWS) return startSupervised()
  const result = await run(bin, argv(['gateway', 'start', '--json']), {
    env: openclawEnv(),
    timeoutMs: 120_000,
  })
  // `start` on an already-running service is a no-op that may exit non-zero;
  // the health probe downstream is the real readiness signal, so this only logs.
  if (result.code !== 0) {
    log.warn('[local-runtime] gateway start:', firstMeaningfulLine(result.stderr) || result.code)
  }
}

/**
 * Starts the service **only if launchd is not already running it**.
 *
 * `gateway install` writes a job with `RunAtLoad` and bootstraps it, so launchd
 * has normally spawned the gateway a second or so after install returns.
 * Calling `start` on top of that is not the no-op it looks like: the CLI sweeps
 * processes it considers stale first — `killing 1 stale gateway process(es)
 * before restart` — and the process it kills is the one launchd just started.
 *
 * On an existing profile that is harmless; the gateway restarts and comes up.
 * On a **first run** it is fatal. A virgin state directory has migrations to
 * run, and the gateway takes a five-minute lease before running them. Killing
 * it mid-migration leaves the lease behind, so every relaunch for the next five
 * minutes dies with *"startup migrations are already running for this state
 * directory"*, launchd throttles the restarts, and the app times out on a
 * gateway that was working until we interrupted it.
 *
 * Verified on a wiped profile: install at 15:03:54, lease taken 15:03:55,
 * `killing 1 stale gateway process(es) before restart: 11407`, then failures
 * every ten seconds until the lease expired.
 */
export async function startServiceIfStopped(bin: string): Promise<void> {
  if (IS_WINDOWS) return startSupervised()
  // launchd spawns asynchronously, so "no process" immediately after install
  // means "not yet", not "not going to". Five seconds is far longer than the
  // ~1s observed and still short enough not to matter on the path where the
  // service really is stopped.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await serviceProcessAlive()) {
      log.info('[local-runtime] launchd already started the gateway — not starting a second one')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await startService(bin)
}

export async function restartService(bin: string): Promise<void> {
  if (IS_WINDOWS) return restartSupervised()
  // `--safe` asks the running gateway to drain queued replies, embedded runs and
  // task runs first. Plain restart would cut an in-flight agent turn mid-reply.
  const result = await run(bin, argv(['gateway', 'restart', '--safe', '--json']), {
    env: openclawEnv(),
    timeoutMs: 180_000,
  })
  if (result.code !== 0) {
    throw new Error(`gateway restart failed: ${firstMeaningfulLine(result.stderr) || result.code}`)
  }
}

export async function stopService(bin: string): Promise<void> {
  if (IS_WINDOWS) return stopSupervised()
  await run(bin, argv(['gateway', 'stop', '--json']), { env: openclawEnv(), timeoutMs: 60_000 })
}

export async function serviceStatus(bin: string): Promise<ServiceStatus> {
  const result = await runJson<{
    service?: { loaded?: boolean }
    rpc?: { reachable?: boolean }
    gateway?: { version?: string }
  }>(bin, argv(['gateway', 'status', '--json']), { env: openclawEnv(), timeoutMs: 60_000 })
  if (!result.ok) return { loaded: false, running: false }
  return {
    loaded: result.data.service?.loaded === true,
    running: result.data.rpc?.reachable === true,
    version: result.data.gateway?.version,
  }
}

/**
 * Liveness probe against a specific port.
 *
 * `--url` makes the CLI ignore config/env credentials by design, so the token
 * must be passed explicitly — see the note in `docs/cli/gateway.md`.
 */
export async function health(bin: string, port: number, token: string): Promise<boolean> {
  const result = await runJson<HealthPayload>(
    bin,
    argv([
      'gateway',
      'call',
      'health',
      '--url',
      wsUrlFor(port),
      '--token',
      token,
      '--timeout',
      '5000',
      '--json',
    ]),
    { env: openclawEnv(), timeoutMs: 20_000 },
  )
  return result.ok && result.data.ok !== false
}

/**
 * Whether launchd currently has a process for our service.
 *
 * `launchctl list <label>` prints a plist dict with `"PID" = 1234;` while the
 * job is running and omits the key when it is not. Cheaper than
 * `gateway status --json`, which opens an RPC connection the gateway has not
 * started listening for yet — the exact situation this is trying to observe.
 */
export async function serviceProcessAlive(): Promise<boolean> {
  if (IS_WINDOWS) return supervisedAlive()
  const result = await run('launchctl', ['list', LAUNCHD_LABEL], { timeoutMs: 10_000 })
  if (result.code !== 0) return false
  return /"PID"\s*=\s*\d+/.test(result.stdout)
}

export interface HealthWaitOptions {
  /** Hard ceiling. Nothing waits past this, however alive the service looks. */
  timeoutMs?: number
  intervalMs?: number
  /** Called when the wait is taking real time, with something true to show. */
  onProgress?: (detail: string) => void
}

/**
 * Waits for the gateway to answer, pacing itself against real progress.
 *
 * This used to be `attempts = 20, intervalMs = 1000` — a flat sixty seconds
 * across the two call sites — and that number was the whole of the "did not
 * become ready in time" bug on clean machines. First boot is not a process
 * start: the gateway may still be npm-installing a provider plugin, and the
 * field report measured four and a half minutes of it. Sixty seconds is a
 * guess about a network, dressed up as a health check.
 *
 * So the deadline is no longer a fixed count of ticks. The wait continues while
 * launchd still has a live process — the honest definition of "starting" — and
 * ends on one of three real conditions: the gateway answers, OpenClaw's log
 * names a startup failure, or the hard ceiling is reached. A service that is
 * *not* running is not slow, it is dead, and that fails immediately instead of
 * spending the rest of the budget on it.
 *
 * With one exception, and it is the exception that costs a first run: a gateway
 * blocked on someone else's **startup-migration lease** has no process and is
 * still going to come up, because launchd retries every ten seconds and the
 * attempt after the lease expires succeeds. Declaring that dead — which the
 * thirty-second rule does on its own — turns a wait into a failure.
 */
export async function waitForHealth(
  bin: string,
  port: number,
  token: string,
  options: HealthWaitOptions = {},
): Promise<boolean> {
  const { timeoutMs = 360_000, intervalMs = 1000, onProgress } = options
  const startedAt = Date.now()

  /**
   * How long the service may have no process before it counts as gone.
   *
   * Generous on purpose: `gateway restart --safe` drains in-flight agent work,
   * and launchd has no job during the swap. Calling that "dead" would turn an
   * orderly restart into a boot error.
   */
  const DEAD_AFTER_MS = 30_000
  /** Ceiling on lease-extended waiting, so a stuck lease cannot hang forever. */
  const MAX_TOTAL_MS = 12 * 60_000

  let lastAliveAt = Date.now()
  let lastLogMark = gatewayLogMark()
  let lastSampleAt = 0
  let lastReportAt = 0
  let deadline = startedAt + timeoutMs

  while (Date.now() < deadline) {
    if (await health(bin, port, token)) return true

    const now = Date.now()
    // Liveness sampling is a process spawn; once every five seconds is plenty
    // and keeps the health poll itself at one per second.
    if (now - lastSampleAt >= 5_000) {
      lastSampleAt = now
      if (await serviceProcessAlive()) lastAliveAt = Date.now()
      else if (Date.now() - lastAliveAt > DEAD_AFTER_MS) {
        // No process, but is it blocked or gone? A live migration lease means
        // launchd's next retry after it expires will succeed, so wait for that
        // rather than reporting a dead agent the user cannot act on.
        const lease = readMigrationLease()
        if (lease !== null && lease > Date.now()) {
          // +20s: launchd retries on a 10s throttle, so the first attempt after
          // the lease frees up lands inside this margin.
          deadline = Math.min(Math.max(deadline, lease + 20_000), startedAt + MAX_TOTAL_MS)
          onProgress?.(
            `Preparing the agent’s data — retrying at ${new Date(lease).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
          )
          lastAliveAt = Date.now()
        } else {
          log.warn('[local-runtime] the gateway has had no launchd process for 30s — not waiting further')
          return false
        }
      }
    }

    // Past the point where a user assumes the app has hung, say what is
    // happening. The log moving is the difference between "installing
    // something" and "wedged", and it is the only progress the gateway exposes.
    const elapsed = now - startedAt
    if (elapsed > 20_000 && now - lastReportAt >= 10_000) {
      lastReportAt = now
      const mark = gatewayLogMark()
      const moving = mark !== null && mark !== lastLogMark
      lastLogMark = mark
      const seconds = Math.round(elapsed / 1000)
      onProgress?.(
        moving
          ? `Still starting — the agent is setting itself up (${seconds}s)`
          : `Waiting for the agent to answer (${seconds}s)`,
      )
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return false
}

/**
 * Providers that already have a credential in this agent's auth store.
 *
 * Since OpenClaw 2026.7.x the agent resolves model credentials from a per-agent
 * store (`agents/<id>/agent/openclaw-agent.sqlite`), **not** from the
 * environment. A key in `<stateDir>/.env` reaches the gateway process but not
 * the agent, and the turn fails instantly with `missing-provider-auth` — zero
 * tokens, zero runtime, and a config that looks completely correct.
 */
export async function authorizedProviders(bin: string): Promise<Set<string>> {
  const result = await runJson<{ profiles?: { provider?: string }[] }>(
    bin,
    // `--agent` is required once a profile has more than one bot ("Multiple
    // agents are configured, but the model command has no explicit owner").
    argv(['models', 'auth', 'list', '--agent', 'main', '--json']),
    { env: openclawEnv(), timeoutMs: 60_000 },
  )
  if (!result.ok) return new Set()
  const ids = (result.data.profiles ?? [])
    .map((profile) => profile.provider)
    .filter((id): id is string => typeof id === 'string')
  return new Set(ids)
}

/** Writes a provider credential into the agent auth store. Key goes via stdin. */
export async function registerProviderAuth(
  bin: string,
  provider: string,
  apiKey: string,
): Promise<void> {
  const result = await runJson<unknown>(
    bin,
    argv(['models', 'auth', 'paste-api-key', '--agent', 'main', '--provider', provider]),
    { env: openclawEnv(), timeoutMs: 60_000, stdin: apiKey },
  )
  // The command prints human text, not JSON, so a parse miss is expected and
  // only a non-zero exit means failure.
  if (!result.ok && result.result.code !== 0) {
    throw new Error(`could not store the ${provider} credential: ${result.error}`)
  }
  log.info(`[local-runtime] auth profile stored for ${provider}`)
}

export interface ConfigLintFinding {
  checkId: string
  severity: string
  message: string
  path?: string
}

/**
 * Validates the config document on disk before anything depends on it.
 *
 * Worth the extra process spawn: an invalid config does not fail loudly at
 * write time — the gateway keeps running on its in-memory copy and then refuses
 * to come back on the next restart, which is hours later and looks unrelated.
 * One typo'd key (`discovery.mdns.enabled` instead of `.mode`) is enough.
 */
export async function lintConfig(bin: string): Promise<ConfigLintFinding[]> {
  // `config validate` is the schema check. `doctor --lint` is not: it reports
  // readiness warnings (missing skill binaries and such) and stays completely
  // silent about an invalid document — an invented provider key was written,
  // linted clean, and only surfaced later as the agent quietly running its
  // previous model.
  //
  // The command exits 1 precisely when the config is invalid, so the payload has
  // to be read regardless of exit code, and anything unreadable is reported as a
  // problem rather than as success. Failing open here means shipping a broken
  // config and calling it ready.
  const validate = (timeoutMs: number) => run(bin, argv(['config', 'validate', '--json']), { env: openclawEnv(), timeoutMs })
  let result = await validate(60_000)
  // A timeout is "unknown", not "invalid". The first CLI start after the runtime
  // unpacks can exceed a minute on Windows while Defender scans the fresh files
  // (measured on a clean VM: exit -1, then a retry that passed), so give a slow
  // cold start one longer try before reporting it.
  if (result.timedOut) result = await validate(180_000)

  const problem = (message: string): ConfigLintFinding[] => [
    { checkId: 'config/validate', severity: 'error', message },
  ]

  const start = result.stdout.search(/[{[]/)
  if (start < 0) {
    return problem(
      result.timedOut ? 'config validate did not finish within 3 minutes' : firstMeaningfulLine(result.stderr) || `config validate failed (exit ${result.code})`,
    )
  }

  let payload: { valid?: boolean; issues?: unknown[]; error?: string }
  try {
    payload = JSON.parse(result.stdout.slice(start))
  } catch {
    return problem('config validate returned malformed JSON')
  }
  if (payload.valid) return []

  const issues = Array.isArray(payload.issues) ? payload.issues : []
  if (issues.length === 0) return problem(payload.error ?? 'config is invalid')
  return issues.map((issue) => ({
    checkId: 'config/validate',
    severity: 'error',
    message: typeof issue === 'string' ? issue : JSON.stringify(issue),
  }))
}

/** Generic RPC passthrough for surfaces that are cheaper to read via the CLI. */
export async function call<T>(
  bin: string,
  method: string,
  params: unknown,
  port: number,
  token: string,
): Promise<T | null> {
  const args = argv([
    'gateway',
    'call',
    method,
    '--url',
    wsUrlFor(port),
    '--token',
    token,
    '--timeout',
    '15000',
    '--json',
  ])
  if (params !== undefined) args.push('--params', JSON.stringify(params))
  const result = await runJson<T>(bin, args, { env: openclawEnv(), timeoutMs: 30_000 })
  return result.ok ? result.data : null
}
