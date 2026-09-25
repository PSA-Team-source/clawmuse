/**
 * Contract test: does the pinned runtime still pair a clean device silently?
 *
 * This is the check that was missing when ClawMuse 1.0.0 shipped. Every other
 * suite runs against the developer's profile, where `~/.openclaw-clawmuse/devices/paired.json`
 * already holds an approved device — so the one thing a new user hits first,
 * *the very first handshake from a device the gateway has never seen*, was
 * never exercised. It failed for every one of them:
 *
 *     handshake: failed   phase: auth_validated   cause: pairing-required
 *     closed before connect ... code=1008 reason=pairing required: device is not approved yet
 *
 * The gateway decides this from one question — did the connection carry an
 * `Origin` header? A native client that sends one is put on the browser path,
 * where `shouldAllowSilentLocalPairing` refuses anything that is not the
 * Control UI or a webchat page. So this asserts both directions against a real
 * gateway and a real Ed25519 identity, using the exact `connect` frame
 * `services/gateway-ws.service.ts` sends.
 *
 * Re-run it whenever `PINNED_OPENCLAW_VERSION` moves: silent local pairing is
 * OpenClaw's policy, not ours, and it has already changed once.
 *
 * Usage:
 *   node scripts/e2e-pairing.mjs [port]
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.argv[2] ?? 18991)
const TOKEN = 'f'.repeat(64)
const SCOPES = ['operator.read', 'operator.write', 'operator.admin']

/** Mirrors `paths.runtimeBin` — the CLI this app manages, not one from PATH. */
const BIN = join(homedir(), '.openclaw-clawmuse', 'runtime', 'node_modules', '.bin', 'openclaw')
const NODE_BIN = join(homedir(), '.openclaw-clawmuse', 'runtime', 'node-bin')
if (!existsSync(BIN)) {
  console.error(`✗ ${BIN} not found — launch the app once so it installs the runtime.`)
  process.exit(1)
}

const failures = []
function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

/**
 * A client that can set `Origin`, if one is reachable.
 *
 * Node's built-in WebSocket cannot: it is not a browser and sends no origin at
 * all — which happens to be exactly the case the app now relies on, so the
 * positive half of this test needs no dependency. The negative half does, and
 * `ws` lives in the OpenClaw checkout beside this repo.
 */
function loadOriginCapableClient() {
  const openclawRepo = join(process.cwd(), '..', '..', '_OPENCLAW-MAIN')
  try {
    return createRequire(join(openclawRepo, 'package.json'))('ws')
  } catch {
    return null
  }
}

// ── A throwaway gateway, so nothing here can touch the real profile ──────────

