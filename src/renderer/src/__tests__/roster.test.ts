import { describe, expect, it } from 'vitest'
import type { BotSummary } from '@shared/ipc'
import { type RosterRow, sortRoster } from '@/stores/bots.store'
import { groupNameFor } from '@/stores/groups.store'

function row(id: string, options: Partial<RosterRow> = {}): RosterRow {
  const bot: BotSummary = {
    id,
    name: id,
    job: '',
    emoji: null,
    avatar: null,
    isDefault: false,
    workspace: null,
    model: null,
    permissions: 'full',
  }
  return { bot, sessionId: `agent:${id}:webchat:main`, unread: false, pinned: false, ...options }
}

describe('sortRoster', () => {
  it('puts pinned bots first, whatever they last said', () => {
    const sorted = sortRoster([
      row('chatty', { lastMessageAt: '2026-08-14T10:00:00Z' }),
      row('pinned', { pinned: true, lastMessageAt: '2026-08-01T10:00:00Z' }),
    ])
    expect(sorted.map((entry) => entry.bot.id)).toEqual(['pinned', 'chatty'])
  })

  it('orders the rest by who spoke last', () => {
    const sorted = sortRoster([
      row('older', { lastMessageAt: '2026-08-10T10:00:00Z' }),
      row('newer', { lastMessageAt: '2026-08-14T10:00:00Z' }),
    ])
    expect(sorted.map((entry) => entry.bot.id)).toEqual(['newer', 'older'])
  })

  it('keeps never-used bots in the order they were created', () => {
    // A fresh install has four bots and no timestamps. Sorting them by anything
    // derived would reshuffle the roster on every launch.
    const sorted = sortRoster([row('a'), row('b'), row('c')])
    expect(sorted.map((entry) => entry.bot.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input', () => {
    const rows = [row('b', { lastMessageAt: '2026-08-01T10:00:00Z' }), row('a')]
    sortRoster(rows)
    expect(rows.map((entry) => entry.bot.id)).toEqual(['b', 'a'])
  })
})

describe('groupNameFor', () => {
  it('names a pair after both', () => {
    expect(groupNameFor(['Inbox Manager', 'Talent Scout'])).toBe('Inbox Manager & Talent Scout')
  })

  it('counts the rest once a group gets crowded', () => {
    expect(groupNameFor(['A', 'B', 'C', 'D'])).toBe('A, B +2')
  })

  it('always returns something usable', () => {
    expect(groupNameFor([])).toBe('Group')
  })
})
