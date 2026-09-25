import { afterEach, describe, expect, it, vi } from 'vitest'
import { gatewayWS } from '@/services/gateway-ws.service'

// The service's socket state is private; the test sets it the way a live connection leaves it.
const internals = gatewayWS as unknown as { ws: { readyState: number } | null; handshakeDone: boolean; transport: { port: number; gatewayToken: string } }

describe('connectLocal on an already-open socket', () => {
  afterEach(() => {
    gatewayWS.removeAllListeners()
    vi.restoreAllMocks()
    internals.ws = null
    internals.handshakeDone = false
  })

  it('re-announces the connection to listeners attached since', () => {
    internals.transport = { port: 18791, gatewayToken: 'tok' }
    internals.ws = { readyState: WebSocket.OPEN }
    internals.handshakeDone = true
    const connected = vi.fn()
    gatewayWS.on('connected', connected)
    gatewayWS.connectLocal(18791, 'tok')
    expect(connected).toHaveBeenCalledOnce()
  })

  it('reconnects when the runtime came back on a new port', () => {
    internals.transport = { port: 18791, gatewayToken: 'tok' }
    internals.ws = { readyState: WebSocket.OPEN }
    internals.handshakeDone = true
    const reconnect = vi.spyOn(gatewayWS, 'reconnectNow').mockImplementation(() => undefined)
    gatewayWS.connectLocal(18792, 'tok')
    expect(reconnect).toHaveBeenCalledOnce()
  })
})

describe('patchSession model reset', () => {
  it('sends Auto as null, the only value sessions.patch treats as "clear the pin"', async () => {
    const call = vi.spyOn(gatewayWS, 'call').mockResolvedValue({})
    await gatewayWS.patchSession('webchat:main', { model: 'default' })
    expect(call).toHaveBeenCalledWith('sessions.patch', expect.objectContaining({ model: null }))
    await gatewayWS.patchSession('webchat:main', { model: 'openrouter/auto' })
    expect(call).toHaveBeenLastCalledWith('sessions.patch', expect.objectContaining({ model: 'openrouter/auto' }))
  })
})
