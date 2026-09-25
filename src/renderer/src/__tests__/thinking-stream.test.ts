import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat.store'
import { normalizeHistory, thinkingFromEvent } from '@/utils/gateway-normalize'
import type { GatewayEventFrame } from '@/types'

/**
 * Model reasoning reaches the client in two different shapes depending on the
 * gateway build, and the desktop client previously read neither — the whole
 * "thinking" stream was dropped on the floor.
 *
 * The delta rules matter as much as the extraction: reasoning is cumulative
 * exactly like the answer text, and a frame that carries only text must not
 * erase reasoning already on screen.
 */

vi.mock('@/services/gateway-ws.service', () => ({
  gatewayWS: { getHistory: vi.fn().mockResolvedValue([]) },
  encodeAttachment: vi.fn(),
}))

function chatFrame(payload: Record<string, unknown>): GatewayEventFrame {
  return { type: 'event', event: 'chat', payload } as GatewayEventFrame
}

describe('thinkingFromEvent', () => {
  it('reads the top-level string form', () => {
    expect(thinkingFromEvent({ thinking: 'weighing options' })).toBe('weighing options')
  })

  it('reads the content-block form', () => {
    expect(
      thinkingFromEvent({
        message: {
          content: [
            { type: 'thinking', thinking: 'step one. ' },
            { type: 'text', text: 'ignored' },
            { type: 'thinking', thinking: 'step two.' },
          ],
        },
      }),
    ).toBe('step one. step two.')
  })

  it('prefers the top-level form when both are present', () => {
    expect(
      thinkingFromEvent({
        thinking: 'canonical',
        message: { content: [{ type: 'thinking', thinking: 'secondary' }] },
      }),
    ).toBe('canonical')
  })

  it('returns empty when there is no reasoning', () => {
    expect(thinkingFromEvent({ message: { content: [{ type: 'text' }] } })).toBe('')
    expect(thinkingFromEvent({})).toBe('')
  })
})

describe('chat store — streaming reasoning', () => {
  beforeEach(() => {
    useChatStore.setState({ streamingText: {}, streamingThinking: {}, isTyping: {}, messages: {} })
  })

  it('accumulates reasoning across deltas by replacement, not concatenation', () => {
    const store = useChatStore.getState()
    store.handleGatewayEvent(
      chatFrame({ state: 'delta', sessionKey: 'webchat:main', thinking: 'I will' }),
    )
    store.handleGatewayEvent(
      chatFrame({ state: 'delta', sessionKey: 'webchat:main', thinking: 'I will check the file' }),
    )

    expect(useChatStore.getState().streamingThinking['webchat:main']).toBe('I will check the file')
  })

  it('does not lose reasoning when a later delta carries only text', () => {
    const store = useChatStore.getState()
    store.handleGatewayEvent(
      chatFrame({ state: 'delta', sessionKey: 'webchat:main', thinking: 'planning' }),
    )
    store.handleGatewayEvent(
      chatFrame({ state: 'delta', sessionKey: 'webchat:main', text: 'Here you go' }),
    )

    expect(useChatStore.getState().streamingThinking['webchat:main']).toBe('planning')
  })

  it('keeps the streamed reasoning on the final message when the final frame omits it', () => {
    const store = useChatStore.getState()
    store.handleGatewayEvent(
      chatFrame({ state: 'delta', sessionKey: 'webchat:main', thinking: 'considered options' }),
    )
    store.handleGatewayEvent(
      chatFrame({ state: 'final', sessionKey: 'webchat:main', text: 'Done.' }),
    )

    const messages = useChatStore.getState().messages['webchat:main'] ?? []
    expect(messages.at(-1)?.thinking).toBe('considered options')
    expect(useChatStore.getState().streamingThinking['webchat:main']).toBeUndefined()
  })

  it('discards partial reasoning when the turn errors out, but says it failed', () => {
    const store = useChatStore.getState()
    store.handleGatewayEvent(
      chatFrame({ state: 'delta', sessionKey: 'webchat:main', thinking: 'half a thought' }),
    )
    store.handleGatewayEvent(chatFrame({ state: 'error', sessionKey: 'webchat:main' }))

    // Half a thought is not an answer and never gets shown. But the turn must
    // still leave a mark: this used to add nothing at all, which made a
    // rejected API key look exactly like a bot ignoring you.
    expect(useChatStore.getState().streamingThinking['webchat:main']).toBeUndefined()
    const messages = useChatStore.getState().messages['webchat:main'] ?? []
    expect(messages).toHaveLength(1)
    expect(messages[0]?.status).toBe('failed')
    expect(messages[0]?.thinking).toBeUndefined()
  })

  it('stays quiet when the user aborted — they already know why', () => {
    const store = useChatStore.getState()
    store.handleGatewayEvent(
      chatFrame({ state: 'delta', sessionKey: 'webchat:main', thinking: 'half a thought' }),
    )
    store.handleGatewayEvent(chatFrame({ state: 'aborted', sessionKey: 'webchat:main' }))

    expect(useChatStore.getState().messages['webchat:main'] ?? []).toHaveLength(0)
  })

  it('normalizes the prefixed session key the container sends', () => {
    useChatStore
      .getState()
      .handleGatewayEvent(
        chatFrame({ state: 'delta', sessionKey: 'agent:main:webchat:main', thinking: 'hm' }),
      )

    expect(useChatStore.getState().streamingThinking['webchat:main']).toBe('hm')
  })
})

describe('normalizeHistory', () => {
  it('restores reasoning when a thread is reloaded', () => {
    const [message] = normalizeHistory(
      [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'recalled context' },
            { type: 'text', text: 'The answer' },
          ],
        },
      ],
      'webchat:main',
    )

    expect(message?.content).toBe('The answer')
    expect(message?.thinking).toBe('recalled context')
  })

  it('leaves thinking undefined when the turn had none', () => {
    const [message] = normalizeHistory([{ role: 'assistant', content: 'plain' }], 'webchat:main')
    expect(message?.thinking).toBeUndefined()
  })
})
