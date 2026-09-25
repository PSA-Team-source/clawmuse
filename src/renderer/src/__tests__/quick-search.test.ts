import { describe, expect, it } from 'vitest'
import {
  commandResults,
  conversationResults,
  fallbackResults,
  findMessageHits,
  formatQuickSearchTime,
  getQuickSearchResultSubtitle,
  getQuickSearchResultTypeLabel,
  libraryResults,
  orderQuickSearchResults,
  parseSearchSessions,
  scoreText,
  type QuickSearchResult,
} from '@/components/search/quick-search'
import type { Message } from '@/types'

const noop = () => {}
const NOW = Date.UTC(2026, 8, 23, 12)

describe('Quick Search (Muse HatchQuickSearch)', () => {
  it('scores exact > prefix > word start > substring > subsequence', () => {
    expect(scoreText('Goals', 'goals')).toBe(1)
    expect(scoreText('Goals list', 'goals')).toBe(0.92)
    expect(scoreText('My goals', 'goals')).toBe(0.84)
    expect(scoreText('Megoals', 'goals')).toBe(0.72)
    expect(scoreText('g-o-a-l-s', 'goals')).toBeGreaterThanOrEqual(0.15)
    expect(scoreText('Library', 'goals')).toBeNull()
  })

  it('shows the six most recent chats when the query is empty', () => {
    const sessions = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, title: `Chat ${index}`, updatedAtMs: NOW - index * 1000 }))
    const results = orderQuickSearchResults([
      ...conversationResults('', sessions, [], noop),
      ...commandResults('', { openGoals: noop, openLibrary: noop, openIdeas: noop }),
    ], '')
    expect(results.map((result) => result.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5'].map((id) => `chat:thread:${id}`))
  })

  it('orders by rank, caps thread titles, and keeps the ask fallback last', () => {
    const sessions = [{ id: 'a', title: 'plan trip', updatedAtMs: NOW }]
    const results = orderQuickSearchResults([
      ...fallbackResults('plan trip', 'Muse', noop),
      ...conversationResults('plan trip', sessions, [], noop),
      ...libraryResults('plan trip', [{ rootId: 'r', path: 'docs/plan trip.md', name: 'plan trip.md' }], [], noop),
    ], 'plan trip')
    expect(results.map((result) => result.source)).toEqual(['library', 'chat', 'fallback'])
    expect(results[1]!.rank).toBe(0.55)
    expect(fallbackResults('plan', 'Muse', noop)).toEqual([])
  })

  it('only offers Goals when its title matches, and Split view only when it can open', () => {
    expect(commandResults('progress', { openGoals: noop, openLibrary: noop, openIdeas: noop }).map((r) => r.id)).toEqual([])
    expect(commandResults('goa', { openGoals: noop, openLibrary: noop, openIdeas: noop }).map((r) => r.id)).toEqual(['go-goals'])
    expect(commandResults('split', { openGoals: noop, openLibrary: noop, openIdeas: noop })).toEqual([])
    expect(commandResults('split', { openSplitView: noop, openGoals: noop, openLibrary: noop, openIdeas: noop }).map((r) => r.id)).toEqual(['open-split-view'])
  })

  it('renders chat subtitles as snippet · time and everything else as its type', () => {
    const chat: QuickSearchResult = { id: 'c', title: 'Trip', details: 'Book the hotel', icon: { type: 'nav', name: 'Chat' }, source: 'chat', modifiedAtMs: NOW - 5 * 60_000, action: noop }
    expect(getQuickSearchResultSubtitle(chat, getQuickSearchResultTypeLabel(chat), NOW)).toEqual({ kind: 'chat', fullText: 'Book the hotel · 5m ago', snippet: 'Book the hotel', time: '5m ago' })
    const [file] = libraryResults('notes', [{ rootId: 'r', path: 'notes.md', name: 'notes.md' }], [], noop)
    expect(getQuickSearchResultSubtitle(file!, getQuickSearchResultTypeLabel(file!), NOW)).toEqual({ kind: 'type', fullText: 'Text', typeLabel: 'Text' })
    expect(formatQuickSearchTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago')
    expect(formatQuickSearchTime(NOW - 2 * 86_400_000, NOW)).toBe('2d ago')
  })

  it('reads sessions.list and finds message hits in the loaded transcripts', () => {
    const sessions = parseSearchSessions({ sessions: [
      { key: 'agent:main:webchat:main:conv:x', agentId: 'main', displayName: 'Hi', lastMessagePreview: '**hello** there', updatedAt: NOW },
      { key: 'agent:main:cron:y', agentId: 'main', displayName: 'Nightly', isBackground: true },
      { key: 'agent:main:webchat:main:conv:z', agentId: 'main', archived: true, displayName: 'Old' },
    ] })
    expect(sessions).toEqual([{ id: 'webchat:main:conv:x', title: 'Hi', details: 'hello there', updatedAtMs: NOW, isMain: false }])
    const message = (id: string, content: string): Message => ({ id, session_id: 'webchat:main:conv:x', role: 'assistant', content, status: 'sent', created_at: new Date(NOW).toISOString() })
    const hits = findMessageHits('hotel', sessions, { 'webchat:main:conv:x': [message('1', 'Book the **hotel** in Rome'), message('2', 'nothing')] })
    expect(hits).toEqual([{ id: 'webchat:main:conv:x:1', sessionId: 'webchat:main:conv:x', messageId: '1', snippet: 'Book the hotel in Rome', atMs: NOW }])
    expect(conversationResults('hotel', sessions, hits, noop).map((result) => [result.title, result.details])).toEqual([['Hi', 'Book the hotel in Rome']])
  })

  it('titles the main chat "Main chat" and opens a message hit at its message', () => {
    const opened: [string, string | undefined][] = []
    const sessions = [{ id: 'webchat:main', title: 'Whatever the gateway derived', details: 'latest', updatedAtMs: NOW }, { id: 'webchat:main:conv:x', title: 'Trip', updatedAtMs: NOW - 1 }]
    const hits = [{ id: 'webchat:main:7', sessionId: 'webchat:main', messageId: '7', snippet: 'the hotel' }, { id: 'u:1', sessionId: 'unknown', messageId: '1', snippet: 'hotel too' }]
    const results = conversationResults('hotel', sessions, hits, (id, messageId) => opened.push([id, messageId]), 'webchat:main')
    expect(results.map((result) => result.title)).toEqual(['Main chat', 'Side chat'])
    results[0]!.action()
    expect(opened).toEqual([['webchat:main', '7']])
    expect(conversationResults('', sessions, [], noop, 'webchat:main').map((result) => [result.id, result.title])).toEqual([['chat:main', 'Main chat'], ['chat:thread:webchat:main:conv:x', 'Trip']])
  })
})
