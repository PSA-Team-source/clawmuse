/**
 * Muse's Quick Search model (HatchQuickSearch): providers turn one query into
 * ranked results, and `orderQuickSearchResults` decides what the list shows.
 * Ranking, ordering, subtitles and limits follow Muse's bundle one to one;
 * only the data behind each provider is ClawMuse's own.
 */
import type { Goal } from '@/lib/goals'
import { eventSessionKey } from '@/services/session-key'
import type { Message } from '@/types'

export type QuickSearchSource = 'chat' | 'fallback' | 'command' | 'goal' | 'library'

export type QuickSearchIcon =
  | { type: 'avatar' }
  /** One of Muse's navigation glyphs (MuseNavigationIcon). */
  | { type: 'nav'; name: 'Chat' | 'Goals' | 'Library' | 'Ideas' }
  | { type: 'split-view' }
  | { type: 'file'; category: FileCategory }

export interface QuickSearchResult {
  id: string
  title: string
  details?: string
  icon: QuickSearchIcon
  rank?: number
  recencyMs?: number
  modifiedAtMs?: number
  typeLabel?: string
  source: QuickSearchSource
  action: () => void
}

export const QUICK_SEARCH_RECENT_RESULT_LIMIT = 6
const CONVERSATION_TITLE_SEARCH_LIMIT = 6
const CONVERSATION_MESSAGE_SEARCH_LIMIT = 6
const THREAD_TITLE_RESULT_RANK_CAP = 0.55
const MESSAGE_RESULT_RANK = 0.5
const GOAL_SEARCH_LIMIT = 8
const LIBRARY_SEARCH_LIMIT = 8
const ASK_FALLBACK_RANK = 0
/**
 * Muse's Library provider matches file names only. ClawMuse also finds text
 * inside local files; those hits rank below every name match.
 */
const LIBRARY_CONTENT_RESULT_RANK = 0.1

// ── Ranking (rankSearchItems / scoreText) ────────────────────────────────────

export function scoreText(value: string | null | undefined, query: string): number | null {
  const text = value?.trim().toLocaleLowerCase()
  const needle = query.trim().toLocaleLowerCase()
  if (!text || !needle) return null
  if (text === needle) return 1
  const at = text.indexOf(needle)
  if (at === 0) return 0.92
  if (at > 0) return text[at - 1] === ' ' ? 0.84 : 0.72
  // Subsequence match, scored by how tight and how early it is.
  let matched = 0
  let first = -1
  let last = -1
  for (let index = 0; index < text.length && matched < needle.length; index++) {
    if (text[index] === needle[matched]) {
      if (first === -1) first = index
      last = index
      matched++
    }
  }
  if (matched !== needle.length || first === -1 || last === -1) return null
  const density = needle.length / (last - first + 1)
  const offset = first / Math.max(text.length, 1)
  return Math.max(0.15, Math.min(0.65, density * 0.65 - offset * 0.2))
}

export interface SearchField<T> {
  value: (item: T) => string | null | undefined
  weight: number
}

export function rankSearchItems<T>(items: readonly T[], query: string, fields: readonly SearchField<T>[]): { item: T; rank: number }[] {
  const needle = query.trim()
  if (!needle) return []
  return items
    .map((item) => {
      let rank = 0
      for (const field of fields) {
        const score = scoreText(field.value(item), needle)
        if (score != null) rank = Math.max(rank, score * field.weight)
      }
      return rank > 0 ? { item, rank } : null
    })
    .filter((entry): entry is { item: T; rank: number } => entry != null)
    .sort((a, b) => b.rank - a.rank)
}

// ── Ordering ────────────────────────────────────────────────────────────────

function compareRecentSearchResults(a: QuickSearchResult, b: QuickSearchResult): number {
  return (b.recencyMs ?? 0) - (a.recencyMs ?? 0)
    || (b.modifiedAtMs ?? 0) - (a.modifiedAtMs ?? 0)
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id)
}

export function quickSearchRecentCandidates(results: readonly QuickSearchResult[]): QuickSearchResult[] {
  return results.filter((result) => result.recencyMs != null && result.source === 'chat').sort(compareRecentSearchResults)
}

