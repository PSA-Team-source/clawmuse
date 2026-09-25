import log from 'electron-log/main.js'
import { deviceFingerprint } from '../device-identity.js'
import { firstMeaningfulLine, runJson } from './exec.js'
import { PROFILE, openclawEnv, wsUrlFor } from './paths.js'

/**
 * Repairs a device that the gateway left waiting for pairing approval.
 *
 * With the `Origin` header gone (`services/ws-origin.ts`) the gateway pairs
 * this app silently, so on a healthy machine nothing here ever runs. It exists
 * for the two cases where silent pairing cannot happen:
 *
 * - **A profile poisoned by an older build.** Once a pending request has been
 *   raised non-silently, OpenClaw refuses to downgrade it:
 *   `refreshPendingDevicePairingRequest` keeps `silent: existing.silent &&
 *   incoming.silent`, and `resolveSupersededPendingSilent` does the same across
 *   superseded requests. So every install that ever hit the old bug stays
 *   broken *after* the header fix, forever, until something approves the
 *   request that is already on disk. This does.
 * - **A future policy change upstream.** Silent local pairing is OpenClaw's
 *   decision, not ours, and it has already moved once. If it moves again the
 *   app repairs itself instead of stranding every user at "Connecting".
 *
 * The safety property is that this **never approves a request it did not
 * raise**: the pending record must match both the device id *and* the public
 * key held in `~/.openclaw-clawmuse/identity/device.json`, whose private half never
 * leaves the main process. Approving by request id alone — which is what the
 * manual `openclaw devices approve <id>` workaround does — would let the app
 * rubber-stamp a pairing request from any other client on the machine.
 */

function argv(args: string[]): string[] {
  return ['--profile', PROFILE, ...args]
}

interface PendingRequest {
  requestId?: string
  deviceId?: string
  publicKey?: string
  displayName?: string
}

interface PairedDevice {
  deviceId?: string
  publicKey?: string
}

/** `devices list --json` answers with the raw pairing store. */
export interface DevicePairingList {
  pending?: PendingRequest[]
  /** An array over the wire; the on-disk file is a map keyed by device id. */
  paired?: PairedDevice[] | Record<string, PairedDevice>
}

export type PairingRepair =
  | { repaired: true; requestId: string }
  | { repaired: false; reason: 'already-paired' | 'nothing-pending' | 'failed'; detail?: string }

export interface DeviceIdentityRef {
  deviceId: string
  publicKey: string
}

function pairedList(paired: DevicePairingList['paired']): PairedDevice[] {
  if (Array.isArray(paired)) return paired
  if (paired && typeof paired === 'object') return Object.values(paired)
  return []
}

/** Whether the gateway already trusts this exact key under this exact id. */
export function isPairedIdentity(list: DevicePairingList, identity: DeviceIdentityRef): boolean {
  return pairedList(list.paired).some(
    (device) => device.deviceId === identity.deviceId && device.publicKey === identity.publicKey,
  )
}

/**
 * The pending request raised by *this* device, if any.
 *
 * Both halves must match. A device id is a hash of the public key, so an entry
 * that agrees on one and not the other is either a different client or a
 * tampered store — approving it would hand operator scopes to something this
 * app cannot vouch for.
 */
export function selectOwnPendingRequest(
  list: DevicePairingList,
  identity: DeviceIdentityRef,
): string | null {
  const mine = (list.pending ?? []).find(
    (request) =>
      request.deviceId === identity.deviceId &&
      request.publicKey === identity.publicKey &&
      typeof request.requestId === 'string' &&
      request.requestId.length > 0,
  )
  return mine?.requestId ?? null
}

/**
 * Approves this machine's own pending pairing request, if there is one.
 *
 * Goes through the CLI rather than the pairing store on disk: the gateway holds
 * that state in memory too, so writing the file behind its back would be
 * ignored until the next restart. The CLI connects as `cli`/`cli`, which is the
 * one client class that still pairs silently on loopback — which is exactly why
 * the manual workaround in the bug report worked.
 */
export async function repairDevicePairing(bin: string, port: number, token: string): Promise<PairingRepair> {
  const { deviceId, publicKey } = await deviceFingerprint()

  const rpc = ['--url', wsUrlFor(port), '--token', token, '--timeout', '15000', '--json']
  const listed = await runJson<DevicePairingList>(bin, argv(['devices', 'list', ...rpc]), {
    env: openclawEnv(),
    timeoutMs: 45_000,
  })
  if (!listed.ok) {
    log.warn('[pairing] could not read the device list:', listed.error)
    return { repaired: false, reason: 'failed', detail: listed.error }
  }

  const identity = { deviceId, publicKey }
  if (isPairedIdentity(listed.data, identity)) return { repaired: false, reason: 'already-paired' }

  const requestId = selectOwnPendingRequest(listed.data, identity)
  if (!requestId) {
    log.info(`[pairing] no pending request for device ${deviceId.slice(0, 12)}…`)
    return { repaired: false, reason: 'nothing-pending' }
  }

  const approved = await runJson<unknown>(bin, argv(['devices', 'approve', requestId, ...rpc]), {
    env: openclawEnv(),
    timeoutMs: 45_000,
  })
  if (!approved.ok) {
    const detail = firstMeaningfulLine(approved.result.stderr) || approved.error
    log.error(`[pairing] approving ${requestId} failed: ${detail}`)
    return { repaired: false, reason: 'failed', detail }
  }

  log.info(`[pairing] approved this machine's own device (${deviceId.slice(0, 12)}…)`)
  return { repaired: true, requestId }
}
