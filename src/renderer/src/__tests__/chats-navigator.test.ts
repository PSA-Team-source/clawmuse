import { describe, expect, it } from 'vitest'
import {
  clampChatsPanelWidth,
  hasUnreadElsewhere,
  highlightRuns,
  isSideChat,
  matchedSnippet,
  orderPinnedFirst,
  parseSearchResult,
  sideChatTitle,
  stepSearchIndex,
  titleMatches,
} from '@/routes/chat/ChatsButton'
import type { Session } from '@/types'
import { normalizeSessions } from '@/utils/gateway-normalize'

const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'New conversation', ...extra })

describe("Muse's chat navigator", () => {
  it('keeps the panel between 240px and 420px', () => {
    expect(clampChatsPanelWidth(100)).toBe(240)
    expect(clampChatsPanelWidth(300.4)).toBe(300)
    expect(clampChatsPanelWidth(900)).toBe(420)
  })

  it('lists pinned chats first in gateway order, then the rest newest first', () => {
    const rows = [{ id: 'old', t: 1 }, { id: 'pin-b', t: 0, p: true }, { id: 'new', t: 9 }, { id: 'pin-a', t: 5, p: true }]
    expect(orderPinnedFirst(rows, (r) => r.p === true, (r) => r.t).map((r) => r.id)).toEqual(['pin-b', 'pin-a', 'new', 'old'])
  })

  it("scopes side chats to the bot's own web threads, never its main chat, groups or automations", () => {
    expect(isSideChat(session('webchat:main:conv:a'), 'main')).toBe(true)
    expect(isSideChat(session('webchat:main'), 'main')).toBe(false)
    expect(isSideChat(session('webchat:group:g1'), 'main')).toBe(false)
    expect(isSideChat(session('cron:62b1'), 'main')).toBe(false)
    expect(isSideChat(session('agent:elon:webchat:main:conv:b'), 'main')).toBe(false)
    expect(isSideChat(session('agent:elon:webchat:main:conv:b'), 'elon')).toBe(true)
  })

  it('shows the trigger dot only for unread chats other than the one on screen', () => {
    const sessions = [session('webchat:main:conv:a', { unread: true }), session('webchat:main')]
    expect(hasUnreadElsewhere(sessions, 'main', 'webchat:main')).toBe(true)
    expect(hasUnreadElsewhere(sessions, 'main', 'webchat:main:conv:a')).toBe(false)
    expect(hasUnreadElsewhere([session('agent:elon:webchat:main', { unread: true })], 'main', undefined)).toBe(false)
  })

  it("titles a thread by its name, else its latest message, else Muse's fallback", () => {
    expect(sideChatTitle(session('webchat:main:conv:a', { name: 'Trip plan' }))).toBe('Trip plan')
    expect(sideChatTitle(session('webchat:main:conv:a', { last_message: '  hi there ' }))).toBe('hi there')
    expect(sideChatTitle(session('webchat:main:conv:a'))).toBe('Untitled thread')
  })

  it('matches titles on every query word and highlights exactly those words', () => {
    expect(titleMatches('Health goal for Q4', 'goal health')).toBe(true)
    expect(titleMatches('Health goal', 'goal budget')).toBe(false)
    expect(highlightRuns('A health goal', 'goal')).toEqual([{ text: 'A health ', hit: false }, { text: 'goal', hit: true }])
  })

  it('windows a long snippet around the first match on a word boundary', () => {
    const text = `${'lorem '.repeat(30)}the **feed** about interests ${'ipsum '.repeat(40)}`
    const snippet = matchedSnippet(text, 'feed', 60)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('the feed about')
    expect(snippet.length).toBeLessThanOrEqual(62)
  })

  it('moves the keyboard cursor without wrapping', () => {
    expect(stepSearchIndex('ArrowDown', -1, 3)).toBe(0)
    expect(stepSearchIndex('ArrowDown', 2, 3)).toBe(2)
    expect(stepSearchIndex('ArrowUp', 0, 3)).toBe(0)
    expect(stepSearchIndex('ArrowUp', -1, 0)).toBe(-1)
  })

  it('maps sessions.search hits onto app session ids and drops malformed rows', () => {
    const parsed = parseSearchResult({
      indexing: true,
      results: [
        { sessionKey: 'agent:main:webchat:main:conv:x', sessionId: 's', messageId: 'm1', role: 'user', timestamp: 5, snippet: 'hi', score: 1 },
        { sessionKey: 'agent:elon:webchat:main', messageId: 'm2', role: 'assistant', snippet: 'yo' },
        { messageId: 'broken' },
      ],
    })
    expect(parsed.indexing).toBe(true)
    expect(parsed.hits.map((h) => [h.sessionId, h.messageId])).toEqual([
      ['webchat:main:conv:x', 'm1'],
      ['agent:elon:webchat:main', 'm2'],
    ])
  })
})

describe('normalizeSessions — the fields the navigator reads', () => {
  it('reads label/displayName, the preview, and the read/pin/archive flags', () => {
    const [labelled, derived] = normalizeSessions({
      sessions: [
        { key: 'agent:main:webchat:main:conv:a', label: 'Renamed', displayName: 'Hi', unread: true, pinned: true, archived: false },
        { key: 'agent:main:webchat:main:conv:b', displayName: 'Make me a feed', lastMessagePreview: 'Make me a feed…', archived: true },
      ],
    })
    expect(labelled).toMatchObject({ id: 'webchat:main:conv:a', name: 'Renamed', unread: true, pinned: true })
    expect(labelled?.archived).toBeUndefined()
    expect(derived).toMatchObject({ name: 'Make me a feed', last_message: 'Make me a feed…', archived: true })
  })

  it('orders by conversation activity, not by updatedAt that every patch bumps', () => {
    const [row] = normalizeSessions([{ key: 'webchat:main:conv:a', lastInteractionAt: 1_000, endedAt: 2_000, updatedAt: 9_000 }])
    expect(row?.last_message_at).toBe(new Date(2_000).toISOString())
  })
})
