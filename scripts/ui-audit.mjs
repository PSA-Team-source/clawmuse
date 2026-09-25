/**
 * Walks every screen and reports layout and accessibility faults.
 *
 * Written after a pass of the app by eye missed things a screenshot cannot
 * show: switches with no accessible name (VoiceOver announces a bare "switch"),
 * back links 21px tall, text clipped without a scroller. It found more than
 * thirty in its first run.
 *
 * Needs the app running with a debug port:
 *
 *   open -a /Applications/ClawMuse.app --args --remote-debugging-port=9333
 *   npm run audit:ui
 *
 * Screenshots and a JSON report land in the output directory (default
 * `/tmp/clawmuse-ui`), so a regression can be diffed rather than argued about.
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const PORT = Number(process.env.CLAWMUSE_DEBUG_PORT ?? 9333)
const OUT = process.argv[2] ?? '/tmp/clawmuse-ui'
mkdirSync(OUT, { recursive: true })

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!page) throw new Error('no renderer')

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const f = JSON.parse(e.data)
  if (f.id && pending.has(f.id)) {
    pending.get(f.id)(f.result)
    pending.delete(f.id)
  }
}
const send = (method, params = {}) =>
  new Promise((r) => {
    const msgId = ++id
    pending.set(msgId, r)
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
const evaluate = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))
    ?.result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await new Promise((r) => (ws.onopen = r))
await send('Runtime.enable')

/**
 * Layout faults that a screenshot alone would not make obvious: content wider
 * than its container, text clipped mid-word, tap targets under 32px, and text
 * that fails a rough contrast floor against its own background.
 */
const AUDIT = `(() => {
  const problems = []
  const seen = new Set()
  const add = (kind, el, detail) => {
    const key = kind + '|' + (el.className || '') + '|' + (el.innerText || '').slice(0, 24)
    if (seen.has(key)) return
    seen.add(key)
    problems.push({ kind, tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 70),
      text: (el.innerText || '').replace(/\\n/g, ' ').slice(0, 60), detail })
  }

  // Horizontal overflow of the page itself.
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    problems.push({ kind: 'page-overflow-x', detail: document.documentElement.scrollWidth + ' > ' + window.innerWidth })
  }

  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    // Content spilling out of its own box, only where clipping is not intended.
    // xterm manages its own scrolling and always measures wider than its box.
    if (el.closest('.xterm')) continue
    if (el.scrollWidth > el.clientWidth + 2 && style.overflowX === 'visible' && el.clientWidth > 0) {
      add('overflow-x', el, el.scrollWidth + '>' + el.clientWidth)
    }
    // Vertical clipping without a scroller. A line-clamp is deliberate
    // truncation and reports the same way, so it is not a fault.
    if (el.scrollHeight > el.clientHeight + 4 && style.overflowY === 'hidden'
        && style.webkitLineClamp === 'none') {
      add('clipped-y', el, el.scrollHeight + '>' + el.clientHeight)
    }
    // Interactive targets too small to hit comfortably.
    const role = el.getAttribute('role')
    if ((el.tagName === 'BUTTON' || role === 'button' || el.tagName === 'A') && el.innerText?.trim()) {
      if (rect.height < 24 || rect.width < 24) add('tiny-target', el, Math.round(rect.width) + 'x' + Math.round(rect.height))
    }
    // Buttons with neither text nor an accessible name.
    if ((el.tagName === 'BUTTON' || role === 'button') && !el.innerText?.trim()
        && !el.getAttribute('aria-label') && !el.getAttribute('title')) {
      add('unlabelled-control', el, 'no text, no aria-label, no title')
    }
    // Element pushed outside the viewport horizontally.
    if (rect.left < -2 || rect.right > window.innerWidth + 2) {
      if (style.position !== 'fixed' && rect.width < window.innerWidth) {
        add('offscreen-x', el, Math.round(rect.left) + '..' + Math.round(rect.right))
      }
    }
    // A raw <select> is drawn by macOS itself: its popup ignores the dark theme
    // and every design token. Reported as a fault so the primitive layer can
    // prove it removed them rather than claim it.
    if (el.tagName === 'SELECT') add('native-select', el, 'macOS draws this popup, not us')
    // Type below the smallest step in the scale is a sign of an ad-hoc size.
    const size = parseFloat(style.fontSize)
    if (size && size < 11 && el.innerText?.trim() && el.children.length === 0) {
      add('type-below-scale', el, size + 'px < 11px')
    }
  }
  return JSON.stringify(problems.slice(0, 25))
})()`

