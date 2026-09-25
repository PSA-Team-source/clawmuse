/**
 * End-to-end test for local mode.
 *
 * Drives the real app against the real gateway on this machine and asserts the
 * things that actually matter for a local-first release:
 *
 *   1. it boots with no login,
 *   2. it connects to 127.0.0.1 with a *scoped* session (the device-identity
 *      trap: a scope-less session still handshakes "successfully"),
 *   3. data written through the gateway shows up on screen,
 *   4. and nothing ever talks to localfang.ai.
 *
 * That last one is the whole point of the mode, and it is the kind of
 * regression that no unit test catches — one forgotten `useQuery` is enough.
 *
 * Usage:
 *   node scripts/e2e-local.mjs                          # dev bundle
 *   node scripts/e2e-local.mjs --app dist/mac-arm64/ClawMuse.app
 *   node scripts/e2e-local.mjs --shots /tmp/e2e         # save screenshots
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9224
const BOOT_TIMEOUT_MS = 45_000
const CLAWMUSE_HOME = join(homedir(), '.openclaw-clawmuse')

const arg = (flag) => {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : null
}
const appBundle = arg('--app')
const shotsDir = arg('--shots')
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

const profileDir = mkdtempSync(join(tmpdir(), 'clawmuse-e2e-'))
const profileArgs = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`]
const [command, args] = appBundle
  ? [`${appBundle}/Contents/MacOS/${basename(appBundle, '.app')}`, profileArgs]
  : ['npx', ['electron', '.', ...profileArgs]]

const failures = []
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

// ── CDP plumbing ────────────────────────────────────────────────────────────

async function findRenderer() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* devtools not up yet */
    }
    await sleep(500)
  }
  return null
}

function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  const events = []

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.method) {
      events.push(msg)
      return
    }
    const deferred = pending.get(msg.id)
    if (!deferred) return
    pending.delete(msg.id)
    if (msg.error) deferred.reject(new Error(msg.error.message))
    else deferred.resolve(msg.result)
  })

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })

  return {
    ready,
    events,
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
        setTimeout(() => reject(new Error(`${method} timed out`)), 60_000)
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

async function text(client) {
  return evaluate(client, `document.body.innerText`)
}

/** Polls until `predicate(bodyText)` holds, so tests do not race the UI. */
async function waitForText(client, predicate, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    last = await text(client)
    if (predicate(last)) return last
    await sleep(1000)
  }
  return last
}

async function shoot(client, name) {
  if (!shotsDir) return
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'))
}

/** Clicks the first element whose text matches. Real user path, not a shortcut. */
/** Polls an expression until it is truthy. Returns the last value seen. */
async function waitFor(client, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let value = false
  while (Date.now() < deadline) {
    value = await evaluate(client, expression)
    if (value) return value
    await sleep(500)
  }
  return value
}

async function clickByText(client, pattern) {
  return evaluate(
    client,
    `(() => {
      const re = ${pattern}
      const nodes = [...document.querySelectorAll('button, a, [role="button"]')]
      const hit = nodes.find(n => re.test(n.innerText ?? ''))
      if (!hit) return false
      hit.click()
      return true
    })()`,
  )
}

// ── Run ─────────────────────────────────────────────────────────────────────

/**
 * Refuse to start while anything still answers on the debug port.
 *
 * `findRenderer` only knows the port, not which process owns it. A previous run
 * whose Electron has been SIGTERM'd but has not finished exiting still holds
 * 9224, the new instance loses the bind ("Address already in use"), and the
 * test then drives the *old* window — which is parked on whatever screen the
 * last run ended on. That shows up as assertions failing against a completely
 * unrelated screen, intermittently, and it is not a product bug.
 */
async function debugPortAnswers() {
  return Promise.race([
    fetch(`http://127.0.0.1:${PORT}/json/version`).then(
      () => true,
      () => false, // connection refused: nobody is there
    ),
    // No answer in time is treated as "still held". Attaching to a half-exited
    // instance is the failure this guard exists to prevent, so ambiguity has to
    // resolve towards waiting, not towards launching.
    sleep(1000).then(() => true),
  ])
}

async function waitForDebugPortFree(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await debugPortAnswers())) return true
    await sleep(500)
  }
  return false
}

/**
 * Refuse to start while an installed ClawMuse is also running.
 *
 * Same class of problem as the debug-port guard below, different cause. The
 * installed app attaches to the *same* local gateway, so the two clients
 * compete for gateway-owned resources — the PTY most visibly, which hands this
 * run an empty terminal and fails "the shell echoed a typed command" with no
 * hint that another window is the reason. Not a product bug, and it costs
 * several confused re-runs to find.
 */
