import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Add01Icon,
  Archive02Icon,
  ArchiveRestoreIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  Delete02Icon,
  Menu01Icon,
  MessageMultiple01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  Search01Icon,
  SidebarLeftIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { AlertDialog, Icon, Menu, Tooltip } from '@/components/primitives'
import { GhostButton, Spinner } from '@/components/brand'
import { EmptyState, useToast } from '@/components/patterns'
import { compactAge } from '@/components/status/StatusParts'
import { errorMessage, useDebounced } from '@/hooks'
import { cn } from '@/lib/cn'
import { revealMessage } from '@/lib/reveal-message'
import { gatewayWS } from '@/services/gateway-ws.service'
import { agentIdFromSessionKey, botMainSessionKey, DEFAULT_AGENT_ID, eventSessionKey, normalizeSessionKey } from '@/services/session-key'
import { useChatStore } from '@/stores/chat.store'
import { useGatewayStore } from '@/stores/gateway.store'
import type { Session } from '@/types'
import { normalizeSessions, prettySessionName } from '@/utils/gateway-normalize'

/**
 * Muse's chat navigator — the "Chats" pill and the panel it opens
 * (HatchChatNavBar's switcher, HatchDockSideChatsPanel, HatchChatSearchPopover
 * in its inline presentation, HatchThreadRow).
 *
 * Every row, flag and hit is the gateway's: archive, pin, unread and rename are
 * `sessions.patch` fields, the archived view is `sessions.list {archived:true}`,
 * and message search is OpenClaw's transcript index (`sessions.search`).
 */

// Muse's bounds (useHatchResizablePaneFrame / HatchPanelResizeHandle).
const MIN_WIDTH = 240
const MAX_WIDTH = 420
const NUDGE_PX = 24
const COARSE_NUDGE_PX = 96
const CLICK_SLOP_PX = 4
/** getPanelDragCloseWidth(240): dragging the edge to within 20px closes the panel. */
const DRAG_CLOSE_WIDTH = 20
const PAGE_SIZE = 25
const SNIPPET_LENGTH = 160
const SNIPPET_LEAD = 32

const WIDTH_KEY = 'clawmuse.chatsPanelWidth'
const PINNED_KEY = 'clawmuse.chatsPanel.pinned'
const SECTION_KEY = 'clawmuse.chatsPanel.sideChatsExpanded'
const FOCUS_TRIGGER_EVENT = 'clawmuse-focus-chats-trigger'
const ARCHIVED_QUERY_KEY = ['sessions', 'archived'] as const

// Hover-revealed row parts (HatchNavRowContent's REVEAL_* / HIDE_ON_REVEAL).
const REVEAL_INLINE = 'hidden group-hover/row:inline group-focus-within/row:inline'
const REVEAL_FLEX = 'hidden group-hover/row:flex group-focus-within/row:flex'
const HIDE_ON_REVEAL = 'flex group-hover/row:hidden group-focus-within/row:hidden'
const ROW_TONE = { active: 'bg-fill-raised', idle: 'hover:bg-fill-raised' } as const
const HIGHLIGHT = { title: 'font-semibold text-content-primary', snippet: 'font-semibold text-content-primary' } as const
/** The handle's cursor says which way it can still go (HatchPanelResizeHandle). */
const RESIZE_CURSOR = { both: 'cursor-col-resize', grow: 'cursor-e-resize', shrink: 'cursor-w-resize' } as const

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* private window or blocked storage: this window only */ }
}

// ── Pure rules (exported for the test) ─────────────────────────────────────

export function clampChatsPanelWidth(width: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)))
}

/** Muse's orderPinnedFirstWithRecentUnpinned: pinned keep the gateway's order, the rest go newest first. */
export function orderPinnedFirst<T>(items: T[], isPinned: (item: T) => boolean, time: (item: T) => number): T[] {
  const pinned: T[] = []
  const rest: T[] = []
  for (const item of items) (isPinned(item) ? pinned : rest).push(item)
  rest.sort((a, b) => time(b) - time(a))
  return [...pinned, ...rest]
}

/** The bot a session belongs to — an unprefixed key is the default agent's. */
export function sessionOwner(id: string): string {
  return agentIdFromSessionKey(id) ?? DEFAULT_AGENT_ID
}

/** Side chats are a bot's own web conversations other than its main chat; automation and group runs live elsewhere. */
export function isSideChat(session: Session, botId: string): boolean {
  if (sessionOwner(session.id) !== botId || session.id === botMainSessionKey(botId)) return false
  const local = normalizeSessionKey(session.id)
  return local.startsWith('webchat:') && !local.startsWith('webchat:group:')
}

/** Muse's title chain: the name the gateway or the user gave it, else the latest message, else "Untitled thread". */
export function sideChatTitle(session: Pick<Session, 'id' | 'name' | 'last_message'>): string {
  const named = session.name.trim()
  if (named && named !== prettySessionName(session.id)) return named
  return session.last_message?.trim() || 'Untitled thread'
}

