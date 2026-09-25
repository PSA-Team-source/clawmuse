import { describe, expect, it } from 'vitest'
import {
  type DevicePairingList,
  isPairedIdentity,
  selectOwnPendingRequest,
} from '../../../main/services/local-runtime/pairing'
import { withoutOriginHeader } from '../../../main/services/ws-origin'
import { __testing } from '../services/gateway-ws.service'

const { classify, GatewayCallError } = __testing

/**
 * The bug these cover, end to end:
 *
 * a fresh install passed authentication, reached `phase=auth_validated`, and was
 * then closed with `1008 pairing required: device is not approved yet`. Nothing
 * appeared in the app — onboarding span at "Connecting" indefinitely — and the
 * only record of the refusal was in OpenClaw's own log file.
 *
 * Three separate faults had to line up, and each has a test here.
 */

describe('the Origin header the gateway must not see', () => {
  /**
   * `hasBrowserOriginHeader` is `Boolean(origin && origin.trim() !== "")` in
   * `handshake-auth-helpers.ts`, and a true answer sends a native app down the
   * browser path — where `shouldAllowSilentLocalPairing` returns false for any
   * client that is not the Control UI or webchat. Rewriting the header to the
   * gateway's own origin (what this used to do) still answers true. Only its
   * absence answers false.
   */
  it('removes the header whatever case Chromium sent it in', () => {
    expect(withoutOriginHeader({ Origin: 'file://', 'User-Agent': 'x' })).toEqual({ 'User-Agent': 'x' })
    expect(withoutOriginHeader({ origin: 'http://127.0.0.1:18789' })).toEqual({})
    expect(withoutOriginHeader({ ORIGIN: 'null' })).toEqual({})
  })

  it('leaves every other header untouched', () => {
    const headers = { 'Sec-WebSocket-Version': '13', 'Accept-Encoding': 'gzip' }
    expect(withoutOriginHeader(headers)).toEqual(headers)
  })

  it('does not mutate the input', () => {
    const headers = { Origin: 'file://' }
    withoutOriginHeader(headers)
    expect(headers).toEqual({ Origin: 'file://' })
  })
})

describe('classifying why the gateway refused us', () => {
  it('reads the structured detail code rather than the prose', () => {
    const error = new GatewayCallError('pairing required: device is not approved yet', 'PAIRING_REQUIRED', 'req-1')
    expect(classify(error).kind).toBe('pairing-required')
  })

  it('falls back to the close reason, which is all a 1008 carries', () => {
    const failure = classify(
      new Error('The gateway refused this connection'),
      1008,
      'pairing required: device is not approved yet (requestId: 5341fb47)',
    )
    expect(failure.kind).toBe('pairing-required')
    expect(failure.code).toBe(1008)
  })

  it('does not mistake an ordinary handshake failure for a pairing one', () => {
    // A repair would be attempted for this, fail, and hide the real cause.
    expect(classify(new Error('Gateway handshake timed out')).kind).toBe('handshake')
    expect(classify(new GatewayCallError('unauthorized', 'AUTH_UNAUTHORIZED')).kind).toBe('handshake')
  })
})

describe('choosing a pairing request to approve', () => {
  const identity = { deviceId: 'a'.repeat(64), publicKey: 'pk-ours' }

  const list = (over: Partial<DevicePairingList>): DevicePairingList => ({ pending: [], paired: [], ...over })

  it('approves the request raised by this device', () => {
    const pending = [{ requestId: 'req-ours', deviceId: identity.deviceId, publicKey: identity.publicKey }]
    expect(selectOwnPendingRequest(list({ pending }), identity)).toBe('req-ours')
  })

  it('refuses a request that agrees on the id but not the key', () => {
    // The device id is a hash of the key, so this pair cannot both be genuine.
    // Approving it would grant operator scopes to a client we cannot vouch for.
    const pending = [{ requestId: 'req-forged', deviceId: identity.deviceId, publicKey: 'pk-theirs' }]
    expect(selectOwnPendingRequest(list({ pending }), identity)).toBeNull()
  })

  it('ignores another client waiting in the same queue', () => {
    const pending = [
      { requestId: 'req-someone-else', deviceId: 'b'.repeat(64), publicKey: 'pk-theirs' },
      { requestId: 'req-ours', deviceId: identity.deviceId, publicKey: identity.publicKey },
    ]
    expect(selectOwnPendingRequest(list({ pending }), identity)).toBe('req-ours')
  })

  it('reads a paired set in either shape the CLI returns', () => {
    const entry = { deviceId: identity.deviceId, publicKey: identity.publicKey }
    expect(isPairedIdentity(list({ paired: [entry] }), identity)).toBe(true)
    expect(isPairedIdentity(list({ paired: { [identity.deviceId]: entry } }), identity)).toBe(true)
    expect(isPairedIdentity(list({ paired: [] }), identity)).toBe(false)
  })

  it('treats a key rotation as not paired', () => {
    // Same id, different key: the stored record is stale and a repair — not a
    // silent "already paired" — is what unblocks the user.
    const stale = { deviceId: identity.deviceId, publicKey: 'pk-old' }
    expect(isPairedIdentity(list({ paired: [stale] }), identity)).toBe(false)
  })
})
