import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayEventFrame } from '@/types'

/**
 * The user's own message vanished while the agent worked, and came back with
 * the reply. `chat.send` is acknowledged before the message is in the
 * transcript (OpenClaw keeps it in pending-input custody — e.g. a queued
 * follow-up, which also broadcasts an empty `final` at once), and any history
 * reload in that window replaced the thread with a history that lacked it.
 */

let history: unknown[] = []
vi.mock('@/services/gateway-ws.service', () => ({
  gatewayWS: {
    isConnected: true,
    sendMessage: vi.fn().mockResolvedValue({ status: 'started' }),
    getSessionHistory: vi.fn(async () => ({ messages: history })),
    describeSession: vi.fn().mockResolvedValue(null),
    patchSession: vi.fn().mockResolvedValue(undefined),
  },
  encodeAttachment: vi.fn(),
}))

const { useChatStore } = await import('@/stores/chat.store')
const { eventSessionKey } = await import('@/services/session-key')

const KEY = eventSessionKey('agent:main:webchat:main')
const row = (id: string, role: string, content: string, timestamp = 1) => ({ role, content, timestamp, __openclaw: { id } })
const earlier = [row('u1', 'user', 'hi'), row('a1', 'assistant', 'Hello!')]
const users = () => (useChatStore.getState().messages[KEY] ?? []).filter((m) => m.role === 'user').map((m) => m.content)
const final = (message?: string) =>
  useChatStore.getState().handleGatewayEvent({
    type: 'event',
    event: 'chat',
    payload: { runId: 'r', sessionKey: 'agent:main:webchat:main', state: 'final', ...(message ? { message: { role: 'assistant', content: [{ type: 'text', text: message }] } } : {}) },
  } as GatewayEventFrame)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a sent message stays on screen until the transcript holds it', () => {
  beforeEach(async () => {
    localStorage.clear()
    useChatStore.setState({ messages: {}, isTyping: {}, streamingText: {}, streamingThinking: {} })
    history = earlier
    await useChatStore.getState().loadMessages(KEY)
  })

  it('survives a reload mid-run whose history does not have it yet', async () => {
    await useChatStore.getState().sendMessage(KEY, 'find me a flight')
    final() // the queued follow-up's empty final → reconcile against history
    await settle()
    expect(users()).toEqual(['hi', 'find me a flight'])

    // A remount mid-run: the cached snapshot must not roll the thread back either.
    await useChatStore.getState().loadMessages(KEY)
    expect(users()).toEqual(['hi', 'find me a flight'])
  })

  it('is replaced by the stored row once committed, even reshaped — one copy', async () => {
    await useChatStore.getState().sendMessage(KEY, 'find me a flight')
    history = [...earlier, row('u2', 'user', '[Fri 2026-09-25 10:00 GMT+7] find me a flight', 2), row('a2', 'assistant', 'Done.', 3)]
    final('Done.')
    await settle()
    const thread = useChatStore.getState().messages[KEY]!
    expect(users()).toEqual(['hi', '[Fri 2026-09-25 10:00 GMT+7] find me a flight'])
    expect(thread.some((m) => m.id.startsWith('opt_'))).toBe(false)
  })

  it('an older identical message does not stand in for a new send', async () => {
    await useChatStore.getState().sendMessage(KEY, 'hi')
    final()
    await settle()
    expect(users()).toEqual(['hi', 'hi'])
  })
})