export function activityTime(session: Pick<Session, 'last_message_at'>): number {
  const at = session.last_message_at ? Date.parse(session.last_message_at) : Number.NaN
  return Number.isFinite(at) ? at : 0
}

/** HatchChatNavBar's badge: something unread that is not the thread already on screen. */
export function hasUnreadElsewhere(sessions: Session[], botId: string, currentSessionId: string | undefined): boolean {
  const main = botMainSessionKey(botId)
  return sessions.some((s) => s.unread === true && !s.archived && s.id !== currentSessionId && (s.id === main || isSideChat(s, botId)))
}

function queryTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/** doesThreadTitleMatchQuery: every word of the query appears in the title. */
export function titleMatches(title: string, query: string): boolean {
  const tokens = queryTokens(query)
  const haystack = title.toLowerCase()
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token))
}

function stripMarkdown(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~#>]+/g, '').replace(/\s+/g, ' ').trim()
}

/** buildMatchedSearchSnippet: a window that starts a little before the first match, on a word boundary. */
export function matchedSnippet(raw: string, query: string, maxLength = SNIPPET_LENGTH): string {
  const text = stripMarkdown(raw)
  const lower = text.toLowerCase()
  const whole = query.trim().toLowerCase()
  let index = whole ? lower.indexOf(whole) : -1
  let length = whole.length
  if (index < 0) {
    for (const token of queryTokens(query)) {
      const at = lower.indexOf(token)
      if (at >= 0 && (index < 0 || at < index)) { index = at; length = token.length }
    }
  }
  if (index < 0) return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`
  let start = Math.max(0, index - SNIPPET_LEAD)
  if (start > 0) {
    const space = text.slice(start, index).search(/\s/)
    start = space >= 0 ? start + space + 1 : index
  }
  let end = Math.max(Math.min(text.length, start + Math.max(length, maxLength - (start > 0 ? 2 : 1))), index + length)
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > index + length) end = space
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/** HighlightedSnippet: the text split into runs, each flagged when it is one of the query's words. */
export function highlightRuns(text: string, query: string): { text: string; hit: boolean }[] {
  const tokens = queryTokens(query)
  if (!tokens.length) return [{ text, hit: false }]
  const pattern = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(pattern).filter(Boolean).map((part) => ({ text: part, hit: tokens.includes(part.toLowerCase()) }))
}

/** ArrowUp/ArrowDown through the results the way HatchChatSearchPopover does: clamp, never wrap. */
export function stepSearchIndex(key: 'ArrowDown' | 'ArrowUp', index: number, count: number): number {
  if (count === 0) return -1
  return key === 'ArrowDown' ? Math.min(index + 1, count - 1) : Math.max(index - 1, 0)
}

export interface SearchHit {
  sessionId: string
  messageId: string
  role: 'user' | 'assistant'
  timestamp: number
  snippet: string
}

/** `sessions.search` → hits keyed by this app's session ids. Anything malformed is dropped, not guessed at. */
export function parseSearchResult(raw: unknown): { hits: SearchHit[]; indexing: boolean } {
  const body = (raw ?? {}) as { results?: unknown; indexing?: unknown }
  const hits = (Array.isArray(body.results) ? body.results : []).flatMap((entry): SearchHit[] => {
    const hit = entry as Record<string, unknown>
    if (typeof hit.sessionKey !== 'string' || typeof hit.messageId !== 'string' || typeof hit.snippet !== 'string') return []
    return [{
      sessionId: eventSessionKey(hit.sessionKey),
      messageId: hit.messageId,
      role: hit.role === 'user' ? 'user' : 'assistant',
      timestamp: typeof hit.timestamp === 'number' ? hit.timestamp : 0,
      snippet: hit.snippet,
    }]
  })
  return { hits, indexing: body.indexing === true }
}

// ── Open / pinned state ─────────────────────────────────────────────────────

/**
 * "Keep chat panel visible" is Muse's pin: remembered, and a pinned panel is
 * open in every chat. Unpinned, it closes once a chat is chosen. Closing a
 * pinned panel unpins it, as dragging Muse's divider shut does.
 */
export function useChatsPanel() {
  const [pinned, setPinnedState] = useState(() => read(PINNED_KEY) === '1')
  const [open, setOpen] = useState(pinned)
  const setPinned = useCallback((value: boolean) => {
    write(PINNED_KEY, value ? '1' : '0')
    setPinnedState(value)
    if (value) setOpen(true)
  }, [])
  const close = useCallback(() => {
    setOpen(false)
    setPinnedState((value) => { if (value) write(PINNED_KEY, '0'); return false })
  }, [])
  const toggle = useCallback(() => (open ? close() : setOpen(true)), [close, open])
  return { open, pinned, setPinned, close, toggle }
}

function useBotId(currentSessionId: string | undefined): string {
  return currentSessionId ? sessionOwner(currentSessionId) : DEFAULT_AGENT_ID
}

// ── Trigger ─────────────────────────────────────────────────────────────────

/** HatchChatNavBar's switcher pill: the thread's title (or "Chats"), with Muse's blue dot for unread elsewhere. */
export function ChatsButton({ currentSessionId, open, onToggle }: { currentSessionId?: string; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const botId = useBotId(currentSessionId)
  const sessions = useChatStore((state) => state.sessions)
  const current = sessions.find((s) => s.id === currentSessionId)
  const unread = hasUnreadElsewhere(sessions, botId, currentSessionId)
  const label = current && current.id !== botMainSessionKey(botId) ? sideChatTitle(current) : 'Chats'

  useEffect(() => {
    const focus = () => ref.current?.focus()
    window.addEventListener(FOCUS_TRIGGER_EVENT, focus)
    return () => window.removeEventListener(FOCUS_TRIGGER_EVENT, focus)
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      data-testid="chats-switcher-trigger"
      // CHAT_NAV_AVATAR_SAFE_MAX_WIDTH: a long title stops short of the centred agent avatar.
      style={{ maxWidth: 'min(320px, calc(50% - 92px))' }}
      className="no-drag flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-full bg-bg-panel ps-3 pe-3.5 text-body font-medium text-content-primary shadow-composer"
    >
      <span className="relative flex shrink-0 items-center">
        <Icon icon={Menu01Icon} size={20} className="text-content-secondary" />
        {unread && <span data-testid="chats-unread-indicator" aria-hidden="true" className="absolute -end-0.5 -top-px size-2 rounded-full bg-muse-blue ring-2 ring-bg-panel" />}
      </span>
      <span className="block min-w-0 truncate" title={label}>{label}</span>
      {unread && <span className="sr-only">Unread chats</span>}
      <span className="sr-only">Open chat and side chats</span>
    </button>
  )
}

// ── Panel ───────────────────────────────────────────────────────────────────

type SearchResult =
  | { kind: 'title'; key: string; session: Session }
  | { kind: 'message'; key: string; hit: SearchHit }

interface ChatsPanelProps {
  currentSessionId?: string
  pinned: boolean
  onPinnedChange: (pinned: boolean) => void
  onClose: () => void
}

export function ChatsPanel({ currentSessionId, pinned, onPinnedChange, onClose }: ChatsPanelProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const botId = useBotId(currentSessionId)
  const mainKey = botMainSessionKey(botId)
  const sessions = useChatStore((state) => state.sessions)
  const status = useChatStore((state) => state.sessionsStatus)
  const loadSessions = useChatStore((state) => state.loadSessions)
  const createSession = useChatStore((state) => state.createSession)
  const patchSession = useChatStore((state) => state.patchSession)
  const deleteSession = useChatStore((state) => state.deleteSession)
  const connected = useGatewayStore((state) => state.connectionState) === 'connected'

  const [width, setWidth] = useState(() => clampChatsPanelWidth(Number(read(WIDTH_KEY)) || MIN_WIDTH))
  const [view, setView] = useState<'threads' | 'archived'>('threads')
  const [query, setQueryState] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  /** A new query starts the keyboard cursor over, as Muse's onChange does. */
  const setQuery = (value: string) => { setQueryState(value); setActiveIndex(-1) }
  const [expanded, setExpanded] = useState(() => read(SECTION_KEY) !== '0')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [archivedCount, setArchivedCount] = useState(PAGE_SIZE)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamePending, setRenamePending] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // The panel is where people look for "what changed" — refresh on open, and
  // again whenever a reply finishes anywhere.
  const busy = useChatStore((state) => Object.values(state.isTyping).some(Boolean))
  useEffect(() => { if (!busy) void loadSessions() }, [busy, loadSessions])

  // Muse focuses the search field when the panel opens, unless it is pinned.
  useEffect(() => { if (!pinned) searchRef.current?.focus() }, [pinned])

  const archivedQuery = useQuery({
    queryKey: ARCHIVED_QUERY_KEY,
    queryFn: async () => normalizeSessions(await gatewayWS.getArchivedSessions()),
    enabled: connected,
    staleTime: 30_000,
  })
  const archived = useMemo(
    () => orderPinnedFirst((archivedQuery.data ?? []).filter((s) => sessionOwner(s.id) === botId && (s.id === mainKey || isSideChat(s, botId))), () => false, activityTime),
    [archivedQuery.data, botId, mainKey],
  )

  const main = sessions.find((s) => s.id === mainKey)
  const sideChats = useMemo(
    () => orderPinnedFirst(sessions.filter((s) => isSideChat(s, botId)), (s) => s.pinned === true, activityTime),
    [botId, sessions],
  )
  const drafting = !currentSessionId
  const loading = status === 'loading' && sideChats.length === 0 && !main
  const fullyEmpty = !loading && status !== 'error' && sideChats.length === 0 && archivedQuery.isSuccess && archived.length === 0
  const shownSideChats = sideChats.slice(0, visibleCount)

  // ── Search ──
  const needle = query.trim()
  const debounced = useDebounced(needle, 200)
  // The gateway filters by explicit keys, fully qualified: this bot's main chat and side chats.
  const searchKeys = useMemo(
    () => [...(main ? [main] : []), ...sideChats].map((s) => `agent:${botId}:${normalizeSessionKey(s.id)}`),
    [botId, main, sideChats],
  )
  const searchQuery = useQuery({
    queryKey: ['sessions', 'search', debounced, searchKeys],
    queryFn: async () => parseSearchResult(await gatewayWS.searchSessions(debounced, searchKeys)),
    enabled: connected && debounced.length > 0 && searchKeys.length > 0,
    staleTime: 15_000,
  })
  const titleResults = useMemo<SearchResult[]>(
    () => (needle ? sideChats.filter((s) => titleMatches(sideChatTitle(s), needle)).map((session) => ({ kind: 'title' as const, key: `title:${session.id}`, session })) : []),
    [needle, sideChats],
  )
  const messagesCurrent = debounced === needle && searchQuery.isSuccess
  const results = useMemo<SearchResult[]>(() => {
    if (!needle) return []
    const hits = messagesCurrent
      ? (searchQuery.data?.hits ?? [])
          .filter((hit) => sessionOwner(hit.sessionId) === botId)
          .map((hit) => ({ kind: 'message' as const, key: `message:${hit.sessionId}:${hit.messageId}`, hit }))
      : []
    return [...titleResults, ...hits]
  }, [botId, messagesCurrent, needle, searchQuery.data, titleResults])
  const searching = needle.length > 0 && (debounced !== needle || searchQuery.isFetching)

  // Infinite list, 25 rows at a time (Muse's ACTIVE_SESSIONS_PAGE_SIZE).
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasMore = shownSideChats.length < sideChats.length
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleCount((count) => count + PAGE_SIZE)
    }, { root: listRef.current, rootMargin: '0px 0px 160px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, expanded, view, needle])

  const closePanel = useCallback(() => {
    onClose()
    requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_TRIGGER_EVENT)))
  }, [onClose])

  function afterSelect(): void {
    if (!pinned) onClose()
  }

  function openThread(id: string): void {
    afterSelect()
    if (id !== currentSessionId) navigate(`/chat/${encodeURIComponent(id)}`)
  }

  function openHit(hit: SearchHit): void {
    openThread(hit.sessionId)
    revealMessage(hit.messageId)
  }

  function newSideChat(): void {
    afterSelect()
    // The default bot's draft is the /chat composer (it creates the thread on
    // send, as Muse's draft route does). Another bot's needs its own key.
    if (botId === DEFAULT_AGENT_ID) navigate('/chat')
    else navigate(`/chat/${encodeURIComponent(createSession({ agentId: botId }))}`)
  }

  function select(result: SearchResult, index: number): void {
    setActiveIndex(index)
    if (result.kind === 'title') openThread(result.session.id)
    else openHit(result.hit)
  }

  function moveTo(index: number): void {
    setActiveIndex(index)
    if (index >= 0) listRef.current?.querySelector(`[data-search-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveTo(stepSearchIndex(event.key, activeIndex, results.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const result = results[activeIndex]
      if (result) select(result, activeIndex)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closePanel()
    }
  }

  // ── Row actions (useHatchSideChatActions) ──
  async function setArchived(session: Session, value: boolean): Promise<void> {
    try {
      await patchSession(session.id, { archived: value, expectedSessionId: session.gateway_session_id })
      await queryClient.invalidateQueries({ queryKey: ARCHIVED_QUERY_KEY })
      show({ title: value ? 'Successfully archived' : 'Successfully restored', variant: 'success' })
    } catch (error) {
      show({ title: value ? 'Failed to archive chat' : 'Failed to restore chat', description: errorMessage(error), variant: 'error' })
    }
  }

  async function togglePin(session: Session): Promise<void> {
    try {
      await patchSession(session.id, { pinned: !session.pinned })
    } catch (error) {
      show({ title: 'Failed to update pin', description: errorMessage(error), variant: 'error' })
    }
  }

  async function rename(session: Session, title: string): Promise<void> {
    setRenamePending(true)
    try {
      await patchSession(session.id, { name: title })
      setRenamingId(null)
      show({ title: 'Thread renamed', variant: 'success' })
    } catch (error) {
      show({ title: 'Failed to rename thread', description: errorMessage(error), variant: 'error' })
    } finally {
      setRenamePending(false)
    }
  }

  async function confirmDelete(): Promise<void> {
    const target = deleteTarget
    if (!target) return
    setDeleting(true)
    try {
      await deleteSession(target.id)
      setDeleteTarget(null)
      show({ title: 'Side chat deleted', variant: 'success' })
      if (target.id === currentSessionId) navigate(main ? `/chat/${encodeURIComponent(mainKey)}` : '/chat')
    } catch (error) {
      show({ title: 'Failed to delete side chat', description: errorMessage(error), variant: 'error' })
    } finally {
      setDeleting(false)
    }
  }

  // ── Resize ──
  function commitWidth(next: number): void {
    const clamped = clampChatsPanelWidth(next)
    setWidth(clamped)
    write(WIDTH_KEY, String(clamped))
  }

  function onHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    const handle = event.currentTarget
    const startX = event.clientX
    const startWidth = width
    let moved = false
    handle.setPointerCapture(event.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - startX) > CLICK_SLOP_PX) moved = true
      if (moved) setWidth(clampChatsPanelWidth(startWidth + e.clientX - startX))
    }
    const finish = (e: PointerEvent) => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (e.type === 'pointercancel') { setWidth(startWidth); return }
      const raw = startWidth + e.clientX - startX
      // A click on the divider, or a drag all the way shut, closes the panel.
      if (!moved || raw <= DRAG_CLOSE_WIDTH) { setWidth(startWidth); closePanel(); return }
      commitWidth(raw)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }

  function onHandleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Home') { event.preventDefault(); commitWidth(MIN_WIDTH); return }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? COARSE_NUDGE_PX : NUDGE_PX
    commitWidth(width + (event.key === 'ArrowRight' ? step : -step))
  }

  const cursor = width <= MIN_WIDTH ? RESIZE_CURSOR.grow : width >= MAX_WIDTH ? RESIZE_CURSOR.shrink : RESIZE_CURSOR.both

  function sessionLabel(hit: SearchHit): string {
    if (hit.sessionId === mainKey) return 'Main chat'
    const known = sessions.find((s) => s.id === hit.sessionId) ?? archived.find((s) => s.id === hit.sessionId)
    return known ? sideChatTitle(known) : 'Side chat'
  }

  const optionsMenu = (
    <Menu
      align="end"
      trigger={
        <button type="button" aria-label="Side chat options" title="Side chat options" data-testid="side-chats-options" className="flex size-6 cursor-pointer items-center justify-center rounded-full text-content-secondary hover:bg-fill-raised">
          <Icon icon={MoreHorizontalIcon} size={20} className="text-current" />
        </button>
      }
    >
      <Menu.CheckboxItem checked={pinned} onCheckedChange={onPinnedChange}>
        {!pinned && <Icon icon={SidebarLeftIcon} size={15} className="text-current" />}
        Keep chat panel visible
      </Menu.CheckboxItem>
      <Menu.Separator />
      <Menu.Item onClick={() => { setQuery(''); setArchivedCount(PAGE_SIZE); setView('archived') }}>
        <Icon icon={Archive02Icon} size={15} className="text-current" />
        Show archived chats
      </Menu.Item>
    </Menu>
  )

  function renderRow(session: Session, options: { archivedRow?: boolean } = {}): ReactNode {
    const title = sideChatTitle(session)
    return (
      <ThreadRow
        key={session.id}
        title={title}
        timestamp={activityTime(session)}
        isActive={!options.archivedRow && session.id === currentSessionId}
        hasUnread={!options.archivedRow && session.unread === true}
        pinned={!options.archivedRow && session.pinned === true}
        onClick={() => openThread(session.id)}
        renaming={renamingId === session.id}
        renamePending={renamePending}
        onRenameSubmit={(next) => void rename(session, next)}
        onRenameCancel={() => setRenamingId(null)}
        menu={
          options.archivedRow ? (
            <Menu.Item onClick={() => void setArchived(session, false)}>
              <Icon icon={ArchiveRestoreIcon} size={15} className="text-current" />
              Restore from archive
            </Menu.Item>
          ) : (
            <>
              <Menu.Item onClick={() => void togglePin(session)}>
                <Icon icon={session.pinned ? PinOffIcon : PinIcon} size={15} className="text-current" />
                {session.pinned ? 'Unpin' : 'Pin'}
              </Menu.Item>
              <Menu.Item onClick={() => setRenamingId(session.id)}>
                <Icon icon={PencilEdit02Icon} size={15} className="text-current" />
                Rename
              </Menu.Item>
              {/* A thread that was never sent exists only here; there is nothing on the gateway to archive. */}
              {session.gateway_session_id && (
                <Menu.Item onClick={() => void setArchived(session, true)}>
                  <Icon icon={Archive02Icon} size={15} className="text-current" />
                  Archive
                </Menu.Item>
              )}
              <Menu.Item tone="danger" onClick={() => setDeleteTarget(session)}>
                <Icon icon={Delete02Icon} size={15} className="text-current" />
                Delete
              </Menu.Item>
            </>
          )
        }
      />
    )
  }

  let body: ReactNode
  if (needle) {
    const failed = searchQuery.isError && debounced === needle
    body = searching && results.length === 0 ? (
      <div className="flex items-center justify-center py-8"><Spinner size={20} /></div>
    ) : failed && results.length === 0 ? (
      <p className="px-2 py-6 text-center text-caption text-error">{errorMessage(searchQuery.error)}</p>
    ) : !connected && results.length === 0 ? (
      <p className="px-2 py-6 text-center text-caption text-content-secondary">Search needs the agent to be connected.</p>
    ) : results.length === 0 ? (
      <p className="px-2 py-6 text-center text-caption text-content-secondary">
        {searchQuery.data?.indexing ? 'Still indexing your chats. Try again in a moment.' : 'No results found'}
      </p>
    ) : (
      <div className="flex flex-col" role="listbox" aria-label="Search results">
        {results.map((result, index) => (
          <div key={result.key} data-search-index={index} className="group/hit rounded-xl hover:bg-fill-raised">
            {index > 0 && <div aria-hidden="true" className="mx-2 h-px bg-line-hairline group-hover/hit:opacity-0" />}
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => select(result, index)}
              className={cn('flex w-full cursor-pointer flex-col rounded-xl px-2 py-1.5 text-start', index === activeIndex && ROW_TONE.active)}
            >
              {result.kind === 'title' ? (
                <>
                  <p className="truncate px-1 text-body-sm text-content-primary" title={sideChatTitle(result.session)}>
                    <Highlighted text={sideChatTitle(result.session)} query={needle} hitClass={HIGHLIGHT.title} />
                  </p>
                  <ResultMeta time={activityTime(result.session)} label="Side chat" />
                </>
              ) : (
                <>
                  <p className="-mt-0.5 line-clamp-2 px-1 text-caption text-content-secondary">
                    <Highlighted text={matchedSnippet(result.hit.snippet, needle)} query={needle} hitClass={HIGHLIGHT.snippet} />
                  </p>
                  <ResultMeta time={result.hit.timestamp} label={sessionLabel(result.hit)} />
                </>
              )}
            </button>
          </div>
        ))}
        {searching && <div className="flex justify-center py-3"><Spinner size={12} /></div>}
      </div>
    )
  } else if (view === 'archived') {
    const shown = archived.slice(0, archivedCount)
    body = (
      <>
        <div className="py-3">
          <button type="button" aria-label="Back to chat list" onClick={() => setView('threads')} className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-fill-raised">
            <Icon icon={ArrowLeft01Icon} size={20} className="text-content-primary" />
          </button>
        </div>
        {archivedQuery.isPending ? (
          <ListSkeleton />
        ) : archivedQuery.isError ? (
          <LoadError message={errorMessage(archivedQuery.error)} onRetry={() => void archivedQuery.refetch()} />
        ) : archived.length === 0 ? (
          <EmptyState
            className="flex-1 justify-center py-10"
            icon={<Icon icon={Archive02Icon} size={32} className="text-content-disabled" />}
            title="No archived chats"
            description="Side chats you archive will appear here."
          />
        ) : (
          <section className="flex flex-col gap-4">
            <div>
              <h2 className="px-2 pb-2 text-caption text-content-primary">Archived chats</h2>
              <div className="flex flex-col gap-px">{shown.map((session) => renderRow(session, { archivedRow: true }))}</div>
            </div>
            {shown.length < archived.length && (
              <button type="button" onClick={() => setArchivedCount((count) => count + PAGE_SIZE)} className="h-8 w-full cursor-pointer rounded-full bg-fill-raised text-body-sm font-medium text-content-primary hover:bg-fill-strong">
                Show more
              </button>
            )}
          </section>
        )}
      </>
    )
  } else if (loading) {
    body = <ListSkeleton />
  } else if (status === 'error' && sideChats.length === 0 && !main) {
    body = <LoadError message="Could not load your chats." onRetry={() => void loadSessions()} />
  } else {
    const showSections = !fullyEmpty || drafting
    body = (
      <>
        {main && showSections && (
          <ThreadRow
            title="Main chat"
            timestamp={activityTime(main)}
            isActive={currentSessionId === mainKey}
            hasUnread={main.unread === true}
            showUnreadWhenActive
            onClick={() => openThread(mainKey)}
          />
        )}
        {showSections && (
          <section className="group/section flex flex-col">
            <div className="flex w-full items-center">
              <h3 className="flex min-w-0 flex-1">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls="side-chats-list"
                  onClick={() => setExpanded((value) => { write(SECTION_KEY, value ? '0' : '1'); return !value })}
                  className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-full px-2.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-muse-blue"
                >
                  <span className="truncate text-body-sm font-medium text-content-secondary">Side chats</span>
                  <span className="invisible flex size-6 shrink-0 items-center justify-center rounded-full group-hover/section:visible group-focus-within/section:visible hover:bg-fill-raised">
                    <Icon icon={ArrowDown01Icon} size={16} className={cn('text-content-tertiary transition-transform duration-(--duration-normal)', !expanded && '-rotate-90')} />
                  </span>
                </button>
              </h3>
              <button
                type="button"
                aria-label="New side chat"
                title="New side chat"
                aria-current={drafting ? 'page' : undefined}
                data-testid="chat-compose"
                onClick={newSideChat}
                className={cn('me-1 flex size-6 cursor-pointer items-center justify-center rounded-full text-content-secondary hover:bg-fill-raised', drafting && 'bg-fill-raised')}
              >
                <Icon icon={Add01Icon} size={16} className="text-current" />
              </button>
            </div>
            {expanded && (
              <div id="side-chats-list" className="flex flex-col gap-px">
                {shownSideChats.map((session) => renderRow(session))}
              </div>
            )}
          </section>
        )}
        {sideChats.length === 0 && !drafting && (
          <EmptyState
            className="flex-1 justify-center py-10"
            icon={<Icon icon={MessageMultiple01Icon} size={32} className="text-content-disabled" />}
            title="Start a side chat"
            description="Side chats are an optional way to organize your conversations by topic."
            action={fullyEmpty ? <GhostButton size="sm" onClick={newSideChat}>New side chat</GhostButton> : undefined}
          />
        )}
        {expanded && hasMore && <div ref={sentinelRef} aria-hidden="true" className="h-px shrink-0" />}
      </>
    )
  }

  return (
    <div data-testid="side-chats-panel" style={{ width }} className="relative flex h-full shrink-0">
      <nav aria-label="Side chats" className="flex h-full w-full flex-col overflow-hidden bg-bg-panel">
        {view !== 'archived' && (
          <div className="flex h-15 shrink-0 items-center gap-2 px-3">
            <div className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-line-hairline bg-bg-card ps-2.5 pe-4 focus-within:border-line-strong">
              <Icon icon={Search01Icon} size={20} className="pointer-events-none shrink-0 text-content-secondary" />
              <input
                ref={searchRef}
                value={query}
                aria-label="Search"
                placeholder="Search"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                className="min-w-0 flex-1 bg-transparent text-body-sm font-medium text-content-primary outline-none placeholder:text-content-secondary"
              />
              {query.length > 0 && (
                <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus() }} className="flex shrink-0 cursor-pointer items-center text-content-secondary">
                  <Icon icon={CancelCircleIcon} size={18} className="text-current" />
                </button>
              )}
            </div>
            <span className="me-1 flex shrink-0 items-center">{optionsMenu}</span>
          </div>
        )}
        <div ref={listRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-3 pb-3">{body}</div>
      </nav>

      <Tooltip content={<span className="flex flex-col"><span className="text-content-primary">Side chats</span><span>Click or drag to close</span></span>} side="right">
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          onPointerDown={onHandlePointerDown}
          onKeyDown={onHandleKeyDown}
          className={cn('group/handle absolute inset-y-0 -end-2 z-20 w-4 touch-none outline-none', cursor)}
        >
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-1/2 w-px bg-line-hairline group-hover/handle:bg-line-strong group-focus-visible/handle:bg-muse-blue group-active/handle:bg-muse-blue" />
        </div>
      </Tooltip>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}>
        <AlertDialog.Title className="text-headline font-semibold text-content-primary">Delete side chat?</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-body-sm text-content-secondary">
          Deleting this side chat permanently removes it and cannot be undone.
        </AlertDialog.Description>
        <div className="mt-6 flex justify-end gap-2">
          <GhostButton onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</GhostButton>
          <GhostButton onClick={() => void confirmDelete()} disabled={deleting} className="border-error/40 bg-error/10 text-error">
            {deleting ? 'Deleting…' : 'Delete'}
          </GhostButton>
        </div>
      </AlertDialog>
    </div>
  )
}