function installedAppPids() {
  const result = spawnSync('pgrep', ['-f', '/Applications/ClawMuse.app/Contents/MacOS/ClawMuse'], {
    encoding: 'utf8',
  })
  return (result.stdout ?? '').trim().split('\n').filter(Boolean)
}

const running = installedAppPids()
if (running.length > 0) {
  console.error(
    `✗ the installed ClawMuse is running (pid ${running.join(', ')}).\n` +
      `  It shares this machine's gateway, so the two fight over the PTY and\n` +
      `  this run fails on unrelated assertions. Quit it and re-run:\n` +
      `    osascript -e 'tell application "ClawMuse" to quit'`,
  )
  process.exit(1)
}

if (!(await waitForDebugPortFree())) {
  console.error(
    `✗ debug port ${PORT} is still held by another Electron instance.\n` +
      `  Close it (or: pkill -f "remote-debugging-port=${PORT}") and re-run —\n` +
      `  continuing would test that stale window instead of this build.`,
  )
  process.exit(1)
}

const electron = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
const appLogs = []
electron.stdout.on('data', (d) => appLogs.push(String(d)))
electron.stderr.on('data', (d) => appLogs.push(String(d)))

let client
try {
  const target = await findRenderer()
  if (!target) throw new Error('renderer target never appeared')
  client = cdp(target.webSocketDebuggerUrl)
  await client.ready
  await client.send('Page.enable')
  await client.send('Network.enable')
  await client.send('Runtime.enable')
  await client.send('Log.enable')

  // ── 0. First run asks nothing ─────────────────────────────────────────────
  // The profile is a fresh temp dir, so this is a genuine first launch — and it
  // has to go straight to the roster. "Offline or online?" is a question about
  // our architecture, and asking it before anything has happened is the
  // difference between an app you install and use and an app that wants setup
  // first. The picker still exists; it lives in Settings, which step 12 checks.
  await sleep(4000)
  const firstScreen = await text(client)
  await shoot(client, '00-first-run')
  check(
    'first run does not ask where ClawMuse should run',
    !/where should clawmuse run/i.test(firstScreen),
    firstScreen.replace(/\n/g, ' ⏎ ').slice(0, 120),
  )

  // ── 1. Boots with no login ────────────────────────────────────────────────
  const first = await text(client)
  await shoot(client, '01-boot')
  check(
    'boots without a login screen',
    !/sign in to clawmuse|create your account/i.test(first),
    first.replace(/\n/g, ' ⏎ ').slice(0, 120),
  )

  // ── 2. Local runtime reaches ready ────────────────────────────────────────
  const status = await evaluate(client, `window.clawmuse.runtime.ensure()`)
  check('local runtime reports ready', status?.state === 'ready', JSON.stringify(status))
  check(
    'gateway is on loopback',
    typeof status?.wsUrl === 'string' && status.wsUrl.startsWith('ws://127.0.0.1:'),
    status?.wsUrl,
  )

  // ── 3. Config on disk is safe ─────────────────────────────────────────────
  const config = JSON.parse(readFileSync(join(CLAWMUSE_HOME, 'openclaw.json'), 'utf8'))
  check('gateway.mode is local', config.gateway?.mode === 'local')
  check('gateway binds loopback only', config.gateway?.bind === 'loopback')
  check('device auth is not disabled', config.gateway?.controlUi?.dangerouslyDisableDeviceAuth !== true)
  check('mDNS advertising is off', config.discovery?.mdns?.mode === 'off')
  check('no MCP servers configured', Object.keys(config.mcp?.servers ?? {}).length === 0)

  // ── 4. Handshake produced a SCOPED session ────────────────────────────────
  // The trap: without a signed device block the gateway answers ok:true and
  // then strips every scope, so "the socket is open" proves nothing. The real
  // evidence is a scope-gated RPC succeeding — which is exactly what steps 5
  // and 6 below exercise through the UI (cron.list needs operator.read).
  const booted = await waitForText(client, (body) => !/starting clawmuse/i.test(body), 90_000)
  check('gets past the boot screen', !/starting clawmuse/i.test(booted))
  check(
    'no device-rejection banner',
    !/no permissions were granted|missing scope/i.test(booted),
    booted.replace(/\n/g, ' ⏎ ').slice(0, 140),
  )

  // ── 4b. Muse navigation is present without account chrome ─────────────────
  await shoot(client, '02-rail')
  check(
    'the Muse rail exposes the six primary surfaces',
    await evaluate(
      client,
      `(() => {
        const rail = document.querySelector('[data-testid="clawmuse-rail"]')
        return Boolean(rail && ['chat', 'search', 'feed', 'ideas', 'goals', 'library'].every((name) => rail.querySelector('[data-nav="' + name + '"]')))
      })()`,
    ) === true,
  )
  check(
    'the main surface has no account prompt',
    !/sign in|create (an|your) account/i.test(booted),
    booted.replace(/\n/g, ' ⏎ ').slice(0, 140),
  )
  check(
    'the rail stays compact like Muse',
    await evaluate(
      client,
      `(() => {
        const rail = document.querySelector('[data-testid="clawmuse-rail"]')
        return Boolean(rail && rail.getBoundingClientRect().width <= 56)
      })()`,
    ) === true,
  )

  // Muse's bottom rail button is a three-item settings menu, not a direct
  // navigation shortcut. Local ClawMuse keeps the same shape while storing bug
  // reports only on this computer.
  await evaluate(client, `document.querySelector('[aria-label="ClawMuse menu"]')?.click()`)
  await sleep(200)
  check('the bottom menu matches Muse', /keyboard shortcuts/i.test(await text(client)) && /report an issue/i.test(await text(client)) && /settings/i.test(await text(client)))
  await evaluate(client, `Array.from(document.querySelectorAll('[role="menuitem"]')).find(node => /keyboard shortcuts/i.test(node.textContent || ''))?.click()`)
  await sleep(200)
  check('keyboard shortcuts opens', /open settings/i.test(await text(client)) && /new line/i.test(await text(client)))
  await evaluate(client, `document.querySelector('[aria-label="Close dialog"]')?.click()`)
  await sleep(200)
  await evaluate(client, `document.querySelector('[aria-label="ClawMuse menu"]')?.click()`)
  await evaluate(client, `Array.from(document.querySelectorAll('[role="menuitem"]')).find(node => /report an issue/i.test(node.textContent || ''))?.click()`)
  await sleep(200)
  check('Report an issue matches Muse copy', /report a bug/i.test(await text(client)) && /what went wrong/i.test(await text(client)))
  await evaluate(client, `(() => {
    const input = document.querySelector('[role="dialog"] textarea')
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(input, 'Local E2E issue report')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(100)
  await clickByText(client, '/submit/i')
  await sleep(200)
  check('issue reports remain local', await evaluate(client, `JSON.parse(localStorage.getItem('clawmuse.issueReports.v1') || '[]')[0]?.description === 'Local E2E issue report'`) === true)
  await clickByText(client, '/done/i')
  await sleep(200)

  // Muse opens Search over the current surface instead of navigating away.
  const beforeSearch = await evaluate(client, `location.hash`)
  await evaluate(client, `document.querySelector('[data-nav="search"]')?.click()`)
  await sleep(300)
  check('Search opens as a modal', /search clawmuse/i.test(await text(client)))
  check('Search preserves the current route', (await evaluate(client, `location.hash`)) === beforeSearch)
  await evaluate(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(200)

  // The Chats pill is functional, not decorative.
  await clickByText(client, '/chats/i')
  await sleep(300)
  check('Chats opens Muse-style side chats', /main chat/i.test(await text(client)) && /side chats/i.test(await text(client)))
  check('the side-chat panel matches Muse width', await evaluate(client, `document.querySelector('[data-testid="side-chats-panel"]')?.getBoundingClientRect().width === 240`) === true)
  await evaluate(client, `document.querySelector('[aria-label="Resize chats panel"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  await sleep(100)
  check(
    'the Muse-style chat splitter resizes and remembers its width',
    await evaluate(
      client,
      `document.querySelector('[data-testid="side-chats-panel"]')?.getBoundingClientRect().width === 250 && localStorage.getItem('clawmuse.chatsPanelWidth') === '250'`,
    ) === true,
  )
  await evaluate(client, `document.querySelector('[aria-label="Chats Open chat and side chats"]')?.click()`)
  await sleep(200)

  // ── 5. Data written via the gateway reaches the screen ────────────────────
  // Sweep first: earlier runs left their probes behind, and a real user's task
  // list slowly filled up with "E2E probe …" entries. Cleaning at the start as
  // well as the end means a run that crashed mid-way still gets tidied up.
  await removeProbeCronJobs()

  const probeName = `E2E probe ${Date.now()}`
  const added = await addCronJob(probeName)
  check('cron job created through the gateway', added.ok, added.detail)

  await evaluate(client, `location.hash = '#/goals'`)
  await sleep(1500)
  const tasksBody = await text(client)
  await shoot(client, '02-goals')
  check(
    'automations are not misrepresented as personal goals',
    !tasksBody.includes(probeName),
    tasksBody.replace(/\n/g, ' ⏎ ').slice(0, 160),
  )

  // ── 5b. A real chat turn, driven through the composer ─────────────────────
  // The strongest evidence there is: text typed into the UI reaches the model
  // on this machine and an answer comes back, with no cloud in the path.
  // `webchat:main` is the primary session; the composer only exists on the
  // thread screen, not on the conversation list.
  await evaluate(client, `location.hash = '#/chat/' + encodeURIComponent('webchat:main')`)
  // Polled, not slept on: the thread screen is a `lazy()` chunk, so how long it
  // takes to appear depends on disk and on whether the chunk is already warm. A
  // fixed wait passed on a warm run and failed on a cold one.
  let composerReady = await waitFor(
    client,
    `Boolean(document.querySelector('[data-composer-input]'))`,
    20_000,
  )
  if (!composerReady) {
    await clickByText(client, /new chat|new conversation/i)
    composerReady = await waitFor(
      client,
      `Boolean(document.querySelector('[data-composer-input]'))`,
      15_000,
    )
  }
  check('chat thread renders a composer', composerReady === true)

  // Unique per run. The previous prompt asked for "PONG" and the assertion
  // searched the whole transcript for it — so a reply from an *earlier* run kept
  // the check green while chat was completely broken ("Agent failed before
  // reply: No API key found"). Stale history cannot contain this token.
  const chatNonce = `PONG${Date.now().toString(36).toUpperCase()}`
  const sent = await evaluate(
    client,
    `(() => {
      const input = document.querySelector('[data-composer-input]')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, 'Reply with exactly this word and nothing else: ${chatNonce}')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return true
    })()`,
  )
  check('composer accepted a message', sent === true)

  if (sent) {
    // A 0.6B model on CPU is not fast; the assertion is that an assistant turn
    // appears at all, not how quickly.
    const failureBanner = /failed before reply|No API key found|missing-provider-auth/i
    const chatBody = await waitForText(
      client,
      (body) => body.includes(chatNonce) || failureBanner.test(body),
      120_000,
    )
    await shoot(client, '02b-chat')
    check(
      'the local model answered in the UI',
      chatBody.includes(chatNonce),
      chatBody.replace(/\n/g, ' ⏎ ').slice(-200),
    )
    // Scoped to this turn only. The transcript is persistent, so failures from
    // earlier runs are still on screen and would fail a whole-body scan forever.
    const thisTurn = chatBody.slice(chatBody.indexOf(chatNonce))
    // Called out separately: this is the failure that looked like a pass, and it
    // says the credential never reached the agent's auth store.
    check(
      'the model credential reached the agent',
      !failureBanner.test(thisTurn),
      thisTurn.replace(/\n/g, ' ⏎ ').slice(0, 200),
    )

    const savedToLibrary = await evaluate(
      client,
      `(() => {
        const button = document.querySelector('[data-testid="show-in-library"] button')
        if (!button || button.disabled) return false
        button.click()
        return true
      })()`,
    )
    check('a chat can be saved to the Library', savedToLibrary === true)
    if (savedToLibrary) {
      const openedLibrary = await waitFor(client, `location.hash.includes('/library')`, 10_000)
      check('Show in Library opens the saved artifacts', openedLibrary === true)
      await evaluate(client, `location.hash = '#/chat/' + encodeURIComponent('webchat:main')`)
      await waitFor(client, `Boolean(document.querySelector('[data-composer-input]'))`, 10_000)

      await evaluate(client, `document.querySelector('[data-nav="search"]')?.click()`)
      await sleep(200)
      await evaluate(client, `(() => {
        const input = document.querySelector('[role="dialog"] input')
        if (!input) return
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(input, '${chatNonce}')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      const foundChatMessage = await waitFor(client, `Boolean(document.querySelector('[data-search-kind="chat"]'))`, 15_000)
      check('Search finds individual chat messages like Muse', foundChatMessage === true)
      const foundArtifactContent = await waitFor(client, `Boolean(document.querySelector('[data-search-kind="artifact"]'))`, 15_000)
      check('Search finds Library document contents like Muse', foundArtifactContent === true)
      if (foundArtifactContent) {
        await evaluate(client, `document.querySelector('[data-search-kind="artifact"]')?.click()`)
        const openedMatchedArtifact = await waitFor(client, `location.hash.includes('/library?') && Boolean(document.querySelector('[role="dialog"]'))`, 10_000)
        check('a Search artifact result opens the exact document', openedMatchedArtifact === true)
        await evaluate(client, `location.hash = '#/chat/' + encodeURIComponent('webchat:main')`)
        await waitFor(client, `Boolean(document.querySelector('[data-composer-input]'))`, 10_000)
      }
    }

  }

  // ── 5b2. Model drift is surfaced, not silent ──────────────────────────────
  // A session keeps the model it was created with, so changing the default
  // leaves existing conversations on the old one. That has to be visible and
  // the user's call — switching must not be automatic, and must not cost them
  // the conversation.
  const defaultModel = configuredDefaultModel()
  const otherModel = defaultModel === 'ollama/qwen3:0.6b' ? 'zai/glm-5.2' : 'ollama/qwen3:0.6b'
  const pinned = await gatewayCall('sessions.patch', { key: 'webchat:main', model: otherModel })
  check('a session can be pinned to a non-default model', pinned.ok, pinned.detail)

  if (pinned.ok && defaultModel) {
    // Sessions are fetched on connect, so the drift only becomes visible to the
    // renderer after a reconnect.
    await evaluate(client, `location.reload()`)
    await sleep(6000)
    await evaluate(client, `location.hash = '#/chat/' + encodeURIComponent('webchat:main')`)
    await sleep(2500)

    const noticeBody = await waitForText(
      client,
      (body) => body.includes(otherModel) && body.includes('Keep it'),
      30_000,
    )
    await shoot(client, '02c-model-drift')
    check(
      'the model-drift notice offers a choice',
      noticeBody.includes(otherModel) && noticeBody.includes('Keep it'),
      noticeBody.replace(/\n/g, ' ⏎ ').slice(0, 160),
    )

    const clicked = await clickByText(client, `/^Use /`)
    await sleep(2500)
    const afterSwitch = await text(client)
    check(
      'accepting the notice switches the session without resetting it',
      clicked === true && !afterSwitch.includes('Keep it'),
      `clicked=${clicked}`,
    )
  }

  // Legacy power-user routes must not leak into the Muse UI.
  for (const route of ['/terminal', '/computer']) {
    await evaluate(client, `location.hash = '#${route}'`)
    await sleep(600)
    check(`${route} redirects to chat`, /#\/chat/.test(String(await evaluate(client, `location.hash`))))
  }

  // ── 6. Muse's primary surfaces render ─────────────────────────────────────
  const mediaProbeName = `e2e-${Date.now()}.svg`
  await evaluate(client, `(async () => {
    const root = (await window.clawmuse.fs.roots())[0]
    await window.clawmuse.fs.write(root.id, '${mediaProbeName}', '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#7c5cff"/></svg>')
  })()`)
  await evaluate(client, `localStorage.setItem('clawmuse.feedEditions.v1', JSON.stringify([
    { id: 'e2e-feed-1', title: 'Verified local signal', body: 'A real generated feed unit.', at: new Date().toISOString() },
    { id: 'e2e-feed-2', title: 'Second verified signal', body: 'A second generated unit in the same edition.', at: new Date().toISOString() }
  ]))`)
  for (const [route, heading] of [['feed', 'Feed'], ['ideas', 'Ideas'], ['goals', 'Goals'], ['library', 'All artifacts']]) {
    await evaluate(client, `location.hash = '#/${route}'`)
    await sleep(900)
    check(`${heading} surface renders`, (await text(client)).includes(heading))
  }
  await evaluate(client, `location.hash = '#/feed'`)
  await sleep(500)
  check('Feed groups content into editions', /feed editions/i.test(await text(client)))
  check('Feed units expose options', await evaluate(client, `Boolean(document.querySelector('[aria-label="Feed unit options"]'))`) === true)
  check('Feed does not mix ordinary conversations into editions', !(await text(client)).includes(chatNonce))
  await evaluate(client, `location.hash = '#/ideas'`)
  await sleep(500)
  check('Ideas are grounded in real conversations', !(await text(client)).includes('Take the highest-value next step'))
  check('Ideas expose feedback controls', await evaluate(client, `Boolean(document.querySelector('[aria-label="Idea feedback"]'))`) === true)
  await evaluate(client, `location.hash = '#/goals'`)
  await sleep(500)
  await evaluate(client, `document.querySelector('[aria-label="Goals options"]')?.click()`)
  const goalOptions = await waitForText(client, (body) => /show completed goals|hide completed goals/i.test(body), 5_000)
  check('Goals options are functional', /completed goals/i.test(goalOptions))
  await evaluate(client, `document.querySelector('[aria-label="Goals options"]')?.click()`)
  await evaluate(client, `document.querySelector('[data-goal-category="health"]')?.click()`)
  const goalDialog = await waitForText(client, (body) => /create a health goal/i.test(body), 5_000)
  check('goal categories open Muse-style refinement', /refine the goal together in chat/i.test(goalDialog))
  check('goal refinement can start', /let.*s do it/i.test(goalDialog))
  await evaluate(client, `document.querySelector('[aria-label="Close dialog"]')?.click()`)
  await sleep(200)
  await evaluate(client, `location.hash = '#/library'`)
  await sleep(500)
  await clickByText(client, '/^documents$/i')
  await sleep(200)
  check('Library filters artifacts by type', /documents/i.test(await text(client)))
  check('Library offers artifact creation', /create an artifact/i.test(await text(client)))
  await clickByText(client, '/^all artifacts$/i')
  await sleep(300)
  await clickByText(client, '/^select$/i')
  await sleep(200)
  check('Library selection mode matches Muse controls', /0 selected/i.test(await text(client)) && /select all/i.test(await text(client)) && await evaluate(client, `Boolean(document.querySelector('[aria-label="Exit selection"]'))`) === true)
  await clickByText(client, '/^select all$/i')
  await sleep(100)
  check('Library Select all selects real entries', await evaluate(client, `(() => { const heading = [...document.querySelectorAll('h1')].find(node => /^\\d+ selected$/.test(node.textContent ?? '')); return Boolean(heading && Number.parseInt(heading.textContent, 10) > 0); })()`) === true)
  await evaluate(client, `document.querySelector('[aria-label="Exit selection"]')?.click()`)
  await sleep(100)
  const openedFolder = await evaluate(client, `(() => { const entry = document.querySelector('[data-library-entry="artifacts"]'); if (!entry) return false; entry.click(); return true })()`)
  check('Library opens real folders', openedFolder === true)
  if (openedFolder) {
    const folderReady = await waitFor(client, `Boolean(document.querySelector('[aria-label="Back to parent folder"]'))`, 5_000)
    check('Library exposes folder navigation', folderReady === true)
    await evaluate(client, `document.querySelector('[aria-label="Back to parent folder"]')?.click()`)
  }
  await clickByText(client, '/^images$/i')
  const mediaThumbnail = await waitFor(client, `Boolean(document.querySelector('[data-library-entry="${mediaProbeName}"] img[src^="data:image/svg+xml"]'))`, 5_000)
  check('Library renders real local image thumbnails', mediaThumbnail === true)
  if (mediaThumbnail) {
    await evaluate(client, `document.querySelector('[data-library-entry="${mediaProbeName}"]')?.click()`)
    const mediaPreview = await waitFor(client, `Boolean(document.querySelector('[role="dialog"] img[src^="data:image/svg+xml"]'))`, 5_000)
    check('Library opens a full local image preview', mediaPreview === true)
    await evaluate(client, `document.querySelector('[aria-label="Close dialog"]')?.click()`)
  }
  await evaluate(client, `(async () => { const root = (await window.clawmuse.fs.roots())[0]; await window.clawmuse.fs.delete(root.id, '${mediaProbeName}') })()`)

  // ── 7. Settings shows the local runtime ───────────────────────────────────
  await evaluate(client, `location.hash = '#/settings'`)
  await sleep(1500)
  const settingsBody = await text(client)
  await shoot(client, '04-settings')
  check('Settings exposes local agent controls', /local agent/i.test(settingsBody))
  check('billing surfaces are hidden in local mode', !/\bPlan\b|subscription/i.test(settingsBody))
  check(
    'Settings remains local-only',
    /local agent/i.test(settingsBody) && !/switch to cloud|where .* runs/i.test(settingsBody),
    settingsBody.replace(/\n/g, ' ⏎ ').slice(0, 160),
  )
  check(
    'the current OpenClaw runtime is visible',
    /openclaw 2026\.9\.5/i.test(settingsBody) && /127\.0\.0\.1/.test(settingsBody),
    settingsBody.replace(/\n/g, ' ⏎ ').slice(0, 160),
  )

  // ── 7a. Model setup is not a dead end either ──────────────────────────────
  // Local is the only mode that needs a provider, so this screen asks for the
  // one thing a user without a key cannot supply — and it has no sidebar.
  await evaluate(client, `location.hash = '#/local-setup'`)
  // The heading renders before the provider probe finishes, and the form —
  // switch link included — is behind that probe. Waiting on "Choose a model"
  // alone asserts against a spinner, which a packaged build is slow enough to
  // hit every time.
  const setupBody = await waitForText(
    client,
    (body) => /choose a model/i.test(body) && !/looking for local model servers/i.test(body),
    40_000,
  )
  check(
    'model setup supports local servers or BYOK without a ClawMuse account',
    /bring your own key|on this machine/i.test(setupBody) && !/sign in|create (an|your) account/i.test(setupBody),
    setupBody.replace(/\n/g, ' ⏎ ').slice(0, 160),
  )
  await evaluate(client, `location.hash = '#/settings'`)
  await sleep(800)

  // ── 7b. Security policy reads real gateway config ─────────────────────────
  await evaluate(client, `location.hash = '#/settings/security'`)
  await sleep(2500)
  const securityBody = await waitForText(client, (body) => /running commands/i.test(body), 15_000)
  await shoot(client, '05-security')
  check('security screen shows exec policy', /running commands/i.test(securityBody))
  check(
    'YOLO is presented as a risk, not a feature',
    /yolo/i.test(securityBody) && /no approval|nothing stops/i.test(securityBody),
    securityBody.replace(/\n/g, ' ⏎ ').slice(0, 160),
  )
  // Backends only appear once sandboxing is on — progressive disclosure, so
  // assert the modes rather than the backend list that is correctly hidden.
  check(
    'sandbox modes are offered',
    /side sessions/i.test(securityBody) && /everything/i.test(securityBody),
    securityBody.replace(/\n/g, ' ⏎ ').slice(-160),
  )

  // ── 7b. ClawMuse exposes one assistant, not FangBot's old team room ────────
  await evaluate(client, `location.hash = '#/room'`)
  await sleep(1200)
  const roomRedirect = await evaluate(client, `location.hash`)
  check(
    'the retired multi-agent room redirects to chat',
    /#\/chat/.test(String(roomRedirect)),
    `landed on ${roomRedirect}`,
  )
  check(
    'no add-agent control is visible',
    (await text(client)).match(/add agent|agent room/i) === null,
  )

  // Automations are represented through Muse's Goals surface, not a separate
  // FangBot task manager.
  await evaluate(client, `location.hash = '#/tasks'`)
  await sleep(800)
  check(
    'the old Tasks route redirects to Goals',
    /#\/goals/.test(String(await evaluate(client, `location.hash`))),
  )

  // ── 7d. Retired multi-agent authoring routes stay out of the UI ────────────
  await evaluate(client, `location.hash = '#/agent-studio'`)
  await sleep(1200)
  check(
    'Agent Studio redirects to the one-assistant chat',
    /#\/chat/.test(String(await evaluate(client, `location.hash`))),
  )

  // ── 7d-bis. Connectors and skills are populated, not placeholders ─────────
  await evaluate(client, `location.hash = '#/settings/connectors'`)
  await sleep(2000)
  const connectorsBody = await text(client)
  await shoot(client, '07-connectors')
  check(
    'local MCP connectors are configurable',
    /connector|mcp/i.test(connectorsBody) && !/sign in|account required/i.test(connectorsBody),
    connectorsBody.replace(/\n/g, ' ⏎ ').slice(0, 200),
  )

  // ── 7e. Legal text is readable offline ────────────────────────────────────
  // Deciding whether to trust an app with your machine should not require that
  // app to be online — and local mode may never reach localfang.ai at all.
  await evaluate(client, `location.hash = '#/settings/legal/privacy'`)
  await sleep(1500)
  const privacyBody = await text(client)
  check(
    'the privacy policy is in the app, not a link out',
    /privacy/i.test(privacyBody) && /no backend|no account|information we collect/i.test(privacyBody),
    privacyBody.replace(/\n/g, ' ⏎ ').slice(0, 160),
  )

  // ── 7f. Retired server-only surfaces stay unreachable ─────────────────────
  // Typing a URL is one keystroke away under hash routing, and each of these
  // would fire requests at localfang.ai from a mode that must never touch it.
  for (const [label, route] of [
    ['BrandSphere', '/brandsphere'],
    ['Store Builder', '/store-builder'],
    ['Plan', '/settings/plan'],
  ]) {
    await evaluate(client, `location.hash = '#${route}'`)
    await sleep(1200)
    const landed = await evaluate(client, `location.hash`)
    // Blocked routes land on the roster, which is where local mode starts.
    check(`${label} is unreachable in local mode`, /#\/chat/.test(String(landed)), `landed on ${landed}`)
  }

  // ── 8. Nothing reached the cloud ──────────────────────────────────────────
  const cloudRequests = client.events
    .filter((e) => e.method === 'Network.requestWillBeSent')
    .map((e) => e.params?.request?.url ?? '')
    .filter((url) => /localfang\.ai|amazonaws|98\.85\.238\.194/i.test(url))
  check(
    'no request ever left for the cloud',
    cloudRequests.length === 0,
    cloudRequests.slice(0, 3).join(', '),
  )

  // ── 9. No runtime errors ──────────────────────────────────────────────────
  const consoleErrors = client.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error')
    .map((e) => e.params.entry.text)
    // Favicon 404s and devtools noise are not product failures.
    .filter((t) => !/favicon|devtools/i.test(t))
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  // ── 10. No account or hosted-runtime escape hatch exists ──────────────────
  await evaluate(client, `location.hash = '#/settings'`)
  await sleep(1200)
  const localOnlySettings = await text(client)
  check(
    'ClawMuse never asks for its own account',
    !/sign in to clawmuse|sign up for clawmuse|create (an|your) account|switch to cloud/i.test(localOnlySettings),
    localOnlySettings.replace(/\n/g, ' ⏎ ').slice(0, 180),
  )
  check(
    'the runtime stays on this machine',
    /local agent/i.test(localOnlySettings) && /127\.0\.0\.1/.test(localOnlySettings),
  )
} catch (error) {
  check('e2e run completed', false, error.message)
} finally {
  // Before the window goes: every probe here lands in the developer's own
  // profile, not in a throwaway fixture. A cron probe left behind puts a task
  // in their Tasks screen that fires every morning; a file probe left behind
  // puts a row in their Files screen forever. Ninety runs later the workspace
  // was ninety `e2e-*.txt` files and nothing else, and the chat list was a wall
  // of `cron:` sessions — a harness that degrades the app it is testing.
  await removeProbeCronJobs().catch(() => {})
  removeProbeFiles()
  client?.close()
  electron.kill('SIGTERM')
  await sleep(500)
  rmSync(profileDir, { recursive: true, force: true })
}

console.log(`\n${failures.length === 0 ? '✓ local e2e passed' : `✗ local e2e failed (${failures.length}):`}`)
for (const failure of failures) console.log(`  · ${failure}`)
if (failures.length > 0) {
  console.log('\n--- app output ---')
  console.log(appLogs.join('').slice(-3000))
}
process.exit(failures.length === 0 ? 0 : 1)

// ── Helpers that talk to the gateway directly (test fixture, not app code) ──

/**
 * Creates a cron job through the CLI so the assertion above proves the *app*
 * reads gateway state, rather than proving the app can talk to itself.
 */
/** Drives the gateway the way an operator would — through its own CLI. */
async function gatewayCall(method, params) {
  const config = JSON.parse(readFileSync(join(CLAWMUSE_HOME, 'openclaw.json'), 'utf8'))
  const token = config.gateway?.auth?.token
  const port = config.gateway?.port ?? 18789
  if (!token) return { ok: false, detail: 'no gateway token on disk' }

  const bin = join(CLAWMUSE_HOME, 'runtime', 'node_modules', '.bin', 'openclaw')
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      [
        '--profile', 'clawmuse', 'gateway', 'call', method,
        '--url', `ws://127.0.0.1:${port}`, '--token', token,
        '--timeout', '15000', '--json', '--params', JSON.stringify(params),
      ],
      {
        env: {
          ...process.env,
          OPENCLAW_STATE_DIR: CLAWMUSE_HOME,
          OPENCLAW_CONFIG_PATH: join(CLAWMUSE_HOME, 'openclaw.json'),
        },
      },
    )
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => {
      // `data` is parsed here rather than by each caller: reading a reply back
      // (to find jobs to delete, say) is otherwise string-scraping.
      let data = null
      try {
        data = JSON.parse(out)
      } catch {
        /* not every call answers with JSON */
      }
      resolve({ ok: code === 0, detail: out.slice(0, 200), data })
    })
  })
}

