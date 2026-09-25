import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMessage = vi.fn()
vi.mock('@/services/gateway-ws.service', () => ({
  gatewayWS: { isConnected: true, sendMessage: (...args: unknown[]) => sendMessage(...args), getHistory: vi.fn().mockResolvedValue([]) },
  encodeAttachment: vi.fn(),
}))

const { useChatStore } = await import('@/stores/chat.store')

describe('sending shows the agent working at once (Muse: expecting a reply)', () => {
  beforeEach(() => {
    sendMessage.mockReset()
    useChatStore.setState({ messages: {}, isTyping: {}, streamingText: {}, streamingThinking: {} })
  })

  it('is typing while the send is in flight, before any token streams', async () => {
    let release: () => void = () => {}
    sendMessage.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))
    const pending = useChatStore.getState().sendMessage('s', 'hi')
    await Promise.resolve()
    expect(useChatStore.getState().isTyping.s).toBe(true)
    release()
    await pending
    expect(useChatStore.getState().isTyping.s).toBe(true)
  })

  it('stops when the send itself fails', async () => {
    sendMessage.mockRejectedValue(new Error('offline'))
    await useChatStore.getState().sendMessage('s', 'hi')
    expect(useChatStore.getState().isTyping.s).toBe(false)
  })
})