const STATE = join(tmpdir(), `clawmuse-pairing-e2e-${PORT}`)
rmSync(STATE, { recursive: true, force: true })
mkdirSync(STATE, { recursive: true })
const CONFIG = join(STATE, 'openclaw.json')
writeFileSync(
  CONFIG,
  `${JSON.stringify(
    {
      gateway: {
        mode: 'local',
        bind: 'loopback',
        port: PORT,
        auth: { mode: 'token', token: TOKEN },
        controlUi: { allowedOrigins: [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`] },
      },
      discovery: { mdns: { mode: 'off' } },
      agents: { defaults: { workspace: join(STATE, 'workspace') } },
      logging: { level: 'info', consoleLevel: 'info' },
    },
    null,
    2,
  )}\n`,
)

const env = {
  ...process.env,
  PATH: `${NODE_BIN}:${process.env.PATH ?? ''}`,
  OPENCLAW_STATE_DIR: STATE,
  OPENCLAW_CONFIG_PATH: CONFIG,
  OPENCLAW_WORKSPACE_DIR: join(STATE, 'workspace'),
}

// ── The handshake, exactly as the app performs it ────────────────────────────

const base64Url = (buffer) =>
  buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')

/** A device the gateway has never seen — the whole point of this test. */
function freshIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pem = publicKey.export({ type: 'spki', format: 'pem' })
  // 12-byte DER prefix on an Ed25519 SubjectPublicKeyInfo; the raw key follows.
  const raw = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).subarray(12)
  return { deviceId: crypto.createHash('sha256').update(raw).digest('hex'), raw, privateKey }
}

/** Mirrors `buildDeviceAuthPayloadV3` in `main/services/device-identity.ts`. */
function signHandshake(identity, nonce) {
  const signedAt = Date.now()
  const payload = [
    'v3',
    identity.deviceId,
    'openclaw-macos',
    'ui',
    'operator',
    SCOPES.join(','),
    String(signedAt),
    TOKEN,
    nonce,
    'darwin',
    '',
  ].join('|')
  return {
    id: identity.deviceId,
    publicKey: base64Url(identity.raw),
    signature: base64Url(crypto.sign(null, Buffer.from(payload, 'utf8'), identity.privateKey)),
    signedAt,
    nonce,
  }
}

function connectFrame(identity, nonce) {
  return JSON.stringify({
    type: 'req',
    id: 'connect-1',
    method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 4,
      client: {
        id: 'openclaw-macos',
        displayName: 'ClawMuse Desktop',
        version: '1.0.0',
        platform: 'darwin',
        mode: 'ui',
      },
      role: 'operator',
      scopes: SCOPES,
      auth: { token: TOKEN },
      device: signHandshake(identity, nonce),
    },
  })
}

/**
 * One full handshake with a brand-new identity.
 *
 * `Client` is either Node's built-in WebSocket (sends no origin) or `ws` with
 * an explicit `Origin` header — the difference this whole test is about.
 */
function handshake(Client, options) {
  return new Promise((resolve) => {
    const identity = freshIdentity()
    const socket = options
      ? new Client(`ws://127.0.0.1:${PORT}/?token=${TOKEN}`, options)
      : new Client(`ws://127.0.0.1:${PORT}/?token=${TOKEN}`)

    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* already closing */
      }
      resolve(result)
    }
    const timer = setTimeout(() => finish({ outcome: 'timeout' }), 30_000)

    const onMessage = (data) => {
      let frame
      try {
        frame = JSON.parse(typeof data === 'string' ? data : data.toString())
      } catch {
        return
      }
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        socket.send(connectFrame(identity, frame.payload.nonce))
        return
      }
      if (frame.type !== 'res' || frame.id !== 'connect-1') return
      if (frame.ok === false || frame.error) {
        finish({
          outcome: 'refused',
          message: frame.error?.message,
          detailCode: frame.error?.details?.code,
        })
        return
      }
      const auth = frame.payload?.auth ?? frame.result?.auth
      finish({ outcome: 'connected', scopes: auth?.scopes ?? [] })
    }

    // `ws` uses EventEmitter, the built-in uses DOM events; both accept these.
    socket.onmessage = (event) => onMessage(event.data)
    if (typeof socket.on === 'function') socket.on('message', onMessage)
    socket.onclose = (event) => finish({ outcome: 'closed', code: event?.code, reason: event?.reason })
    socket.onerror = () => finish({ outcome: 'error' })
  })
}

// ── Run ──────────────────────────────────────────────────────────────────────

const gateway = spawn(BIN, ['gateway', '--port', String(PORT), '--force'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
gateway.stdout.on('data', (chunk) => (output += chunk))
gateway.stderr.on('data', (chunk) => (output += chunk))

const cleanup = () => {
  gateway.kill('SIGKILL')
  rmSync(STATE, { recursive: true, force: true })
}
process.on('exit', cleanup)

let up = false
for (let i = 0; i < 120 && !up; i += 1) {
  await sleep(1000)
  up = Boolean(await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok).catch(() => false))
}
if (!up) {
  console.error(`✗ the throwaway gateway never came up on ${PORT}\n${output.slice(-4000)}`)
  process.exit(1)
}
console.log(`gateway up on ${PORT}\n`)

// The case that matters: a device this gateway has never seen, connecting the
// way the app connects. It must be trusted with no human in the loop.
const clean = await handshake(WebSocket)
check(
  'a device the gateway has never seen pairs silently',
  clean.outcome === 'connected',
  clean.message ?? clean.outcome,
)
check(
  'and is granted the three operator scopes',
  clean.outcome === 'connected' && SCOPES.every((scope) => clean.scopes.includes(scope)),
  JSON.stringify(clean.scopes ?? []),
)

const OriginCapable = loadOriginCapableClient()
if (!OriginCapable) {
  console.log('· skipped: the Origin-header case needs `ws` from the _OPENCLAW-MAIN checkout')
} else {
  // The regression itself. If this ever connects, the gateway has relaxed its
  // policy and the note in `services/ws-origin.ts` needs revisiting; if the app
  // ever sends an Origin again, this is what it costs.
  const browserish = await handshake(OriginCapable, { headers: { Origin: `http://127.0.0.1:${PORT}` } })
  check(
    'the same handshake with an Origin header is refused for pairing',
    browserish.outcome === 'refused' && browserish.detailCode === 'PAIRING_REQUIRED',
    `${browserish.outcome}${browserish.detailCode ? ` / ${browserish.detailCode}` : ''}`,
  )
}

gateway.kill('SIGTERM')
await sleep(1000)

console.log()
if (failures.length > 0) {
  console.error(`✗ ${failures.length} failed:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('✓ clean-device pairing works against the pinned runtime')