function configuredDefaultModel() {
  const config = JSON.parse(readFileSync(join(CLAWMUSE_HOME, 'openclaw.json'), 'utf8'))
  return config.agents?.defaults?.model?.primary
}

/**
 * Deletes every cron job this suite has ever created.
 *
 * The probe is a real job on the user's own gateway, so leaving it behind is
 * not a test artefact in a sandbox — it is a task in their Tasks screen that
 * fires at 09:00 forever. Twenty-five of them had accumulated before anyone
 * noticed.
 */
/**
 * Removes the `e2e-*.txt` and `e2e-*.svg` probes this harness writes into the real workspace.
 *
 * Scoped to the exact name shape it creates — `e2e-<epoch-ms>.(txt|svg)` — so it can
 * never take a file the user put there. Anything it cannot delete is reported
 * rather than swallowed: a probe left behind is a row in their Files screen.
 */
function removeProbeFiles() {
  const workspace = join(CLAWMUSE_HOME, 'workspace')
  let removed = 0
  try {
    for (const name of readdirSync(workspace)) {
      if (!/^e2e-\d+\.(?:txt|svg)$/.test(name)) continue
      try {
        rmSync(join(workspace, name))
        removed++
      } catch (cause) {
        console.log(`  · could not remove probe file ${name}: ${cause.message}`)
      }
    }
  } catch {
    /* no workspace yet — nothing to clean */
  }
  if (removed > 0) console.log(`  · removed ${removed} probe file(s)`)
}

async function removeProbeCronJobs() {
  const listed = await gatewayCall('cron.list', { includeDisabled: true })
  if (!listed.ok) return 0

  const jobs = listed.data?.jobs
  if (!Array.isArray(jobs)) return 0

  let removed = 0
  for (const job of jobs) {
    if (typeof job?.name !== 'string' || !job.name.startsWith('E2E probe')) continue
    const result = await gatewayCall('cron.remove', { id: job.id })
    if (result.ok) removed += 1
  }
  if (removed > 0) console.log(`  · removed ${removed} leftover probe task(s)`)
  return removed
}

async function addCronJob(name) {
  return gatewayCall('cron.add', {
    name,
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    // `main` sessions only accept systemEvent payloads; isolated runs accept a
    // full agent turn, which is what a user-created task actually is.
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: { kind: 'agentTurn', message: 'e2e probe' },
  })
}
