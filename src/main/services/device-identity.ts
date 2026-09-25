import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import log from 'electron-log/main.js'
import type { DeviceSignRequest, DeviceSignature } from '@shared/ipc'
import { paths } from './local-runtime/paths.js'

/**
 * Ed25519 device identity for the gateway handshake.
 *
 * **This is not optional.** A `connect` without a signed `device` block still
 * returns `ok: true`, but the gateway then runs `clearUnboundScopes()` and the
 * session ends up with `scopes: []` — every later RPC fails with
 * "missing scope: operator.read" while the handshake looks fine. Measured
 * against gateway 2026.7.1-2:
 *
 *   no device  → scopes: []                        → cron.list FAILS
 *   with v3    → scopes: [admin, read, write]      → cron.list OK
 *
 * The private key stays in the main process. The renderer sends the challenge
 * nonce over IPC and gets back only a signature, so a compromised renderer can
 * sign handshakes for as long as it is compromised but can never exfiltrate the
 * key itself.
 *
 * File shape matches OpenClaw's own `~/.openclaw/identity/device.json`, so
 * `openclaw --profile clawmuse devices list` sees the same device the app uses.
 */

interface StoredIdentity {
  version: 1
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
  createdAtMs: number
}

/** DER prefix for an Ed25519 SubjectPublicKeyInfo; the raw 32 bytes follow it. */
const SPKI_PREFIX_LENGTH = 12

let cached: StoredIdentity | null = null

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function rawPublicKey(publicKeyPem: string): Buffer {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return der.subarray(SPKI_PREFIX_LENGTH)
}

function generate(): StoredIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  return {
    version: 1,
    // The gateway pins device id to the key fingerprint; a mismatch is rejected
    // with DEVICE_AUTH_DEVICE_ID_MISMATCH.
    deviceId: crypto.createHash('sha256').update(rawPublicKey(publicKeyPem)).digest('hex'),
    publicKeyPem,
    privateKeyPem,
    createdAtMs: Date.now(),
  }
}

function isUsable(value: unknown): value is StoredIdentity {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.deviceId === 'string' &&
    typeof record.publicKeyPem === 'string' &&
    typeof record.privateKeyPem === 'string'
  )
}

export async function loadOrCreateIdentity(): Promise<StoredIdentity> {
  if (cached) return cached

  if (existsSync(paths.identity)) {
    try {
      const parsed: unknown = JSON.parse(await readFile(paths.identity, 'utf8'))
      if (isUsable(parsed)) {
        cached = parsed
        return parsed
      }
      log.warn('[device-identity] stored identity is malformed — regenerating')
    } catch (error) {
      log.warn('[device-identity] unreadable identity file:', (error as Error).message)
    }
  }

  const identity = generate()
  await mkdir(dirname(paths.identity), { recursive: true, mode: 0o700 })
  await writeFile(paths.identity, JSON.stringify(identity, null, 2), { mode: 0o600 })
  cached = identity
  log.info(`[device-identity] created device ${identity.deviceId.slice(0, 12)}…`)
  return identity
}

/**
 * This machine's device id and public key, in the exact encodings the gateway
 * stores in `~/.openclaw-clawmuse/devices/{paired,pending}.json`.
 *
 * Exported so the pairing repair can match a pending request against *this*
 * device and nothing else — approving by request id alone would let the app
 * rubber-stamp a request some other client raised.
 */
export async function deviceFingerprint(): Promise<{ deviceId: string; publicKey: string }> {
  const identity = await loadOrCreateIdentity()
  return { deviceId: identity.deviceId, publicKey: base64Url(rawPublicKey(identity.publicKeyPem)) }
}

/**
 * Builds the exact byte string the gateway verifies.
 *
 * Mirrors `packages/gateway-client/src/device-auth.ts`. Comparison is
 * byte-for-byte, so `scopes` must match `connect.params.scopes` in the same
 * order, and `platform` / `deviceFamily` are lowercased the same way
 * `normalizeDeviceMetadataForAuth` does.
 */
export function buildDeviceAuthPayloadV3(params: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAtMs: number
  token: string
  nonce: string
  platform: string
  deviceFamily?: string
}): string {
  const normalize = (value: string | undefined): string => value?.trim().toLowerCase() ?? ''
  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token,
    params.nonce,
    normalize(params.platform),
    normalize(params.deviceFamily),
  ].join('|')
}

export async function signHandshake(request: DeviceSignRequest): Promise<DeviceSignature> {
  const identity = await loadOrCreateIdentity()
  const signedAt = Date.now()
  const payload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: request.clientId,
    clientMode: request.clientMode,
    role: request.role,
    scopes: request.scopes,
    signedAtMs: signedAt,
    token: request.token,
    nonce: request.nonce,
    // Must equal `client.platform` in the same frame or the gateway reports a
    // platform mismatch against the pinned device metadata.
    platform: process.platform,
  })
  const signature = crypto.sign(
    null,
    Buffer.from(payload, 'utf8'),
    crypto.createPrivateKey(identity.privateKeyPem),
  )
  return {
    id: identity.deviceId,
    publicKey: base64Url(rawPublicKey(identity.publicKeyPem)),
    signature: base64Url(signature),
    signedAt,
    nonce: request.nonce,
    platform: process.platform,
  }
}

/** Test seam — drops the in-process cache so a fresh file is re-read. */
export function resetIdentityCache(): void {
  cached = null
}
