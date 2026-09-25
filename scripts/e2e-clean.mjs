/**
 * First-run test: a machine that has never seen ClawMuse.
 *
 * This is the scenario every other test skips. `e2e-local.mjs` runs against the
 * developer's own profile, from a terminal — so it proves nothing about the two
 * things a new user hits first:
 *
 *   1. **A GUI launch has no shell.** Finder gives an app
 *      `/usr/bin:/bin:/usr/sbin:/sbin`, so Homebrew/nvm Node is invisible and
 *      the app announces "Node is not installed" on a machine where it is.
 *   2. **Nothing is installed yet.** No `~/.openclaw-clawmuse`, no `openclaw` CLI, no
 *      config — the app has to build all of it before it can do anything.
 *
 * Simulated with a throwaway `HOME` and a Finder-like `PATH`.
 *
 * Deliberately stops before the LaunchAgent is installed: launchd labels are
 * per-user, not per-HOME, so installing here would seize the service belonging
 * to the real profile and leave the developer's agent stopped. Everything past
 * that point is already covered by `e2e-local.mjs` against a real profile.
 *
 * Usage:
 *   node scripts/e2e-clean.mjs                                   # packaged app
 *   node scripts/e2e-clean.mjs --app dist/mac-arm64/ClawMuse.app
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9240
const MILESTONE_TIMEOUT_MS = 240_000
/** Finder gives a GUI app exactly this and nothing else. */
const GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

const arg = (flag) => {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : null
}
const appBundle = arg('--app') ?? 'dist/mac-arm64/ClawMuse.app'
if (!existsSync(appBundle)) {
  console.error(`✗ ${appBundle} not found — run \`npm run dist:mac:arm\` first.`)
  process.exit(1)
}

const failures = []
function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

const home = mkdtempSync(join(tmpdir(), 'clawmuse-firstrun-'))
const profile = mkdtempSync(join(tmpdir(), 'clawmuse-firstrun-profile-'))
const logFile = join(home, 'Library', 'Logs', 'ClawMuse', 'main.log')
/** Survives the cleanup, so a failed run can be read afterwards. */
const KEPT_LOG = join(tmpdir(), 'clawmuse-firstrun.log')
const configFile = join(home, '.openclaw-clawmuse', 'openclaw.json')

function logText() {
  try {
    return readFileSync(logFile, 'utf8')
  } catch {
    return ''
  }
}

async function waitForLog(pattern, timeoutMs = MILESTONE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pattern.test(logText())) return true
    await sleep(1000)
  }
  return false
}

async function evaluateInRenderer(expression, fallback = '') {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
    if (!page) return fallback
    return await new Promise((resolve) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl)
      const done = (value) => {
        try {
          ws.close()
        } catch {
          /* already closed */
        }
        resolve(value)
      }
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: true },
          }),
        )
      ws.onmessage = (event) => {
        const frame = JSON.parse(event.data)
        if (frame.id === 1) done(frame.result?.result?.value ?? fallback)
      }
      ws.onerror = () => done(fallback)
      setTimeout(() => done(fallback), 10_000)
    })
  } catch {
    return fallback
  }
}

const rendererText = () => evaluateInRenderer('document.body.innerText')

/** Waits for the renderer's text to satisfy `predicate`, then returns it. */
async function waitForRenderer(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let body = ''
  while (Date.now() < deadline) {
    body = await rendererText()
    if (predicate(body)) return body
    await sleep(500)
  }
  return body
}

console.log(`› first run — HOME=${home}, PATH=${GUI_PATH}`)

const app = spawn(
  `${appBundle}/Contents/MacOS/${basename(appBundle, '.app')}`,
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    // `env -i` in spawn form: nothing from this shell leaks in, which is the
    // whole point — inheriting the developer's PATH would hide the bug.
    env: { PATH: GUI_PATH, HOME: home, TMPDIR: '/tmp' },
  },
)
/** Thrown to leave the milestone chain early without failing the run. */
class SkipRest extends Error {}
let stopAfterFirstScreen = false

