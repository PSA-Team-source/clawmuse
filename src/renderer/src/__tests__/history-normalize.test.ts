import { describe, expect, it } from 'vitest'
import { normalizeHistory } from '@/utils/gateway-normalize'
import { failureNotice } from '@/stores/chat.store'

describe('chat.history normalization', () => {
  it('keeps OpenClaw ids and send times, and marks runtime errors as failed', () => {
    const [user, reply] = normalizeHistory({
      messages: [
        { role: 'user', content: 'Hi', timestamp: 1790171640708, __openclaw: { id: 'u-1' } },
        { role: 'assistant', content: [{ type: 'text', text: 'The agent run failed before producing a reply.' }], stopReason: 'error', timestamp: 1790171640972, __openclaw: { id: 'a-1' } },
      ],
    }, 's')
    expect(user).toMatchObject({ id: 'u-1', status: 'sent', created_at: new Date(1790171640708).toISOString() })
    expect(reply).toMatchObject({ id: 'a-1', status: 'failed' })
  })

  it('names the remedy for an exhausted provider balance', () => {
    expect(failureNotice('⚠️ API provider returned a billing error — your API key has run out of credits')).toMatch(/no credits left.*Settings → Model provider/)
  })

  it("shows OpenClaw's run-failed note as a readable failure", () => {
    const [message] = normalizeHistory([{ role: 'custom', customType: 'run-failed-before-reply', content: 'This turn ended before a reply: ⚠️ The configured model is unavailable from the provider', details: { error: '⚠️ The configured model is unavailable from the provider — it may have been renamed' } }], 's')
    expect(message!.status).toBe('failed')
    expect(message!.content).toMatch(/^The model this chat uses is not available/)
  })

  it('joins toolCall blocks with their toolResult into one tool row, never a bubble of raw output', () => {
    const history = normalizeHistory([
      { role: 'user', content: 'feed me', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'search' }, { type: 'toolCall', id: 'c1', name: 'web_search', arguments: { query: 'x' } }], timestamp: 2, __openclaw: { id: 'a1' } },
      { role: 'toolResult', toolCallId: 'c1', toolName: 'web_search', content: [{ type: 'text', text: '{"kind":"results"}' }], isError: false, timestamp: 3 },
      { role: 'assistant', content: [{ type: 'text', text: '### News\nBody' }], stopReason: 'stop', timestamp: 4 },
    ], 's')
    expect(history.map((m) => m.role)).toEqual(['user', 'tool', 'assistant'])
    expect(history[1]!.tool_calls).toEqual([{ id: 'c1', tool: 'web_search', input: { query: 'x' }, result: '{"kind":"results"}', isError: false, status: 'done' }])
    expect(history.some((m) => m.role === 'assistant' && m.content.includes('kind'))).toBe(false)
  })
})
