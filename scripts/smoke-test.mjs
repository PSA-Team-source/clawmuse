/**
 * Post-build smoke test.
 *
 * Launches the packaged-mode bundle under the Chrome DevTools Protocol and
 * asserts the renderer actually mounted — a build that compiles and a window
 * that opens are not the same thing as an app that works. The preload-path bug
 * this test was written for passed typecheck, lint and `electron-vite build`
 * and still produced a completely dead UI.
 *
 * Usage:
 *   node scripts/smoke-test.mjs                       # dev bundle (out/)
 *   node scripts/smoke-test.mjs --app dist/mac-arm64/ClawMuse.app
 *
 * Running it against the packaged .app matters: path resolution differs there
 * (asar, process.resourcesPath), so a dev-only pass can still ship broken.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9223
const BOOT_TIMEOUT_MS = 30_000

const appFlagIndex = process.argv.indexOf('--app')
const appBundle = appFlagIndex !== -1 ? process.argv[appFlagIndex + 1] : null

// A throwaway profile, so the run never inherits a signed-in session from the
// developer's machine. Without it the app boots into the authenticated shell
// and — when the dev bundle runs under Electron.app, whose code signature does
// not match the packaged app's — macOS raises a blocking Keychain prompt for
// the token the packaged build stored. A clean profile has no ciphertext to
// decrypt, so `safeStorage` is never asked for it.
const profileDir = mkdtempSync(join(tmpdir(), 'clawmuse-smoke-'))
const profileArgs = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`]

const [command, args] = appBundle
  ? [`${appBundle}/Contents/MacOS/${basename(appBundle, '.app')}`, profileArgs]
  : ['npx', ['electron', '.', ...profileArgs]]

console.log(`› ${appBundle ? `packaged: ${appBundle}` : 'dev bundle'}\n`)

const electron = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })

const logs = []
electron.stdout.on('data', (d) => logs.push(String(d)))
electron.stderr.on('data', (d) => logs.push(String(d)))

const failures = []
const checks = []

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

async function findRendererTarget() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // Devtools endpoint not up yet.
    }
    await sleep(500)
  }
  return null
}

/** Minimal CDP client — one request/response per call. */
function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    const deferred = pending.get(msg.id)
    if (!deferred) return
    pending.delete(msg.id)
    deferred.resolve(msg.result)
  })

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
        // Generous: if the machine has a stored session the app boots straight
        // into the Agent Room, and building the three.js scene occupies the
        // renderer's main thread for a while before it can answer.
        setTimeout(() => reject(new Error(`${method} timed out`)), 30_000)
      })
    },
    close: () => socket.close(),
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

try {
  const target = await findRendererTarget()
  if (!target) throw new Error('renderer target never appeared')

  const client = cdp(target.webSocketDebuggerUrl)
  await client.ready

  // Give React a beat to mount and the lazy route chunk to resolve.
  await sleep(3000)

  check('preload bridge exposed', await evaluate(client, `typeof window.clawmuse === 'object'`))
  check(
    'bridge surface complete',
    await evaluate(
      client,
      `['app','secure','window','shell','notifications','updater','shortcut','runtime'].every(k => k in window.clawmuse)`,
    ),
  )

  const appInfo = await evaluate(client, `window.clawmuse.app.info()`)
  check('IPC round-trip works', Boolean(appInfo?.version), `got ${JSON.stringify(appInfo)}`)

  check('React mounted', (await evaluate(client, `document.getElementById('root')?.childElementCount ?? 0`)) > 0)

  // Which screen depends on the machine's state — a fresh profile lands on
  // local model setup, a configured one boots through to the agent room, and a
  // cloud-mode build shows sign-in. The smoke test must not care: every outcome
  // proves the renderer mounted real UI rather than a blank shell.
  // (`scripts/e2e-local.mjs` is where the local surface is actually exercised.)
  const bodyText = await evaluate(client, `document.body.innerText.slice(0, 400)`)
  const hasComposer = await evaluate(client, `Boolean(document.querySelector('[data-composer-input]'))`)
  check(
    'renders a real screen',
    hasComposer ||
      /sign in|log in|email|welcome/i.test(bodyText) ||
      /agent room|chat|tasks|connecting|starting/i.test(bodyText) ||
      /choose a model|bring your own key|on this machine/i.test(bodyText),
    bodyText.replace(/\n/g, ' ⏎ ').slice(0, 140),
  )

  check(
    // The value, not just "some value": a stylesheet that failed to load leaves
    // the variable empty and every surface falls back to transparent.
    'design tokens applied',
    ['#fff', '#ffffff'].includes(
      await evaluate(
        client,
        `getComputedStyle(document.documentElement).getPropertyValue('--color-bg-base').trim()`,
      ),
    ),
  )

  // `fonts.check` alone would report false simply because the sign-in screen
  // uses no Orbitron glyph yet. Force the load so this actually proves the
  // bundled woff2 resolves — if the asset path broke, the 3D room chrome would
  // quietly fall back to the system font instead of failing loudly.
  check(
    'Orbitron display font resolves',
    await evaluate(
      client,
      `document.fonts.load('12px Orbitron').then(faces => faces.length > 0)`,
    ),
  )

  // The entire Agent Room depends on a hardware WebGL context. Electron can
  // silently fall back to SwiftShader (software) on some GPU configs, which
  // still "works" but at a few frames per second — worth surfacing here rather
  // than discovering it as a bug report.
  const gl = await evaluate(
    client,
    `(() => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      if (!ctx) return { ok: false }
      const info = ctx.getExtension('WEBGL_debug_renderer_info')
      return {
        ok: true,
        version: ctx.getParameter(ctx.VERSION),
        renderer: info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown',
      }
    })()`,
  )
  check('WebGL context available', gl?.ok === true, JSON.stringify(gl))
  check(
    'WebGL is hardware-accelerated',
    gl?.ok === true && !/swiftshader|software|llvmpipe/i.test(String(gl.renderer)),
    `renderer: ${gl?.renderer}`,
  )

  const consoleErrors = await evaluate(
    client,
    `(window.__smokeErrors ?? []).length`,
  )
  check('no captured runtime errors', consoleErrors === 0 || consoleErrors === undefined)

  client.close()
} catch (error) {
  failures.push(`harness: ${error.message}`)
} finally {
  electron.kill()
  rmSync(profileDir, { recursive: true, force: true })
}

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

if (failures.length > 0) {
  console.error(`\n✗ smoke test failed (${failures.length}):`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('\n--- app output ---')
  console.error(logs.join('').slice(0, 3000))
  process.exit(1)
}

console.log(`\n✓ smoke test passed (${checks.length} checks)`)
process.exit(0)
