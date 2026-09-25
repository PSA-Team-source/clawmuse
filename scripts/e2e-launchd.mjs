/**
 * The install → start → health path, on a profile that has never existed.
 *
 * This is the gap that let a first-run failure reach users. `e2e-clean.mjs`
 * simulates a fresh machine but **stops right before the LaunchAgent lands**,
 * because launchd labels are per-user rather than per-HOME — installing under
 * the real label would seize the developer's own agent. So the three steps a
 * new user actually fails on (`installing-service → starting → health`) had no
 * test at all, while every developer machine skipped them entirely by attaching
 * to a gateway launchd had already been keeping alive.
 *
 * The way around the label collision is a **separate profile**: `clawmuse-e2e`
 * produces the label `ai.openclaw.clawmuse-e2e`, which cannot touch
 * `ai.openclaw.clawmuse`. State lives in a throwaway directory and the service is
 * uninstalled in `finally`, including when a check throws.
 *
 * Usage:
 *   node scripts/e2e-launchd.mjs
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createServer } from 'node:net'

const run = promisify(execFile)

/** Never `clawmuse`: that label belongs to the real agent on this machine. */
const PROFILE = 'clawmuse-e2e'
const LABEL = `ai.openclaw.${PROFILE}`
const CLI = join(homedir(), '.openclaw-clawmuse', 'runtime', 'node_modules', '.bin', 'openclaw')

const failures = []
function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

if (!existsSync(CLI)) {
  console.error(`✗ openclaw CLI not found at ${CLI} — run the app once so it installs the runtime.`)
  process.exit(1)
}

/** A port nobody is on, so a stale service cannot make this pass by accident. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

const state = mkdtempSync(join(tmpdir(), 'clawmuse-launchd-'))
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: state,
  OPENCLAW_CONFIG_PATH: join(state, 'openclaw.json'),
  OPENCLAW_WORKSPACE_DIR: join(state, 'workspace'),
}

const cli = (args, timeout = 180_000) =>
  run(CLI, ['--profile', PROFILE, ...args], { env, timeout, maxBuffer: 10 * 1024 * 1024 })

/**
 * Mirrors `readStartupFailure()` in the app: the LaunchAgent discards stderr,
 * so when a gateway dies on startup the only account of it is OpenClaw's own
 * log. A failing run must print that reason, not just "timed out".
 */
function startupFailure() {
  const dirs = [join(tmpdir(), 'openclaw'), '/tmp/openclaw', join(state, 'tmp', 'openclaw')]
  let newest = null
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith('openclaw-') || !entry.endsWith('.log')) continue
      const full = join(dir, entry)
      const { mtimeMs } = statSync(full)
      if (!newest || mtimeMs > newest.mtimeMs) newest = { full, mtimeMs }
    }
  }
  if (!newest) return null
  const lines = readFileSync(newest.full, 'utf8').split('\n').slice(-60)
  const hit = lines.reverse().find(
    (line) =>
      /\b(error|fatal|cannot find module|eaddrinuse|eacces|permission denied|uncaught|exited)\b/i.test(line) &&
      !/errorCode=INVALID_REQUEST|missing scope/i.test(line),
  )
  return hit ? `${newest.full}: ${hit.trim()}` : null
}

const port = await freePort()
console.log(`› launchd first-run — profile=${PROFILE} port=${port} state=${state}`)

try {
  // The profile needs a config before the service is installed — same ordering
  // the app uses, since the gateway refuses to start without `gateway.mode`.
  //
  // The real profile's config is the template rather than a hand-written
  // minimum: a partial document makes the gateway exit 1 and print its help,
  // which would fail this test for a reason that has nothing to do with
  // launchd. Only the port and token are replaced.
  const template = join(homedir(), '.openclaw-clawmuse', 'openclaw.json')
  if (!existsSync(template)) {
    console.log('⚠ no ~/.openclaw-clawmuse/openclaw.json to model the test profile on — skipping')
    rmSync(state, { recursive: true, force: true })
    process.exit(0)
  }
  const config = JSON.parse(readFileSync(template, 'utf8'))
  config.gateway = {
    ...config.gateway,
    port,
    auth: { mode: 'token', token: 'e2e-launchd-probe-token' },
    controlUi: { allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`] },
  }
  writeFileSync(join(state, 'openclaw.json'), JSON.stringify(config, null, 2))

  const install = await cli(['gateway', 'install', '--port', String(port), '--json'])
  check('installs the LaunchAgent', /"ok"\s*:\s*true|installed/i.test(install.stdout), install.stdout.slice(0, 200))

  check('writes the plist under the e2e label, not the real one', existsSync(plistPath()))

  // The bug this exists to catch: the plist hardcodes an absolute node path, so
  // a machine where that path does not exist installs cleanly and then never
  // starts. Verify the interpreter it points at is actually there.
  const nodePath = plistNodePath()
  check(
    'points at a node binary that exists on this machine',
    nodePath !== null && existsSync(nodePath),
    nodePath ? `plist runs ${nodePath}, which is missing` : 'no interpreter found in the plist',
  )

  // launchd must at least accept and load the job. Whether it then *stays* up
  // is deliberately not asserted here, and the reason is itself a finding:
  //
  // A gateway entering service mode kills processes it considers stale, and
  // that sweep is not scoped to a profile. Two gateways on one machine
  // therefore terminate each other on every restart — so this test cannot run a
  // second one alongside the developer's own without either being killed. The
  // condition is real and users hit it (a pre-existing `~/.openclaw` install);
  // the app now names it explicitly via `readStartupFailure()`, and
  // `gateway-log.test.ts` pins that detection.
  const loaded = await run('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`])
    .then((r) => r.stdout)
    .catch(() => '')

  check(
    'launchd accepts the generated job',
    /\bstate\s*=/.test(loaded),
    startupFailure() ?? 'launchctl does not know the label at all',
  )
} catch (error) {
  check('launchd first-run completed', false, String(error).slice(0, 300))
} finally {
  // Always: a leaked LaunchAgent would keep restarting a gateway on a temp
  // directory that no longer exists.
  await cli(['gateway', 'stop', '--json'], 60_000).catch(() => {})
  await cli(['gateway', 'uninstall', '--json'], 60_000).catch(() => {})
  await run('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]).catch(() => {})
  rmSync(plistPath(), { force: true })
  rmSync(state, { recursive: true, force: true })
}

function plistPath() {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

/** The interpreter launchd will exec — the first absolute path ending in `node`. */
function plistNodePath() {
  if (!existsSync(plistPath())) return null
  const match = /<string>(\/[^<]*\/node)<\/string>/.exec(readFileSync(plistPath(), 'utf8'))
  return match?.[1] ?? null
}

if (failures.length > 0) {
  console.error(`\n✗ launchd first-run failed (${failures.length}):`)
  for (const failure of failures) console.error(`  · ${failure}`)
  process.exit(1)
}
console.log('\n✓ launchd first run passed')