const SCREENS = [
  ['room', '#/room'],
  ['chat-list', '#/chat'],
  ['chat-thread', '#/chat/' + encodeURIComponent('webchat:main')],
  ['tasks', '#/tasks'],
  ['channels', '#/channels'],
  ['channel-slack', '#/channels/slack'],
  ['channel-whatsapp', '#/channels/whatsapp'],
  ['skills', '#/skills'],
  ['files', '#/files'],
  ['terminal', '#/terminal'],
  ['agent-studio', '#/agent-studio'],
  ['skill-editor', '#/agent-studio/new'],
  ['settings', '#/settings'],
  ['settings-model', '#/settings/model'],
  ['settings-security', '#/settings/security'],
  ['settings-connectors', '#/settings/connectors'],
  ['settings-voice', '#/settings/voice'],
  ['settings-notifications', '#/settings/notifications'],
  ['settings-about', '#/settings/about'],
  ['legal-privacy', '#/settings/legal/privacy'],
]

/**
 * Wait until the screen stops changing rather than guessing a fixed delay.
 *
 * A flat 2.6s sleep reported the chat list as an empty screen — it was still
 * loading, and auditing an unsettled screen both invents faults and hides real
 * ones. Two identical readings in a row is the signal; the cap keeps a screen
 * that animates forever (the 3D room) from stalling the run.
 */
async function settle(maxMs = 9000) {
  const deadline = Date.now() + maxMs
  let previous = null
  let stableCount = 0
  while (Date.now() < deadline) {
    await sleep(400)
    const now = await evaluate(
      `document.body.innerText.length + ':' + document.querySelectorAll('body *').length`,
    )
    if (now === previous && now !== '0:0') {
      if (++stableCount >= 2) return true
    } else {
      stableCount = 0
    }
    previous = now
  }
  return false
}

/**
 * Wait for the gateway connection before auditing anything.
 *
 * Settling is not the same as being ready: a screen that is still connecting
 * holds a perfectly stable "connecting" state, which the settle check happily
 * accepts. A run started too soon reported four screens as near-empty and
 * called them clean, which is worse than reporting them as broken.
 */
async function waitForConnection(maxMs = 60_000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const connected = await evaluate(`document.body.innerText.includes('Connected')`)
    if (connected) return true
    await sleep(1000)
  }
  return false
}

await evaluate(`location.hash = '#/room'`)
if (!(await waitForConnection())) {
  console.error('! never reached a connected state — the audit below is not trustworthy')
  process.exitCode = 1
}

const report = []
for (const [name, hash] of SCREENS) {
  await evaluate(`location.hash = '${hash}'`)
  const settled = await settle()
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, 'base64'))
  const raw = await evaluate(AUDIT)
  const problems = JSON.parse(String(raw ?? '[]'))
  const body = String((await evaluate(`document.body.innerText.trim()`)) ?? '')
  report.push({
    name,
    hash,
    settled,
    problems,
    bodyLen: body.length,
    head: body.replace(/\n/g, ' ⏎ ').slice(0, 100),
  })
  console.log(
    `${problems.length === 0 ? '·' : '!'} ${name.padEnd(22)} problems=${problems.length} len=${body.length}${settled ? '' : ' (never settled)'}`,
  )
  for (const p of problems) {
    console.log(`    ${p.kind} <${p.tag}> ${p.detail} — "${p.text}" [${p.cls}]`)
  }
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log(`\nshots + report → ${OUT}`)
ws.close()