const appLogs = []
app.stdout.on('data', (d) => appLogs.push(String(d)))
app.stderr.on('data', (d) => appLogs.push(String(d)))

try {
  // ── Asks for the one thing it genuinely cannot find ───────────────────────
  // This HOME is empty and `SHELL` is unset, so the credential scan has nowhere
  // to look: no `~/.claude`, no `~/.codex`, no `~/.openclaw`, no shell rc, no
  // model server on loopback. A machine with *no* key anywhere is the one case
  // that still needs a wizard — you cannot run a model without a credential —
  // and asking for it is the honest answer.
  //
  // What must NOT happen is the old first question, "where should ClawMuse
  // run?": that is a question about our architecture, and the app answers it
  // itself now.
  const firstScreen = await waitForRenderer(
    (body) => /choose a model|bring your own key/i.test(body),
    60_000,
  )
  check(
    'does not ask where to run — it just runs here',
    !/where should clawmuse run/i.test(firstScreen),
    firstScreen.replace(/\n/g, ' ⏎ ').slice(0, 120),
  )
  check(
    'asks for a model when this machine has no credential anywhere',
    /choose a model|bring your own key/i.test(firstScreen),
    firstScreen.replace(/\n/g, ' ⏎ ').slice(0, 120),
  )
  check(
    'nothing is installed while the question is still open',
    !existsSync(configFile) && !/installed openclaw@|gateway install/.test(logText()),
  )

  // Everything past here needs a credential to proceed with — the same one a
  // user would paste. `CLAWMUSE_E2E_KEY` supplies it; without one the install
  // chain cannot be exercised at all, and the run says so rather than passing
  // by omission.
  const key = (process.env.CLAWMUSE_E2E_KEY ?? process.env.CLAWMUSE_E2E_KEY)?.trim()
  if (!key) {
    console.log(
      '\n› no CLAWMUSE_E2E_KEY — stopping after the first screen.\n' +
        '  The runtime install, provider auth and gateway milestones below need a\n' +
        '  credential to type in. Re-run with CLAWMUSE_E2E_KEY=<openrouter key> to\n' +
        '  exercise them.',
    )
    stopAfterFirstScreen = true
    throw new SkipRest()
  }

  // The key field does not exist until a provider is chosen — it is rendered
  // by `selected &&`. Picking one first is not incidental to the test; it is
  // the step a user takes, and skipping it is what made an earlier version of
  // this run report "no key field" on a perfectly working screen.
  const pickedProvider = await evaluateInRenderer(
    `(() => {
      const hit = [...document.querySelectorAll('button')].find(n => /openrouter/i.test(n.innerText ?? ''))
      if (!hit) return false
      hit.click()
      return true
    })()`,
    false,
  )
  check('a provider can be chosen', pickedProvider === true)

  await sleep(500)
  const typed = await evaluateInRenderer(
    `(() => {
      const field = document.querySelector('input[type="password"]')
      if (!field) return false
      // React tracks the previous value on the node, so assigning \`value\`
      // directly and firing \`input\` is the only way to make a controlled
      // field actually update.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(field, ${JSON.stringify(key)})
      field.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`,
    false,
  )
  check('the key field accepts a pasted credential', typed === true)

  await sleep(500)
  const started = await evaluateInRenderer(
    `(() => {
      const hit = [...document.querySelectorAll('button')].find(n => /^save and start$/i.test((n.innerText ?? '').trim()))
      if (!hit) return 'no button'
      if (hit.disabled) return 'disabled'
      hit.click()
      return true
    })()`,
    'no renderer',
  )
  check('the first-run choice can be committed', started === true, String(started))

  check(
    'repairs PATH for a GUI launch',
    await waitForLog(/PATH repaired for GUI launch/, 60_000),
    'the app never noticed it had no usable PATH',
  )

  // The failure this replaces: "Node is not installed or not on PATH" on a
  // machine where Node is installed, because Finder gave the app no PATH.
  check(
    'does not claim Node is missing when it is installed',
    !/Node is not installed or not on PATH/.test(logText() + (await rendererText())),
  )

  check(
    'installs the OpenClaw runtime by itself',
    await waitForLog(/installed openclaw@|using openclaw .* \((managed|path)\)/),
    'no CLI install and none found',
  )

  // The deadlock this replaces: onboarding asked for a key, but the provider the
  // build ships is only seeded inside `ensure()` — which onboarding gated. The
  // first run stopped at "Choose a model" with no runtime and no way forward.
  const screen = await rendererText()
  check(
    'a bundled provider skips the key prompt',
    !/Choose a model/.test(screen),
    screen.replace(/\n/g, ' ⏎ ').slice(0, 120),
  )

  // The credential has to land in the agent's auth store, not just in `.env`.
  // Skipping this shipped a build whose very first message failed with
  // "No API key found for provider" on an otherwise perfect-looking profile.
  check(
    'stores the model credential where the agent reads it',
    await waitForLog(/auth profile stored for/, 120_000),
    'no auth profile was written',
  )

  // The provider plugin has to be on disk *before* the gateway starts. Since
  // OpenClaw 2026.7 `zai` is not compiled into the runtime, and a gateway that
  // has to npm-install it during its own boot spent four and a half minutes
  // doing so on a cold cache — against a health probe that gave up after sixty
  // seconds. Every new install failed; no developer machine ever did.
  check(
    'fetches the provider plugin before the gateway needs it',
    await waitForLog(/\[provider-plugins\] installed/, 300_000),
    'the gateway would have had to install it during startup',
  )

  check('writes a profile config', await waitForLog(/gateway install/, 120_000) && existsSync(configFile))

  // `gateway install` bootstraps a job with RunAtLoad, so launchd starts the
  // gateway itself. Running `gateway start` on top of that sweeps "stale"
  // processes and kills the one launchd just spawned — on a first run that is
  // mid-migration, and the five-minute migration lease it held outlives it, so
  // every relaunch fails until the lease expires. Measured on a wiped profile:
  // `killing 1 stale gateway process(es) before restart: 11407`, then
  // "startup migrations are already running" every ten seconds for five minutes.
  check(
    'does not start a second gateway on top of launchd’s',
    await waitForLog(/launchd already started the gateway/, 60_000),
    'the app started its own gateway and will fight the one launchd spawned',
  )

  if (existsSync(configFile)) {
    const config = JSON.parse(readFileSync(configFile, 'utf8'))
    check('binds the new gateway to loopback', config.gateway?.bind === 'loopback')
    check('gives it a model to think with', typeof config.agents?.defaults?.model?.primary === 'string')
  }
} catch (error) {
  if (!(error instanceof SkipRest)) check('first-run completed', false, String(error))
} finally {
  // Killed before the LaunchAgent lands — see the header.
  app.kill('SIGKILL')
  // The app's own log is the only record of what the runtime actually did, and
  // it lives inside the HOME this run is about to delete. Keeping a copy when
  // something failed is the difference between a diagnosis and a guess — an
  // earlier failure here read as "no CLI install" with no way to see why.
  if (failures.length > 0) {
    try {
      copyFileSync(logFile, KEPT_LOG)
      console.error(`\n› app log kept at ${KEPT_LOG}`)
    } catch {
      console.error('\n› the app wrote no log — it may have died before it started one')
    }
  }
  rmSync(home, { recursive: true, force: true })
  rmSync(profile, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n✗ first-run failed (${failures.length}):`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('\n--- app output ---')
  console.error(appLogs.join('').slice(-1500))
  try {
    console.error('\n--- runtime log (tail) ---')
    console.error(readFileSync(KEPT_LOG, 'utf8').split('\n').slice(-40).join('\n'))
  } catch {
    /* nothing was kept */
  }
  process.exit(1)
}
console.log(
  stopAfterFirstScreen
    ? '\n✓ first screen passed (install chain not exercised — no CLAWMUSE_E2E_KEY)'
    : '\n✓ first run passed',
)
