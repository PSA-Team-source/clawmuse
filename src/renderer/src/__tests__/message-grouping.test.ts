import { describe, expect, it } from 'vitest'
import { groupRows } from '@/components/chat/MessageList'
import { bubbleRadius } from '@/components/chat/MessageBubble'
import type { Message } from '@/types'

const at = (s: number) => new Date(Date.UTC(2026, 8, 24, 9, 0, s)).toISOString()
const msg = (id: string, role: Message['role'], s: number): { kind: 'message'; key: string; message: Message } =>
  ({ kind: 'message', key: id, message: { id, session_id: 's', role, content: id, status: 'sent', created_at: at(s) } })

describe('Muse message grouping', () => {
  it('groups same-side bubbles under two minutes apart', () => {
    const rows = groupRows([msg('a', 'user', 0), msg('b', 'user', 30), msg('c', 'assistant', 40), msg('d', 'assistant', 200)], () => false)
    const g = rows.map((r) => (r.kind === 'message' ? r.grouping : null))
    expect(g).toEqual([{ prev: false, next: true }, { prev: true, next: false }, { prev: false, next: false }, { prev: false, next: false }])
  })
  it('a reaction or a time marker between breaks the group', () => {
    const rows = groupRows([msg('a', 'user', 0), msg('b', 'user', 5)], (id) => id === 'a')
    expect(rows.map((r) => (r.kind === 'message' ? r.grouping?.prev : null))).toEqual([false, false])
    const split = groupRows([msg('a', 'user', 0), { kind: 'time', key: 't', at: at(1) }, msg('b', 'user', 5)], () => false)
    expect(split.filter((r) => r.kind === 'message').map((r) => (r.kind === 'message' ? r.grouping?.prev : null))).toEqual([false, false])
  })
  it('tucks the speaker-side corners to 6px', () => {
    expect(bubbleRadius(false, { prev: true, next: true })).toBe('6px 22px 22px 6px')
    expect(bubbleRadius(true, { prev: true, next: false })).toBe('22px 6px 22px 22px')
    expect(bubbleRadius(true, { prev: false, next: false })).toBeUndefined()
  })
})