// ── Parts ───────────────────────────────────────────────────────────────────

function Highlighted({ text, query, hitClass }: { text: string; query: string; hitClass: string }) {
  return (
    <>
      {highlightRuns(text, query).map((run, index) => (
        <span key={index} className={run.hit ? hitClass : undefined}>{run.text}</span>
      ))}
    </>
  )
}

function ResultMeta({ time, label }: { time: number; label: string }) {
  return (
    <span className="flex items-center gap-1 px-1 pt-0.5 text-caption text-content-secondary">
      {time > 0 && (
        <>
          <span className="shrink-0">{compactAge(time)}</span>
          <span aria-hidden="true" className="text-content-faint">·</span>
        </>
      )}
      <span className="truncate" title={label}>{label}</span>
    </span>
  )
}

/** HatchSideChatsListSkeleton: five bars, alternating 70% / 55%. */
function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading side chats" data-testid="side-chats-list-skeleton" className="flex flex-col gap-px pt-1">
      {[70, 55, 70, 55, 70].map((percent, index) => (
        <div key={index} aria-hidden="true" className="flex h-8 items-center px-2">
          <div className="h-4 rounded-sm bg-fill-raised motion-safe:animate-pulse" style={{ width: `${percent}%` }} />
        </div>
      ))}
    </div>
  )
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
      <p className="text-caption text-content-secondary">{message}</p>
      <GhostButton size="sm" onClick={onRetry}>Try again</GhostButton>
    </div>
  )
}

