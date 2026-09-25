import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Dialog as Base } from '@base-ui/react/dialog'
import { Cancel01Icon, File01Icon, Image01Icon, MusicNote01Icon, Pdf01Icon, SidebarLeft01Icon, Video01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/primitives'
import { AgentAvatar } from '@/components/status/AgentAvatar'
import { readGoals } from '@/lib/goals'
import { AGENT_ID, useAgentIdentity } from '@/lib/identity'
import { revealMessage } from '@/lib/reveal-message'
import { gatewayWS } from '@/services/gateway-ws.service'
import { botMainSessionKey } from '@/services/session-key'
import { MuseNavigationIcon } from '@/shell/MuseNavigationIcon'
import { useChatStore } from '@/stores/chat.store'
import {
  commandResults,
  conversationResults,
  fallbackResults,
  fileTypeLabel,
  findMessageHits,
  getQuickSearchResultSubtitle,
  getQuickSearchResultTypeLabel,
  goalResults,
  libraryResults,
  orderQuickSearchResults,
  parseSearchSessions,
  type FileCategory,
  type LibraryFile,
  type QuickSearchIcon as QuickSearchIconModel,
  type QuickSearchResult,
} from './quick-search'

const FILE_ICONS: Record<FileCategory, unknown> = {
  image: Image01Icon,
  video: Video01Icon,
  audio: MusicNote01Icon,
  pdf: Pdf01Icon,
  file: File01Icon,
}

/** Text formats worth opening to look for the query inside. */
const SEARCHABLE_TEXT_TYPES = new Set(['Text', 'HTML', 'JSON', 'CSV', 'TypeScript', 'JavaScript', 'CSS', 'YAML'])
// ponytail: the Library is walked in the renderer, bounded by these caps; a
// main-process index (or an OpenClaw search method) is the upgrade path.
const LIBRARY_WALK_DEPTH = 6
const LIBRARY_WALK_FILE_LIMIT = 2000
const LIBRARY_CONTENT_READ_LIMIT = 300
const LIBRARY_CONTENT_HIT_LIMIT = 8
/** How many recent conversations have their transcripts searched. */
const TRANSCRIPT_SEARCH_SESSIONS = 30
const QUERY_DEBOUNCE_MS = 250

async function walkLibrary(): Promise<LibraryFile[]> {
  const roots = await window.clawmuse.fs.roots()
  const files: LibraryFile[] = []
  async function walk(rootId: string, path: string, depth: number): Promise<void> {
    if (depth > LIBRARY_WALK_DEPTH || files.length >= LIBRARY_WALK_FILE_LIMIT) return
    const entries = await window.clawmuse.fs.list(rootId, path).catch(() => [])
    for (const entry of entries) {
      if (files.length >= LIBRARY_WALK_FILE_LIMIT) return
      if (entry.isDirectory) await walk(rootId, entry.path, depth + 1)
      else files.push({ rootId, path: entry.path, name: entry.name, modifiedMs: entry.modifiedMs })
    }
  }
  for (const root of roots) await walk(root.id, '', 0)
  return files
}

async function searchLibraryContent(files: readonly LibraryFile[], needle: string): Promise<LibraryFile[]> {
  const hits: LibraryFile[] = []
  let read = 0
  for (const file of files) {
    if (hits.length >= LIBRARY_CONTENT_HIT_LIMIT || read >= LIBRARY_CONTENT_READ_LIMIT) break
    if (!SEARCHABLE_TEXT_TYPES.has(fileTypeLabel(file.name))) continue
    read += 1
    const result = await window.clawmuse.fs.read(file.rootId, file.path).catch(() => null)
    if (result && !result.binary && !result.tooLarge && result.content.toLocaleLowerCase().includes(needle)) hits.push(file)
  }
  return hits
}

/**
 * Muse's Quick Search (⌘K): a popover anchored a quarter of the way down the
 * window that finds chats, messages, goals, Library files and commands, and
 * offers to send anything sentence-like straight to the agent.
 */
export function QuickSearch({ open, onClose, onOpenSplitView }: { open: boolean; onClose: () => void; onOpenSplitView?: () => void }) {
  return (
    <Base.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Base.Portal>
        <Base.Backdrop data-slot="quick-search-scrim" className="fixed inset-0 z-50 bg-scrim transition-opacity duration-1000 data-starting-style:opacity-0 data-ending-style:pointer-events-none data-ending-style:opacity-0 motion-reduce:transition-none" />
        <Base.Popup data-testid="quick-search" className="muse-quick-search fixed left-1/2 top-[25vh] z-50 flex max-h-[50vh] w-[min(512px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden bg-bg-base shadow-modal outline-none transition-[scale,opacity] duration-300 data-starting-style:scale-105 data-starting-style:opacity-0 data-ending-style:scale-105 data-ending-style:opacity-0 motion-reduce:transition-none">
          <Base.Title className="sr-only">Search ClawMuse</Base.Title>
          {/* Mounted only while open, so every open starts from an empty query. */}
          <QuickSearchBody onClose={onClose} onOpenSplitView={onOpenSplitView} />
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}

function QuickSearchBody({ onClose, onOpenSplitView }: { onClose: () => void; onOpenSplitView?: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const needle = query.trim().toLocaleLowerCase()

  const messages = useChatStore((state) => state.messages)
  const loadMessages = useChatStore((state) => state.loadMessages)
  const agentName = useAgentIdentity().data?.name?.trim() || 'ClawMuse'
  const [goals] = useState(readGoals)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(needle), QUERY_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [needle])

  const sessions = useQuery({
    queryKey: ['quick-search-sessions'],
    queryFn: async () => parseSearchSessions(await gatewayWS.call('sessions.list', { includeLastMessage: true, includeDerivedTitles: true, limit: 100 })),
    staleTime: 10_000,
  })
  const recentSessions = useMemo(
    () => [...(sessions.data ?? [])].sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0)).slice(0, TRANSCRIPT_SEARCH_SESSIONS),
    [sessions.data],
  )
  // OpenClaw has no transcript search method: load the recent transcripts once
  // a query is typed, then match against what the chat store holds.
  const transcripts = useQuery({
    queryKey: ['quick-search-transcripts', recentSessions.map((session) => session.id).join('\n')],
    queryFn: async () => { await Promise.all(recentSessions.map((session) => loadMessages(session.id).catch(() => undefined))); return true },
    enabled: Boolean(debounced) && recentSessions.length > 0,
    staleTime: 60_000,
  })
  const library = useQuery({ queryKey: ['quick-search-library'], queryFn: walkLibrary, staleTime: 30_000 })
  const libraryContent = useQuery({
    queryKey: ['quick-search-library-content', debounced, library.data?.length],
    queryFn: () => searchLibraryContent(library.data ?? [], debounced),
    enabled: Boolean(debounced) && Boolean(library.data?.length),
    staleTime: 30_000,
  })

  const mainSessionId = botMainSessionKey(AGENT_ID)
  const results = useMemo(() => {
    const openSession = (id: string, messageId?: string) => {
      navigate(`/chat/${encodeURIComponent(id)}`)
      if (messageId) revealMessage(messageId)
    }
    // Muse's onAskHatch sends the query to the main chat.
    const ask = (text: string) => {
      navigate(`/chat/${encodeURIComponent(mainSessionId)}`)
      void useChatStore.getState().sendMessage(mainSessionId, text)
    }
    const messageHits = debounced === needle ? findMessageHits(query, recentSessions, messages) : []
    const contentHits = debounced === needle ? libraryContent.data ?? [] : []
    return orderQuickSearchResults([
      ...libraryResults(query, library.data ?? [], contentHits, (file) => navigate(`/library?root=${encodeURIComponent(file.rootId)}&open=${encodeURIComponent(file.path)}`)),
      ...goalResults(query, goals, () => navigate('/goals')),
      ...conversationResults(query, sessions.data ?? [], messageHits, openSession, mainSessionId),
      ...commandResults(query, { openSplitView: onOpenSplitView, openGoals: () => navigate('/goals'), openLibrary: () => navigate('/library'), openIdeas: () => navigate('/ideas') }),
      ...fallbackResults(query, agentName, ask),
    ], query)
  }, [agentName, debounced, goals, library.data, libraryContent.data, mainSessionId, messages, navigate, needle, onOpenSplitView, query, recentSessions, sessions.data])

  const searching = Boolean(needle) && (debounced !== needle || sessions.isFetching || transcripts.isFetching || library.isFetching || libraryContent.isFetching)
  // Like cmdk: the selection follows its result while it stays listed, else the first row.
  const selectedIndex = Math.max(0, results.findIndex((result) => result.id === selectedId))
  const selected = results[selectedIndex]
  const optionId = (result: QuickSearchResult) => `${listId}-${result.id}`

  useEffect(() => {
    if (selected) document.getElementById(optionId(selected))?.scrollIntoView({ block: 'nearest' })
    // optionId only reads listId, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  function choose(result: QuickSearchResult | undefined): void {
    if (!result) return
    result.action()
    onClose()
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = results[Math.min(results.length - 1, Math.max(0, selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (next) setSelectedId(next.id)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(selected)
    }
  }

  function changeQuery(value: string): void {
    if (listRef.current) listRef.current.scrollTop = 0
    setSelectedId(null)
    setQuery(value)
  }

  const rows = results.map((result, index) => (
    <QuickSearchResultItem key={result.id} id={optionId(result)} result={result} selected={index === selectedIndex} onHover={() => setSelectedId(result.id)} onSelect={() => choose(result)} />
  ))

  return (
    <div className="flex min-h-0 flex-col">
      <div className="muse-quick-search-header relative flex h-16 shrink-0 items-center gap-1">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full text-content-secondary"><MuseNavigationIcon name="Search" size={16} /></span>
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Search ClawMuse"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={selected ? optionId(selected) : undefined}
          placeholder="Search"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className="muse-quick-search-input min-w-0 flex-1 bg-transparent text-content-primary outline-none placeholder:text-content-secondary"
        />
        {query.length > 0 && (
          <button type="button" aria-label="Clear search" onClick={() => { changeQuery(''); inputRef.current?.focus() }} className="flex size-5 shrink-0 items-center justify-center rounded-full text-content-secondary hover:text-content-primary">
            <span className="flex size-3.5 items-center justify-center rounded-full bg-content-tertiary"><Icon icon={Cancel01Icon} size={10} strokeWidth={2.4} className="text-bg-base" /></span>
          </button>
        )}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-line-hairline" />
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label="Search results" className="flex max-h-[352px] min-h-0 scroll-p-3 flex-col gap-px overflow-y-auto p-3">
        {results.length === 0 && <p className="flex h-12 items-center justify-center p-1.5 text-center text-footnote text-content-secondary">{searching ? 'Searching…' : 'No results found'}</p>}
        {results.length > 0 && !needle ? (
          <div role="group" aria-label="Recents" className="flex flex-col gap-px">
            <span aria-hidden="true" className="block px-2 pb-1 pt-px text-footnote font-medium text-content-secondary">Recents</span>
            {rows}
          </div>
        ) : rows}
      </div>
    </div>
  )
}

function QuickSearchResultItem({ id, result, selected, onHover, onSelect }: { id: string; result: QuickSearchResult; selected: boolean; onHover: () => void; onSelect: () => void }) {
  const subtitle = getQuickSearchResultSubtitle(result, getQuickSearchResultTypeLabel(result))
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      data-selected={selected}
      data-search-source={result.source}
      onPointerMove={selected ? undefined : onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className="muse-quick-search-item flex h-12 shrink-0 cursor-pointer select-none items-center gap-2 p-1.5 text-start hover:bg-fill-raised data-[selected=true]:bg-fill-raised"
    >
      <QuickSearchIcon icon={result.icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-footnote text-content-primary" title={result.title}>{result.title}</span>
        {subtitle?.kind === 'type' && <span className="muse-quick-search-subtitle truncate text-content-secondary" title={subtitle.fullText}>{subtitle.typeLabel}</span>}
        {subtitle?.kind === 'chat' && (
          <span className="muse-quick-search-subtitle flex min-w-0 items-center gap-0.5 text-content-secondary" title={subtitle.fullText}>
            {subtitle.snippet != null && <span className="min-w-0 truncate">{subtitle.snippet}</span>}
            {subtitle.snippet != null && subtitle.time != null && <span aria-hidden="true" className="shrink-0">·</span>}
            {subtitle.time != null && <span className="shrink-0">{subtitle.time}</span>}
          </span>
        )}
      </span>
    </div>
  )
}

function QuickSearchIcon({ icon }: { icon: QuickSearchIconModel }) {
  if (icon.type === 'avatar') return <AgentAvatar size={36} className="bg-fill-raised" />
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fill-raised text-content-primary">
      {icon.type === 'nav' && <MuseNavigationIcon name={icon.name} size={16} />}
      {icon.type === 'split-view' && <Icon icon={SidebarLeft01Icon} size={16} />}
      {icon.type === 'file' && <Icon icon={FILE_ICONS[icon.category]} size={16} />}
    </span>
  )
}