/** Empty query: the six most recent chats. Otherwise by rank, unranked after ranked, the ask fallback last. */
export function orderQuickSearchResults(results: readonly QuickSearchResult[], query: string): QuickSearchResult[] {
  if (query.trim().length === 0) return quickSearchRecentCandidates(results).slice(0, QUICK_SEARCH_RECENT_RESULT_LIMIT)
  return [...results].sort((a, b) => {
    if (a.source === 'fallback' && b.source !== 'fallback') return 1
    if (b.source === 'fallback' && a.source !== 'fallback') return -1
    if (a.rank == null && b.rank == null) return 0
    if (a.rank == null) return 1
    if (b.rank == null) return -1
    return b.rank - a.rank
  })
}

// ── Presentation ────────────────────────────────────────────────────────────

export function getQuickSearchResultTypeLabel(result: QuickSearchResult): string {
  if (result.typeLabel) return result.typeLabel
  switch (result.source) {
    case 'chat':
    case 'fallback':
      return 'Chat'
    case 'command':
      return 'Command'
    case 'goal':
      return 'Goal'
    case 'library':
      return 'File'
  }
}

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/** Muse's hatchTimeUtils.formatRelativeTime: "just now", "5m ago", "3h ago", "2d ago", then "Sep 14". */
export function formatQuickSearchTime(atMs: number, now = Date.now()): string {
  const minutes = Math.floor((now - atMs) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d ago` : SHORT_DATE.format(atMs)
}

export type QuickSearchSubtitle =
  | { kind: 'type'; fullText: string; typeLabel: string }
  | { kind: 'chat'; fullText: string; snippet: string | null; time: string | null }

/** Chats show "snippet · time"; everything else shows its type label. */
export function getQuickSearchResultSubtitle(result: QuickSearchResult, typeLabel: string, now = Date.now()): QuickSearchSubtitle | null {
  if (result.source !== 'chat' && result.source !== 'fallback') return { kind: 'type', fullText: typeLabel, typeLabel }
  const snippet = result.details?.trim() || null
  const at = result.modifiedAtMs ?? result.recencyMs
  const time = at != null && at > 0 ? formatQuickSearchTime(at, now) : null
  const fullText = [snippet, time].filter((part) => part != null).join(' · ')
  return fullText ? { kind: 'chat', fullText, snippet, time } : null
}

// ── Providers ───────────────────────────────────────────────────────────────

/** A conversation as `sessions.list` describes it. */
export interface SearchSession {
  id: string
  title: string
  details?: string
  updatedAtMs?: number
  /** The agent's primary session keeps its full title rank, as Muse's main chat does. */
  isMain?: boolean
}

/**
 * Reads `sessions.list` (with derived titles and last-message previews) into
 * the conversations Quick Search can open. Archived and background sessions
 * are left out, and so is any session without a title — Muse shows no
 * untitled threads.
 */
export function parseSearchSessions(raw: unknown): SearchSession[] {
  const list = (raw as { sessions?: unknown } | null)?.sessions
  if (!Array.isArray(list)) return []
  return list.flatMap((entry): SearchSession[] => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    if (row.archived === true || row.isBackground === true || typeof row.key !== 'string' || !row.key) return []
    const title = [row.label, row.displayName, row.derivedTitle].find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
    if (!title) return []
    const preview = typeof row.lastMessagePreview === 'string' ? stripMarkdown(row.lastMessagePreview) : ''
    return [{
      id: eventSessionKey(row.key, typeof row.agentId === 'string' ? row.agentId : undefined),
      title,
      details: preview || undefined,
      updatedAtMs: typeof row.updatedAt === 'number' && row.updatedAt > 0 ? row.updatedAt : undefined,
      isMain: row.isMain === true,
    }]
  })
}

export interface MessageHit {
  id: string
  sessionId: string
  /** The transcript message id — the `data-message-id` a jump scrolls to. */
  messageId: string
  snippet: string
  atMs?: number
}

/**
 * Muse ConversationSearchProvider: the main chat is always "Main chat" (with
 * its latest snippet), side chats only when they have a title, and a message
 * hit is labelled by where it lives ("Main chat", its thread title, or "Side
 * chat") and opens that conversation at the message.
 */
export function conversationResults(
  query: string,
  sessions: readonly SearchSession[],
  messageHits: readonly MessageHit[],
  open: (sessionId: string, messageId?: string) => void,
  mainSessionId?: string,
): QuickSearchResult[] {
  const main = sessions.find((session) => session.id === mainSessionId)
  const items: (SearchSession & { isMain: boolean })[] = [
    ...(mainSessionId ? [{ id: mainSessionId, title: MAIN_CHAT_TITLE, details: main?.details, updatedAtMs: main?.updatedAtMs, isMain: true }] : []),
    ...sessions.filter((session) => session.id !== mainSessionId).map((session) => ({ ...session, isMain: false })),
  ]
  const forTitle = (session: SearchSession & { isMain: boolean }, rank?: number, recencyMs?: number): QuickSearchResult => ({
    id: session.isMain ? 'chat:main' : `chat:thread:${session.id}`,
    title: session.title,
    details: session.details,
    icon: { type: 'nav', name: 'Chat' },
    rank: !session.isMain && rank != null ? Math.min(rank, THREAD_TITLE_RESULT_RANK_CAP) : rank,
    recencyMs,
    modifiedAtMs: session.updatedAtMs,
    source: 'chat',
    action: () => open(session.id),
  })
  if (!query.trim()) return items.flatMap((session) => session.updatedAtMs == null ? [] : [forTitle(session, undefined, session.updatedAtMs)])

  const titles = rankSearchItems(items, query, [{ value: (s) => s.title, weight: 1 }, { value: (s) => s.details, weight: 0.2 }])
    .slice(0, CONVERSATION_TITLE_SEARCH_LIMIT)
    .map(({ item, rank }) => forTitle(item, rank))
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const messages = messageHits.flatMap((hit, index): QuickSearchResult[] => {
    if (!hit.snippet) return []
    const title = hit.sessionId === mainSessionId ? MAIN_CHAT_TITLE : byId.get(hit.sessionId)?.title ?? SIDE_CHAT_TITLE
    return [{
      id: `chat:message:${hit.id}`,
      title,
      details: hit.snippet,
      icon: { type: 'nav', name: 'Chat' },
      rank: MESSAGE_RESULT_RANK - index * 0.001,
      modifiedAtMs: hit.atMs,
      source: 'chat',
      action: () => open(hit.sessionId, hit.messageId),
    }]
  }).slice(0, CONVERSATION_MESSAGE_SEARCH_LIMIT)
  return [...titles, ...messages]
}

const MAIN_CHAT_TITLE = 'Main chat'
const SIDE_CHAT_TITLE = 'Side chat'

/** Strips the Markdown a transcript carries so a snippet reads as prose. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const SNIPPET_LEAD = 45
const SNIPPET_LENGTH = 180

/**
 * Transcript hits for `query`, newest conversation first and newest message
 * first within it. OpenClaw has no transcript search method, so this scans
 * the transcripts the renderer holds.
 */
export function findMessageHits(query: string, sessions: readonly SearchSession[], messages: Readonly<Record<string, readonly Message[] | undefined>>, limit = CONVERSATION_MESSAGE_SEARCH_LIMIT): MessageHit[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const hits: MessageHit[] = []
  for (const session of sessions) {
    const transcript = messages[session.id] ?? []
    for (let index = transcript.length - 1; index >= 0; index--) {
      const message = transcript[index]!
      if (message.role === 'tool' || message.status === 'failed') continue
      const text = stripMarkdown(message.content)
      const at = text.toLocaleLowerCase().indexOf(needle)
      if (at < 0) continue
      const start = Math.max(0, at - SNIPPET_LEAD)
      const atMs = Date.parse(message.created_at)
      hits.push({
        id: `${session.id}:${message.id}`,
        sessionId: session.id,
        messageId: message.id,
        snippet: `${start > 0 ? '…' : ''}${text.slice(start, start + SNIPPET_LENGTH)}`,
        atMs: Number.isNaN(atMs) ? undefined : atMs,
      })
      if (hits.length >= limit) return hits
    }
  }
  return hits
}

export function goalResults(query: string, goals: readonly Goal[], openGoals: () => void): QuickSearchResult[] {
  return rankSearchItems(goals, query, [{ value: (goal) => goal.title, weight: 1 }])
    .slice(0, GOAL_SEARCH_LIMIT)
    .map(({ item, rank }) => ({
      id: `goal:${item.id}`,
      title: item.title || 'Untitled goal',
      details: 'Open this goal',
      icon: { type: 'nav', name: 'Goals' },
      rank,
      source: 'goal',
      action: openGoals,
    }))
}

export type FileCategory = 'image' | 'video' | 'audio' | 'pdf' | 'file'

const IMAGE_EXTENSIONS = new Set(['apng', 'avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'])
const VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus'])
const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF', doc: 'Word', docx: 'Word', mp4: 'MP4', mov: 'MOV', ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', json: 'JSON', yaml: 'YAML', yml: 'YAML', md: 'Text', html: 'HTML', css: 'CSS',
  sql: 'SQL', sh: 'Shell', txt: 'Text', csv: 'CSV', xml: 'XML', toml: 'TOML', graphql: 'GraphQL',
}

function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function fileCategory(name: string): FileCategory {
  const extension = fileExtension(name)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return extension === 'pdf' ? 'pdf' : 'file'
}

/** Muse's getFileTypeLabel: a known name, else the extension in capitals. */
export function fileTypeLabel(name: string): string {
  const extension = fileExtension(name)
  return FILE_TYPE_LABELS[extension] ?? extension.toUpperCase()
}

export interface LibraryFile {
  rootId: string
  path: string
  name: string
  modifiedMs?: number
}

export function libraryResults(
  query: string,
  files: readonly LibraryFile[],
  contentMatches: readonly LibraryFile[],
  openFile: (file: LibraryFile) => void,
): QuickSearchResult[] {
  const forFile = (file: LibraryFile, rank: number): QuickSearchResult => ({
    id: `library:${file.rootId}:${file.path}`,
    title: file.name,
    icon: { type: 'file', category: fileCategory(file.name) },
    rank,
    modifiedAtMs: file.modifiedMs,
    typeLabel: fileTypeLabel(file.name),
    source: 'library',
    action: () => openFile(file),
  })
  const named = rankSearchItems(files, query, [{ value: (file) => file.name, weight: 1 }, { value: (file) => file.path, weight: 0.15 }])
    .map(({ item, rank }) => forFile(item, rank))
  const seen = new Set(named.map((result) => result.id))
  const inside = contentMatches
    .map((file, index) => forFile(file, LIBRARY_CONTENT_RESULT_RANK - index * 0.001))
    .filter((result) => !seen.has(result.id))
  return [...named, ...inside].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, LIBRARY_SEARCH_LIMIT)
}

export interface CommandTargets {
  /** Present only where the side-by-side chat can actually open. */
  openSplitView?: () => void
  openGoals: () => void
  openLibrary: () => void
  openIdeas: () => void
}

/**
 * Muse renders this provider with `includeChatResult: false`. Its empty-query
 * defaults are dropped by `orderQuickSearchResults` (recents are chats only),
 * so they are not produced here.
 */
export function commandResults(query: string, targets: CommandTargets): QuickSearchResult[] {
  if (!query.trim()) return []
  const goals: QuickSearchResult = { id: 'go-goals', title: 'Goals', details: 'Track plans and progress', icon: { type: 'nav', name: 'Goals' }, source: 'command', action: targets.openGoals }
  const commands: QuickSearchResult[] = [
    ...(targets.openSplitView ? [{ id: 'open-split-view', title: 'Split view', details: 'Show chat next to the current view', icon: { type: 'split-view' }, source: 'command', action: targets.openSplitView } satisfies QuickSearchResult] : []),
    goals,
    { id: 'go-library', title: 'Library', details: 'Browse documents, media, and more', icon: { type: 'nav', name: 'Library' }, source: 'command', action: targets.openLibrary },
    { id: 'go-explore', title: 'Ideas', details: 'Find inspiration for what to create', icon: { type: 'nav', name: 'Ideas' }, source: 'command', action: targets.openIdeas },
  ]
  const goalsTitleMatches = rankSearchItems([goals], query, [{ value: (result) => result.title, weight: 1 }]).length > 0
  return rankSearchItems(commands, query, [{ value: (result) => result.title, weight: 1 }, { value: (result) => result.details, weight: 0.2 }])
    .map(({ item, rank }) => ({ ...item, rank }))
    .filter((result) => result.id !== 'go-goals' || goalsTitleMatches)
}

/** "Send message to {assistantName}" — offered once the query reads like a sentence (two words or more). */
export function fallbackResults(query: string, assistantName: string, ask: (text: string) => void): QuickSearchResult[] {
  const text = query.trim()
  if (text.split(/\s+/).length < 2) return []
  return [{ id: 'ask-agent', title: text, details: `Send message to ${assistantName}`, rank: ASK_FALLBACK_RANK, icon: { type: 'avatar' }, source: 'fallback', action: () => ask(text) }]
}
