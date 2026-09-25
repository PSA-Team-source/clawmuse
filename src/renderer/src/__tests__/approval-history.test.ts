import { describe, expect, it } from 'vitest'
import { historyFromResolved, parseExecApproval, recordApproval, type ApprovalHistoryEntry } from '@/stores/approvals.store'
import { pendingItems } from '@/routes/status/ApprovalsTab'

const entry = (id: string, decidedAtMs: number, outcome: ApprovalHistoryEntry['outcome'] = 'deny'): ApprovalHistoryEntry => ({ id, kind: 'exec', title: id, outcome, decidedAtMs })

describe('approvals', () => {
  it('parses the OpenClaw exec request shape and the legacy flat one', () => {
    const parsed = parseExecApproval({ id: 'a1', request: { command: 'rm -rf build', cwd: '/w', sessionKey: 'agent:scout:webchat:main', allowedDecisions: ['allow-once', 'deny', 'nope'] }, createdAtMs: 5, expiresAtMs: 99 })
    expect(parsed).toMatchObject({ id: 'a1', command: 'rm -rf build', args: 'rm -rf build', cwd: '/w', allowedDecisions: ['allow-once', 'deny'], expiresAtMs: 99, receivedAt: 5 })
    expect(parseExecApproval({ id: 'b', tool: 'exec', args: { x: 1 } }, 7)).toMatchObject({ id: 'b', tool: 'exec', receivedAt: 7 })
    expect(parseExecApproval({ id: 'c', request: { command: '  ' } })).toBeNull()
    expect(parseExecApproval({ id: 1 })).toBeNull()
  })

  it('turns a resolved broadcast into a history entry, ignoring unknown decisions', () => {
    expect(historyFromResolved('exec', { id: 'a', decision: 'allow-always', ts: 10, request: { command: 'ls', sessionKey: 'agent:scout:webchat:main' } }))
      .toEqual({ id: 'a', kind: 'exec', title: 'ls', detail: undefined, agentId: 'scout', outcome: 'allow-always', decidedAtMs: 10 })
    expect(historyFromResolved('plugin', { id: 'p', decision: 'deny', ts: 3, request: { title: 'Use card', description: 'Visa 4242' } }))
      .toMatchObject({ kind: 'plugin', title: 'Use card', detail: 'Visa 4242', outcome: 'deny' })
    expect(historyFromResolved('exec', { id: 'a', decision: 'maybe', request: { command: 'ls' } })).toBeNull()
  })

  it('keeps history newest first, one row per approval, capped', () => {
    let history: ApprovalHistoryEntry[] = []
    history = recordApproval(history, entry('a', 1))
    history = recordApproval(history, entry('b', 3))
    // The gateway's broadcast of the same approval replaces the local guess.
    history = recordApproval(history, entry('a', 2, 'allow-once'))
    expect(history.map((item) => [item.id, item.outcome])).toEqual([['b', 'deny'], ['a', 'allow-once']])
    expect(recordApproval(history, entry('c', 4), 2).map((item) => item.id)).toEqual(['c', 'b'])
  })

  it('merges both queues oldest first with the bot named', () => {
    const exec = [{ id: 'e', tool: 'a command', command: 'make', sessionKey: 'agent:scout:webchat:main', receivedAt: 20 }]
    const plugin = [{ id: 'p', title: 'Use card', description: '', severity: 'warning' as const, allowedDecisions: ['allow-once' as const, 'deny' as const], createdAtMs: 10 }]
    const items = pendingItems(exec, plugin, (id) => (id === 'scout' ? 'Scout' : 'Your agent'))
    expect(items.map((item) => [item.key, item.title, item.detail])).toEqual([['plugin:p', 'Use card', null], ['exec:e', 'Scout wants to run a command', 'make']])
  })
})
