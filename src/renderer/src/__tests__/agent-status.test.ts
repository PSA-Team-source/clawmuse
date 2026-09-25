import { describe, expect, it } from 'vitest'
import { agentStatusFor } from '@/lib/agent-status'
import { failureNotice } from '@/stores/chat.store'

const base = { connection: 'connected' as const, pendingApprovals: 0, busy: false, streamingText: false }

describe('agentStatusFor (Muse status chrome)', () => {
  it('lets connection problems win', () => {
    expect(agentStatusFor({ ...base, connection: 'error', busy: true })).toBe('connection_error')
    expect(agentStatusFor({ ...base, connection: 'disconnected' })).toBe('disconnected')
    expect(agentStatusFor({ ...base, connection: 'booting' })).toBe('connecting')
  })
  it('puts a pending approval ahead of the run phase', () => {
    expect(agentStatusFor({ ...base, pendingApprovals: 1, busy: true })).toBe('awaiting_approval')
  })
  it('splits working from responding on streamed text', () => {
    expect(agentStatusFor({ ...base, busy: true })).toBe('working')
    expect(agentStatusFor({ ...base, busy: true, streamingText: true })).toBe('responding')
  })
  it('reads out of usage from the billing notice chat.store writes', () => {
    const lastMessage = { role: 'assistant' as const, status: 'failed' as const, content: failureNotice('402 insufficient credits') }
    expect(agentStatusFor({ ...base, lastMessage })).toBe('out_of_credits')
    expect(agentStatusFor({ ...base, lastMessage: { ...lastMessage, content: failureNotice('HTTP 401: User not found') } })).toBe('connected')
  })
})