interface ThreadRowProps {
  title: string
  timestamp: number
  isActive: boolean
  hasUnread?: boolean
  showUnreadWhenActive?: boolean
  pinned?: boolean
  onClick: () => void
  menu?: ReactNode
  renaming?: boolean
  renamePending?: boolean
  onRenameSubmit?: (title: string) => void
  onRenameCancel?: () => void
}

/** HatchThreadRow on HatchNavRow: title, pin badge, unread dot at rest; time and ••• on hover; same menu on right-click. */
function ThreadRow({ title, timestamp, isActive, hasUnread, showUnreadWhenActive, pinned, onClick, menu, renaming, renamePending, onRenameSubmit, onRenameCancel }: ThreadRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const emphasize = hasUnread === true && (!isActive || showUnreadWhenActive === true)
  const editing = renaming === true && onRenameSubmit !== undefined && onRenameCancel !== undefined

  return (
    <div
      data-testid="thread-row"
      {...(editing ? {} : { role: 'button', tabIndex: 0, 'aria-current': isActive ? ('page' as const) : undefined })}
      onClick={editing ? undefined : onClick}
      onKeyDown={(event) => {
        if (editing || event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() }
      }}
      onContextMenu={menu ? (event) => { event.preventDefault(); setMenuOpen(true) } : undefined}
      className={cn(
        'group/row relative flex h-9 w-full shrink-0 items-center gap-0.5 rounded-xl ps-2 pe-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-muse-blue',
        !editing && 'cursor-pointer',
        !editing && (isActive ? ROW_TONE.active : ROW_TONE.idle),
      )}
    >
      {editing ? (
        <RenameInput initialTitle={title} pending={renamePending === true} onSubmit={onRenameSubmit} onCancel={onRenameCancel} />
      ) : (
        <>
          <div className="min-w-0 flex-1 px-1">
            <p className={cn('flex items-center gap-1 truncate text-body-sm text-content-primary', emphasize && 'font-medium')}>
              {pinned && <Icon icon={PinIcon} size={14} className="shrink-0 text-content-secondary" />}
              <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
              {pinned && <span className="sr-only">Pinned</span>}
              {emphasize && <span className="sr-only">Unread updates</span>}
            </p>
          </div>
          {emphasize && (
            <span className={cn('size-6 shrink-0 items-center justify-center', menuOpen ? 'hidden' : HIDE_ON_REVEAL)}>
              <span data-testid="side-chat-unread-indicator" aria-hidden="true" className="size-2 shrink-0 rounded-full bg-muse-blue" />
            </span>
          )}
          {timestamp > 0 && (
            <span className={cn('shrink-0 whitespace-nowrap text-caption text-content-secondary', !menu && 'me-1', menuOpen ? 'inline' : REVEAL_INLINE)}>
              {compactAge(timestamp)}
            </span>
          )}
          {menu && (
            <div className={cn('ms-0.5 shrink-0 items-center', menuOpen ? 'flex' : REVEAL_FLEX)}>
              <Menu
                align="start"
                side="right"
                open={menuOpen}
                onOpenChange={setMenuOpen}
                trigger={
                  <button type="button" aria-label="More thread actions" onClick={(event) => event.stopPropagation()} className="flex size-6 cursor-pointer items-center justify-center text-content-secondary">
                    <Icon icon={MoreHorizontalIcon} size={20} className="text-current" />
                  </button>
                }
              >
                <div onClick={(event) => event.stopPropagation()}>{menu}</div>
              </Menu>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** HatchThreadRenameInput: Enter saves, Escape cancels, blur saves (or cancels when empty), ✕ / ✓ buttons. */
function RenameInput({ initialTitle, pending, onSubmit, onCancel }: { initialTitle: string; pending: boolean; onSubmit: (title: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initialTitle)
  const [invalid, setInvalid] = useState(false)
  const done = useRef(false)
  const empty = value.trim().length === 0

  // A failed save re-arms the field so the user can correct it.
  useEffect(() => { if (!pending) done.current = false }, [pending])

  function finish(mode: 'submit' | 'cancel'): void {
    if (done.current || pending) return
    const title = value.trim()
    if (mode === 'submit' && !title) { setInvalid(true); return }
    done.current = true
    if (mode === 'cancel' || title === initialTitle) onCancel()
    else onSubmit(title)
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <input
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        value={value}
        maxLength={200}
        disabled={pending}
        aria-label="Chat name"
        aria-invalid={invalid}
        aria-describedby={invalid ? 'chat-rename-error' : undefined}
        onChange={(event) => { setValue(event.target.value); if (event.target.value.trim()) setInvalid(false) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); finish('submit') }
          else if (event.key === 'Escape') { event.preventDefault(); finish('cancel') }
        }}
        onBlur={() => finish(empty ? 'cancel' : 'submit')}
        className={cn('min-w-0 flex-1 rounded-lg px-1 py-0.5 text-body-sm text-content-primary outline-none', pending ? 'cursor-not-allowed bg-fill-raised' : 'bg-transparent', invalid && 'ring-1 ring-error')}
      />
      {invalid && (
        <span id="chat-rename-error" role="alert" className="absolute start-0 top-full z-10 mt-1 rounded-lg border border-line bg-bg-card px-2 py-1 text-caption text-error">
          Enter a name for this chat.
        </span>
      )}
      <button type="button" aria-label="Cancel renaming this chat" disabled={pending} onMouseDown={(event) => { event.preventDefault(); finish('cancel') }} className="flex size-6 shrink-0 cursor-pointer items-center justify-center text-content-secondary disabled:opacity-40">
        <Icon icon={Cancel01Icon} size={16} className="text-current" />
      </button>
      <button type="button" aria-label="Save this chat's new name" disabled={pending || empty} onMouseDown={(event) => event.preventDefault()} onClick={() => finish('submit')} className="flex size-6 shrink-0 cursor-pointer items-center justify-center text-content-secondary disabled:opacity-40">
        <Icon icon={Tick02Icon} size={16} className="text-current" />
      </button>
    </div>
  )
}

