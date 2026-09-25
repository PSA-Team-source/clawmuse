import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayFailure } from '@/services/gateway-ws.service'
import { useGatewayStore } from '@/stores/gateway.store'

/**
 * A refused handshake has to reach the screen.
 *
 * It did not. The gateway closed the socket with `1008 pairing-required`; the
 * client emitted `error`, the store set `connectionState: 'error'`, and then
 * the close event that always follows set `'disconnected'` on top of it. The
 * boot screen only renders a failure for `'error'`, so what the user saw was a
 * spinner on "Connecting" that never resolved and never explained itself.
 *
 * The ordering here — error, then the close — is the real sequence from
 * `sendConnect`: emit, then `ws.close()`, then `onclose`.
 */

type Handler = (...args: never[]) => void

/** Captures the listeners the store binds, so a test can fire them in order. */
const handlers = new Map<string, Handler>()

const reconnectNow = vi.fn()

vi.mock('@/services/gateway-ws.service', () => ({
  gatewayWS: {
    removeAllListeners: () => handlers.clear(),
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    connectLocal: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    reconnectNow: () => reconnectNow(),
  },
  encodeAttachment: vi.fn(),
}))

const ensure = vi.fn()
const credentials = vi.fn()
const handshakeFailed = vi.fn()

function fire(event: 'error', failure: GatewayFailure): void
function fire(event: 'disconnected', code: number, reason: string): void
function fire(event: string, ...args: unknown[]): void {
  const handler = handlers.get(event)
  if (!handler) throw new Error(`no listener bound for "${event}"`)
  ;(handler as (...a: unknown[]) => void)(...args)
}

/** Runs `bootLocal` far enough to bind the socket listeners. */
async function boot(): Promise<void> {
  ensure.mockResolvedValue({ state: 'ready', port: 18789, wsUrl: 'ws://127.0.0.1:18789/', cliVersion: '1', attached: false })
  credentials.mockResolvedValue({ port: 18789, token: 'tok', wsUrl: 'ws://127.0.0.1:18789/' })
  await useGatewayStore.getState().bootLocal()
}

const PAIRING: GatewayFailure = {
  kind: 'pairing-required',
  message: 'pairing required: device is not approved yet',
  code: 1008,
  reason: 'pairing required: device is not approved yet (requestId: 5341fb47)',
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  handshakeFailed.mockResolvedValue({ repaired: false })
  vi.stubGlobal('window', {
    ...globalThis.window,
    clawmuse: {
      runtime: { ensure, credentials, handshakeFailed, resolution: vi.fn().mockResolvedValue(null), status: vi.fn(), mode: vi.fn(), onStatus: vi.fn() },
      reportConnectionState: vi.fn(),
    },
  })
  useGatewayStore.setState({ connectionState: 'idle', errorMessage: null, errorHint: null })
})

describe('a gateway that refuses the connection', () => {
  it('keeps the error visible when the close arrives after it', async () => {
    await boot()

    fire('error', PAIRING)
    expect(useGatewayStore.getState().connectionState).toBe('error')

    // This is the event that used to erase it.
    fire('disconnected', 1008, PAIRING.reason ?? '')

    expect(useGatewayStore.getState().connectionState).toBe('error')
    expect(useGatewayStore.getState().errorMessage).toMatch(/has not approved ClawMuse/i)
    expect(useGatewayStore.getState().errorHint).toBeTruthy()
  })

  it('still reports an ordinary drop as disconnected', async () => {
    await boot()
    fire('disconnected', 1006, 'abnormal closure')
    expect(useGatewayStore.getState().connectionState).toBe('disconnected')
  })

  it('sends every failure to the main process so it lands in main.log', async () => {
    await boot()
    fire('error', PAIRING)
    await vi.waitFor(() => expect(handshakeFailed).toHaveBeenCalledWith(PAIRING))
  })

  it('retries at once when main repaired the pairing', async () => {
    handshakeFailed.mockResolvedValue({ repaired: true })
    await boot()

    fire('error', PAIRING)

    await vi.waitFor(() => expect(reconnectNow).toHaveBeenCalled())
    expect(useGatewayStore.getState().connectionState).toBe('connecting')
  })

  it('does not loop when the repair did not take', async () => {
    await boot()

    fire('error', PAIRING)
    await vi.waitFor(() => expect(handshakeFailed).toHaveBeenCalledTimes(1))

    // Second refusal for the same reason: repeating the repair would be two
    // processes on one machine arguing forever.
    fire('error', PAIRING)
    expect(handshakeFailed).toHaveBeenCalledTimes(1)
    expect(useGatewayStore.getState().connectionState).toBe('error')
  })

  it('shows main’s explanation when it could not repair', async () => {
    handshakeFailed.mockResolvedValue({ repaired: false, detail: 'Runtime configuration is missing' })
    await boot()

    fire('error', PAIRING)

    await vi.waitFor(() =>
      expect(useGatewayStore.getState().errorHint).toBe('Runtime configuration is missing'),
    )
  })
})
