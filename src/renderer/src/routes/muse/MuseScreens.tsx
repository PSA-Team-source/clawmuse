import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight01Icon,
  BubbleChatIcon,
  Search01Icon,
  File01Icon,
  Folder01Icon,
  FavouriteIcon,
  MagicWand01Icon,
  PencilEdit01Icon,
  MoreVerticalIcon,
  MoreHorizontalIcon,
  UserGroupIcon,
  Briefcase01Icon,
  PaintBoardIcon,
  LaptopIcon,
  Dollar01Icon,
  CheckmarkSquare01Icon,
  Add01Icon,
  AudioWave01Icon,
  FilterHorizontalIcon,
  Globe02Icon,
  GridViewIcon,
  Image01Icon,
  Note01Icon,
  Video01Icon,
} from '@hugeicons/core-free-icons'
import { IconButton, Spinner } from '@/components/brand'
import { AlertDialog, Icon, Menu } from '@/components/primitives'
import { Dialog } from '@/components/primitives'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '@/stores/chat.store'
import { GOALS_KEY, readGoals, type Goal } from '@/lib/goals'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/utils/format'
import { groupIdeas, type FeedUnit, type Idea } from '@shared/assistant'
import { useAssistantStore } from '@/stores/assistant.store'
import { AgentAvatar } from '@/components/status/AgentAvatar'
import { failureNotice } from '@/lib/failure-notice'
import type { FsEntry, FsRoot } from '@shared/ipc'

/** Where saved work lives in the workspace ("Show in Library" writes here). */
const ARTIFACTS_DIR = 'artifacts'

/** While the assistant works: say what it is doing, and let the user stop it. */
function GenerationProgress({ label, onStop }: { label: string; onStop: () => void }) {
  return (
    <div role="status" className="mb-6 flex items-center gap-3 rounded-2xl border border-line-hairline bg-bg-panel px-4 py-3">
      <span className="flex gap-1" aria-hidden>{[0, 150, 300].map((delay) => <span key={delay} className="size-1.5 rounded-full bg-content-secondary/50 motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />)}</span>
      <p className="min-w-0 flex-1 text-body-sm text-content-primary">{label}</p>
      <button type="button" onClick={onStop} className="h-8 rounded-full bg-fill-strong px-3 text-body-sm font-medium text-content-primary hover:bg-fill-stronger">Stop</button>
    </div>
  )
}

/** Muse's feed media: the lead article's picture as a bordered thumbnail under the text. One that fails to load leaves nothing behind. */
function FeedHero({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="mt-3 aspect-video w-full max-w-[464px] rounded-2xl border border-line-hairline bg-bg-panel object-cover" />
}

/** Opens a feed link in the browser — never inside the app window. */
function openLink(href: string) {
  return (event: React.MouseEvent) => {
    event.preventDefault()
    void window.clawmuse.shell.openExternal(href)
  }
}

/** "Tomorrow at 7:00 AM" / "Today at 7:00 AM" for the next scheduled run. */
function nextRunLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === today.toDateString()) return date.getTime() <= Date.now() + 60_000 ? 'Updating soon' : `Next update today at ${time}`
  if (date.toDateString() === tomorrow.toDateString()) return `Next update tomorrow at ${time}`
  return `Next update ${date.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`
}

/**
 * Muse's HatchRouteLargeHeader: 32px top gap, a sticky 60px header with a
 * 34/40 semibold title, an optional 18/26 description, and the 768px reading
 * column with Muse's 64px gutter.
 */
/** `inset`: Muse's reading column (HATCH_FEED_COLUMN + md:px-16) — 768pt with a 64pt gutter, so text runs 640pt. */
function Page({ title, subtitle, action, inset, children }: { title: string; subtitle?: string; action?: React.ReactNode; inset?: boolean; children: React.ReactNode }) {
  return (
    <section className="h-full overflow-y-auto bg-bg-base">
      <div aria-hidden="true" className="h-8" />
      <header className="sticky top-0 z-20 h-15 bg-bg-base px-16">
        <div className={cn('mx-auto flex h-full w-full max-w-3xl items-center justify-between gap-3', inset && 'px-16')}>
          <h1 className="muse-route-title min-w-0 flex-1 truncate text-content-primary">{title}</h1>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      </header>
      {subtitle && <div className="px-16 pb-6"><p className="muse-route-description mx-auto w-full max-w-3xl text-content-primary">{subtitle}</p></div>}
      <div className="px-16 pb-8"><div className={cn('mx-auto w-full max-w-3xl', inset && 'px-16')}>{children}</div></div>
    </section>
  )
}

function startPrompt(prompt: string): void {
  sessionStorage.setItem('clawmuse.pendingPrompt', prompt)
}

/**
 * Muse's Feed. Editions are written by the built-in assistant in the
 * background (daily, or on Generate) — no chat is created for them.
 */
export function FeedScreen() {
  const assistant = useAssistantStore((store) => store.state)
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const job = assistant?.jobs.feed
  const prompt = assistant?.feedPrompt ?? ''
  const liked = useMemo(() => new Set(assistant?.likedFeed ?? []), [assistant?.likedFeed])
  const items = useMemo(() => {
    const hidden = new Set(assistant?.hiddenFeed ?? [])
    return (assistant?.feed ?? []).filter((item) => !hidden.has(item.id)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 30)
  }, [assistant?.feed, assistant?.hiddenFeed])

  function savePrompt(): void {
    const value = draft.trim()
    if (!value) return
    void window.clawmuse.assistant.setFeedPrompt(value)
    setEditing(false)
  }

  function discuss(item: FeedUnit): void {
    const sources = (item.sources ?? []).map((source) => `- ${source.title}: ${source.url}`).join('\n')
    startPrompt(`Discuss this feed update with me and help me decide the next action.\n\n${item.title}\n${item.body}${sources ? `\n\nSources:\n${sources}` : ''}`)
    const id = useChatStore.getState().createSession()
    navigate(`/chat/${encodeURIComponent(id)}`)
  }

  const datedItems = useMemo(() => {
    const groups = new Map<string, { label: string; entries: typeof items }>()
    for (const item of items) {
      const date = new Date(item.at)
      const period = date.getHours() < 12 ? 'morning' : date.getHours() < 18 ? 'afternoon' : 'evening'
      const label = Number.isNaN(date.getTime())
        ? 'Recent'
        : `${date.toLocaleDateString(undefined, { weekday: 'long' })} ${period}`
      const key = Number.isNaN(date.getTime()) ? 'recent' : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${period}`
      const group = groups.get(key)
      if (group) group.entries.push(item)
      else groups.set(key, { label, entries: [item] })
    }
    return [...groups.entries()]
  }, [items])

  if (!assistant) return <Page title="Feed" inset><div className="flex justify-center py-10"><Spinner /></div></Page>
  const schedule = assistant.settings.dailyFeed && !job?.running ? nextRunLabel(job?.nextRunAt) : null

  return (
    <Page title="Feed" inset>
      <div className="muse-feed-prompt mb-8 flex flex-col gap-3 border border-line-hairline bg-bg-panel p-5 shadow-composer">
        <div className="flex items-center justify-between gap-3">
          <span className="text-footnote font-semibold uppercase text-content-tertiary">Your feed prompt</span>
          {schedule && <span className="text-footnote text-content-tertiary">{schedule}</span>}
        </div>
        <p className="line-clamp-8 whitespace-pre-wrap break-words text-body font-medium text-content-primary">{prompt}</p>
        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={() => { setDraft(prompt); setEditing(true) }} className="flex h-9 items-center gap-1.5 rounded-full bg-fill-strong px-3.5 text-body-sm font-medium text-content-primary hover:bg-fill-stronger"><Icon icon={PencilEdit01Icon} size={16} className="text-current" />Edit</button>
          <button type="button" onClick={() => void window.clawmuse.assistant.run('feed')} disabled={Boolean(job?.running) || !assistant.available} className="h-9 rounded-full bg-muse-blue px-3.5 text-body-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{job?.running ? 'Generating…' : 'Generate'}</button>
        </div>
      </div>
      <Dialog open={editing} onOpenChange={setEditing} title="Feed instructions" description="Your feed is powered by the instructions below. Any edits you make to this prompt will apply to future posts on the feed." className="muse-feed-dialog w-[376px] p-4">
        <label htmlFor="feed-instructions" className="sr-only">What should your feed cover?</label>
        <textarea id="feed-instructions" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add instructions…" className="block h-48 w-full resize-none rounded-field border-0 bg-fill-raised p-2.5 text-muse-artifact-name text-content-primary outline-none focus-visible:ring-1 focus-visible:ring-muse-blue" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setEditing(false)} className="h-7 rounded-full bg-fill-raised text-muse-artifact-name font-medium text-content-primary">Cancel</button>
          <button type="button" onClick={savePrompt} disabled={!draft.trim() || draft.trim() === prompt} className="h-7 rounded-full bg-muse-blue text-muse-artifact-name font-medium text-white disabled:opacity-45">Save</button>
        </div>
      </Dialog>
      {job?.running && <GenerationProgress label={job.running.phase} onStop={() => void window.clawmuse.assistant.stop('feed')} />}
      {!job?.running && job?.lastError && <p role="alert" className="mb-6 text-body-sm text-content-secondary">{failureNotice(job.lastError)}</p>}
      {items.length === 0 ? (
        !job?.running && <div className="flex flex-col items-start gap-1 rounded-2xl border border-line-hairline bg-bg-panel p-4"><p className="muse-section-title text-content-primary">No feed yet.</p><p className="text-body-sm text-content-secondary">{assistant.settings.dailyFeed ? 'A fresh edition arrives every day. Generate one now to see it here.' : 'Generate an edition and it will show up here.'}</p></div>
      ) : (
        <div className="space-y-8" aria-label="Feed editions">
          <h2 className="sr-only">Feed editions</h2>
          {datedItems.map(([date, { label, entries: dateItems }]) => <section key={date}>
            <h2 className="muse-section-title mb-4 text-content-primary">{label}</h2>
            <div className="space-y-8">
              {dateItems.map((item) => <article key={item.id} className="group relative">
                <Menu align="end" trigger={<IconButton icon={MoreHorizontalIcon} label="Feed unit options" size="sm" className="absolute -right-1 -top-1" />}>
                  <Menu.Item onClick={() => void navigator.clipboard.writeText(`${item.title}\n\n${item.body}`)}>Copy</Menu.Item>
                  {item.sources?.[0] && <Menu.Item onClick={() => void window.clawmuse.shell.openExternal(item.sources![0]!.url)}>Open article</Menu.Item>}
                  <Menu.Item onClick={() => discuss(item)}>Discuss</Menu.Item>
                  <Menu.Separator />
                  <Menu.Item tone="danger" onClick={() => void window.clawmuse.assistant.markFeedUnit(item.id, 'hide')}>Hide from feed</Menu.Item>
                </Menu>
                {/* Muse posts each unit as the agent: its avatar sits in the gutter beside the title. */}
                <AgentAvatar size={28} className="absolute -left-11 top-0" />
                <h3 className="muse-unit-title pr-8 text-content-primary">{item.title}</h3>
                <div className="pt-2.5 text-body text-content-primary [&_p+p]:mt-2 [&_a]:text-muse-blue [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ href, children }) => href ? <a href={href} onClick={openLink(href)}>{children}</a> : <span>{children}</span> }}>{item.body}</ReactMarkdown>
                </div>
                {item.image && <FeedHero src={item.image} />}
                {item.sources && item.sources.length > 0 && <p className="mt-2 truncate text-body-sm text-content-secondary">
                  {item.sources.map((source, index) => <span key={source.url}>{index > 0 && ' · '}<a href={source.url} title={source.title} onClick={openLink(source.url)} className="hover:text-content-primary hover:underline">{source.source ?? new URL(source.url).hostname.replace(/^www\./, '')}</a></span>)}
                </p>}
                <div className="mt-3 flex items-center gap-4 text-body-sm font-medium text-content-secondary">
                  <button type="button" aria-label="Love" aria-pressed={liked.has(item.id)} onClick={() => void window.clawmuse.assistant.markFeedUnit(item.id, liked.has(item.id) ? 'unlike' : 'like')} className={`flex items-center hover:text-content-primary ${liked.has(item.id) ? 'text-muse-blue' : ''}`}><Icon icon={FavouriteIcon} size={20} className="text-current" /></button>
                  <button type="button" onClick={() => discuss(item)} className="flex items-center gap-2 hover:text-content-primary"><Icon icon={BubbleChatIcon} size={20} className="text-current" />Discuss</button>
                </div>
              </article>)}
            </div>
          </section>)}
        </div>
      )}
    </Page>
  )
}

/** Muse's Ideas, refreshed daily in the background by the built-in assistant. */
export function IdeasScreen() {
  const assistant = useAssistantStore((store) => store.state)
  const navigate = useNavigate()
  const job = assistant?.jobs.ideas
  const groups = useMemo(() => {
    const hidden = new Set(assistant?.hiddenIdeas ?? [])
    return groupIdeas((assistant?.ideas ?? []).filter((idea) => !hidden.has(idea.id)))
  }, [assistant?.hiddenIdeas, assistant?.ideas])

  function launchIdea(idea: Idea): void {
    startPrompt(`${idea.title}${idea.description ? `\n\n${idea.description}` : ''}\n\nGo ahead.`)
    const id = useChatStore.getState().createSession()
    navigate(`/chat/${encodeURIComponent(id)}`)
  }

  const refresh = (
    <button type="button" onClick={() => void window.clawmuse.assistant.run('ideas')} disabled={Boolean(job?.running) || !assistant?.available} className="h-9 rounded-full bg-fill-strong px-3.5 text-body-sm font-medium text-content-primary hover:bg-fill-stronger disabled:opacity-50">
      {job?.running ? 'Thinking…' : assistant?.ideas.length ? 'New ideas' : 'Get ideas'}
    </button>
  )

  return (
    <Page title="Ideas" subtitle="I'm always thinking about new and different ways to help you. I'll surface my favorite ideas here." action={refresh}>
      {job?.running && <GenerationProgress label={job.running.phase} onStop={() => void window.clawmuse.assistant.stop('ideas')} />}
      {!job?.running && job?.lastError && <p role="alert" className="mb-4 text-body-sm text-content-secondary">{failureNotice(job.lastError)}</p>}
      {!assistant ? <div className="flex justify-center py-10"><Spinner /></div> : groups.length === 0 ? (
        // Muse HatchIdeasEmptyState.
        !job?.running && <div className="flex flex-col items-start gap-1 rounded-2xl border border-line-hairline bg-bg-panel p-4"><p className="muse-section-title text-content-primary">No ideas yet.</p><p className="text-body-sm text-content-secondary">New ideas show up here as ClawMuse learns about you.</p></div>
      ) : (
        <div className="space-y-8">
          {groups.map(({ heading, ideas: groupIdeas }) => <section key={heading ?? 'featured'} aria-label={heading ?? 'Featured ideas'}>
            {heading && <h2 className="muse-section-title pb-2 text-content-primary">{heading}</h2>}
            <div role="list">
              {groupIdeas.map((idea) => (
                // Muse HatchIdeaListRow: 44pt icon box, body-medium title, subheadline description, no dividers.
                <div key={idea.id} role="listitem" className="group relative -mx-3 flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-fill-raised">
                  {idea.emoji && <span aria-hidden className="flex size-11 shrink-0 items-center justify-center text-title-3">{idea.emoji}</span>}
                  <button type="button" onClick={() => launchIdea(idea)} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left after:absolute after:inset-0">
                    <span className="line-clamp-4 text-body font-medium text-content-primary">{idea.title}</span>
                    {idea.description && <span className="line-clamp-4 text-body-sm text-content-secondary">{idea.description}</span>}
                  </button>
                  <div className="relative z-10 shrink-0">
                    <Menu align="end" trigger={<IconButton icon={MoreVerticalIcon} label="Idea feedback" size="sm" className="opacity-0 group-hover:opacity-100" />}>
                      <Menu.Item onClick={() => { startPrompt(`Explain why this idea fits me and what you based it on.\n\n${idea.title}`); navigate(`/chat/${encodeURIComponent(useChatStore.getState().createSession())}`) }}>Why this idea?</Menu.Item>
                      <Menu.Item onClick={() => void window.clawmuse.assistant.hideIdea(idea.id)}>Not interested</Menu.Item>
                    </Menu>
                  </div>
                </div>
              ))}
            </div>
          </section>)}
        </div>
      )}
    </Page>
  )
}

const CATEGORIES = [
  { label: 'Health', icon: FavouriteIcon },
  { label: 'Relationships', icon: UserGroupIcon },
  { label: 'Finance', icon: Dollar01Icon },
  { label: 'Career', icon: Briefcase01Icon },
  { label: 'Interests', icon: PaintBoardIcon },
  { label: 'Productivity', icon: LaptopIcon },
  { label: 'Something else', icon: CheckmarkSquare01Icon },
]

export function GoalsScreen() {
  const [goals, setGoals] = useState<Goal[]>(readGoals)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const navigate = useNavigate()
  // React Router can retain this screen while another lazy route resolves.
  // Read through to storage on every render so a goal confirmed in chat is
  // visible immediately even when the retained component missed the event.
  const storedGoals = readGoals()
  const visibleGoals = storedGoals.length >= goals.length ? storedGoals : goals
  const displayedGoals = showCompleted ? visibleGoals : visibleGoals.filter((goal) => !goal.completed)

  useEffect(() => {
    const refresh = () => setGoals(readGoals())
    window.addEventListener('clawmuse-goals-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('clawmuse-goals-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  function persist(next: Goal[]): void {
    setGoals(next)
    localStorage.setItem(GOALS_KEY, JSON.stringify(next))
    // The assistant plans around open goals; tell it they moved.
    window.dispatchEvent(new Event('clawmuse-goals-changed'))
  }

  function refineGoal(): void {
    if (!selectedCategory) return
    const category = selectedCategory === 'Something else' ? 'personal' : selectedCategory.toLowerCase()
    startPrompt(`Help me create a clear ${category} goal. Ask me a few focused questions to understand the outcome, motivation, timing, and how progress should be measured. Once I confirm the final wording, summarize the plan and end your response with exactly one line in this format: [GOAL: concise confirmed goal]. Do not emit that marker before I confirm.`)
    const id = useChatStore.getState().createSession()
    setSelectedCategory(null)
    navigate(`/chat/${encodeURIComponent(id)}`)
  }

  return (
    <Page title="Goals" action={
      <Menu align="end" trigger={<IconButton icon={MoreHorizontalIcon} label="Goals options" size="sm" shape="circle" className="bg-fill-raised" />}>
        <Menu.Item onClick={() => setShowCompleted((value) => !value)}>{showCompleted ? 'Hide completed goals' : 'Show completed goals'}</Menu.Item>
        {visibleGoals.some((goal) => !goal.completed) && <Menu.Item onClick={() => persist(visibleGoals.map((goal) => ({ ...goal, completed: true })))}>Mark all complete</Menu.Item>}
      </Menu>
    }>
      <div className="flex flex-col gap-8 pt-2">
        {visibleGoals.length > 0 && <section aria-labelledby="goals-user" className="flex flex-col">
          <div className="flex items-center gap-3 py-2.5 text-muse-blue">
            <span aria-hidden="true" className="flex size-6 items-center justify-center"><span className="flex size-4 items-center justify-center rounded-full bg-muse-blue/15"><span className="size-1.5 rounded-full bg-muse-blue" /></span></span>
            <h2 id="goals-user" className="muse-section-title">Goals</h2>
          </div>
          {displayedGoals.map((goal) => (
            <label key={goal.id} className="-mx-2 flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-fill-strong">
              <span className="flex size-6 shrink-0 items-center justify-center"><input type="checkbox" checked={goal.completed} onChange={() => persist(visibleGoals.map((item) => item.id === goal.id ? { ...item, completed: !item.completed } : item))} className="size-4" /></span>
              <span className={`text-body ${goal.completed ? 'text-content-faint line-through' : 'text-content-primary'}`}>{goal.title}</span>
            </label>
          ))}
        </section>}

        <section aria-labelledby="goals-create" className="flex flex-col">
          <div className="flex items-center gap-3 py-2.5"><h2 id="goals-create" className="muse-section-title text-content-primary">Create a goal</h2></div>
          {CATEGORIES.map((category) => (
            <button key={category.label} type="button" data-goal-category={category.label.toLowerCase()} onClick={() => setSelectedCategory(category.label)} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-fill-strong">
              <span className="flex size-6 shrink-0 items-center justify-center"><Icon icon={category.icon} size={22} className="text-content-secondary" /></span>
              <span className="min-w-0 flex-1 truncate text-body font-medium text-content-primary">{category.label}</span>
              <span className="flex size-6 shrink-0 items-center justify-center"><Icon icon={ArrowRight01Icon} size={20} className="text-content-tertiary" /></span>
            </button>
          ))}
        </section>
      </div>
      <Dialog open={Boolean(selectedCategory)} onOpenChange={(value) => !value && setSelectedCategory(null)} title={selectedCategory === 'Something else' ? 'Create a new goal' : `Create a ${selectedCategory?.toLowerCase() ?? ''} goal`} backdropClassName="bg-black/10" className="muse-goal-dialog w-[312px] p-4">
        <p className="text-caption text-content-tertiary">First, we'll refine the goal together in chat. I'll ask you a few questions to clarify what you're after. Once it's set, I'll track your progress here.</p>
        <button type="button" onClick={refineGoal} className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-full bg-muse-blue px-4 text-micro font-medium text-white"><Icon icon={MagicWand01Icon} size={13} className="text-current" />Let's do it</button>
      </Dialog>
    </Page>
  )
}

function ArtifactCard({ rootId, entry, selecting, selected, onOpen }: { rootId: string; entry: FsEntry; selecting: boolean; selected: boolean; onOpen: () => void }) {
  const extension = entry.name.split('.').pop()?.toLowerCase() ?? ''
  const canPreviewText = !entry.isDirectory && ['md', 'txt', 'html', 'htm', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'css'].includes(extension)
  const canPreviewImage = !entry.isDirectory && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(extension)
  const cardPreview = useQuery({
    queryKey: ['clawmuse-artifact-card-preview', rootId, entry.path],
    queryFn: () => window.clawmuse.fs.read(rootId, entry.path),
    enabled: Boolean(rootId && (canPreviewText || canPreviewImage)),
    staleTime: 10_000,
  })
  const excerpt = cardPreview.data && !cardPreview.data.binary && !cardPreview.data.tooLarge
    ? cardPreview.data.content.replace(/^---[\s\S]*?---\s*/, '').trim().slice(0, 12_000)
    : ''

  return (
    <button type="button" data-library-entry={entry.name} onClick={onOpen} className={`relative self-start overflow-hidden rounded-field border bg-bg-panel text-left transition-colors hover:border-line-strong ${selected ? 'border-muse-blue ring-1 ring-muse-blue' : 'border-line-hairline'}`}>
      {selecting && <span aria-label={selected ? 'Selected' : 'Not selected'} className={`absolute left-2 top-2 z-10 flex size-5 items-center justify-center rounded-full border text-micro ${selected ? 'border-muse-blue bg-muse-blue text-white' : 'border-line-strong bg-bg-panel'}`}>{selected ? '✓' : ''}</span>}
      {cardPreview.data?.dataUrl && <img src={cardPreview.data.dataUrl} alt="" className="h-[124px] w-full border-b border-line-hairline object-cover" />}
      {excerpt && <div aria-hidden="true" className="pointer-events-none h-[124px] overflow-hidden border-b border-line-hairline bg-bg-panel"><div className="w-[800px] origin-top-left scale-[0.25] px-5 py-4 text-caption text-content-body [&_h1]:mb-3 [&_h1]:text-title-2 [&_h1]:font-bold [&_h2]:my-3 [&_h2]:text-headline [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:text-body [&_h3]:font-semibold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{excerpt}</ReactMarkdown></div></div>}
      <div className="flex min-h-[44px] items-center gap-3 px-4 py-2"><Icon icon={entry.isDirectory ? Folder01Icon : File01Icon} size={18} className="shrink-0 text-content-tertiary" /><span className="min-w-0"><span className="block truncate text-muse-artifact-name font-medium text-content-primary">{entry.name}</span><span className="block text-muse-artifact-meta text-content-tertiary">{[entry.isDirectory ? 'Folder' : canPreviewImage ? 'Image' : canPreviewText ? 'Text' : extension.toUpperCase(), entry.modifiedMs ? `Edited ${formatRelativeTime(new Date(entry.modifiedMs).toISOString())}` : null].filter(Boolean).join(' · ')}</span></span></div>
    </button>
  )
}

export function LibraryScreen() {
  const [roots, setRoots] = useState<FsRoot[]>([])
  const [rootId, setRootId] = useState('')
  const [currentPath, setCurrentPath] = useState('')
  // Muse keeps the agent's own files out of the artifact views: those browse
  // the artifacts folder (where "Show in Library" saves work) and System files
  // browses the whole workspace.
  const [system, setSystem] = useState(false)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'all' | 'documents' | 'web' | 'images' | 'videos' | 'podcasts'>('all')
  const [selecting, setSelecting] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [recentFirst, setRecentFirst] = useState(true)
  const [selectedEntry, setSelectedEntry] = useState<FsEntry | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const listPath = system ? currentPath : currentPath || ARTIFACTS_DIR

  useEffect(() => {
    void window.clawmuse.fs.roots().then((found) => {
      setRoots(found)
      setRootId((current) => current || found[0]?.id || '')
    })
  }, [])

  const listing = useQuery({
    queryKey: ['clawmuse-library', rootId, listPath],
    // A workspace with no saved artifacts yet has no folder: that is an empty library, not an error.
    queryFn: () => window.clawmuse.fs.list(rootId, listPath).catch((error: unknown) => (system ? Promise.reject(error) : [])),
    enabled: Boolean(rootId),
    staleTime: 2_000,
  })

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const openPath = params.get('open')
    const openRoot = params.get('root')
    if (!openPath || !openRoot) return
    queueMicrotask(() => {
      setRootId(openRoot)
      const folder = openPath.split('/').slice(0, -1).join('/')
      const inArtifacts = folder === ARTIFACTS_DIR || folder.startsWith(`${ARTIFACTS_DIR}/`)
      setSystem(!inArtifacts)
      setCurrentPath(inArtifacts && folder === ARTIFACTS_DIR ? '' : folder)
    })
  }, [location.search])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const openPath = params.get('open')
    const openRoot = params.get('root')
    if (!openPath || openRoot !== rootId || !listing.data) return
    const entry = listing.data.find((candidate) => candidate.path === openPath && !candidate.isDirectory)
    if (entry) queueMicrotask(() => setSelectedEntry(entry))
  }, [listing.data, location.search, rootId])
  const preview = useQuery({
    queryKey: ['clawmuse-artifact-preview', rootId, selectedEntry?.path],
    queryFn: () => window.clawmuse.fs.read(rootId, selectedEntry!.path),
    enabled: Boolean(rootId && selectedEntry && !selectedEntry.isDirectory),
  })
  const entries = (listing.data ?? []).filter((entry: FsEntry) => {
    if (!entry.name.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (entry.isDirectory || view === 'all') return true
    const extension = entry.name.split('.').pop()?.toLowerCase() ?? ''
    if (view === 'documents') return ['md', 'txt', 'pdf', 'doc', 'docx', 'rtf'].includes(extension)
    if (view === 'web') return ['html', 'htm'].includes(extension)
    if (view === 'images') return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)
    if (view === 'videos') return ['mp4', 'mov', 'webm', 'mkv'].includes(extension)
    return ['mp3', 'm4a', 'wav', 'ogg'].includes(extension)
  }).sort((a, b) => recentFirst ? (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0) : a.name.localeCompare(b.name))

  function createArtifact(): void {
    startPrompt('Help me create a new artifact. First ask what I want to make, then produce the finished document in a format I can save in my Library.')
    const id = useChatStore.getState().createSession()
    navigate(`/chat/${encodeURIComponent(id)}`)
  }

  function toggleSelection(path: string): void {
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function leaveSelectionMode(): void {
    setSelecting(false)
    setSelectedPaths(new Set())
  }

  useEffect(() => {
    if (!selecting) return
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') leaveSelectionMode()
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [selecting])

  function selectAll(): void {
    setSelectedPaths(new Set(entries.map((entry) => entry.path)))
  }

  async function deleteSelected(): Promise<void> {
    const targets = [...selectedPaths]
    await Promise.all(targets.map((path) => window.clawmuse.fs.delete(rootId, path)))
    setDeleteConfirmOpen(false)
    leaveSelectionMode()
    await listing.refetch()
  }

  function openEntry(entry: FsEntry): void {
    if (selecting) {
      toggleSelection(entry.path)
    } else if (entry.isDirectory) {
      setCurrentPath(entry.path)
      setQuery('')
    } else {
      setSelectedEntry(entry)
    }
  }

  function goUp(): void {
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    const up = parts.join('/')
    // Artifact views stop at the artifacts folder.
    setCurrentPath(!system && (up === '' || up === ARTIFACTS_DIR) ? '' : up)
  }

  function showView(next: typeof view): void {
    setSystem(false)
    setView(next)
    setCurrentPath('')
  }

  return (
    <div className="muse-library flex h-full bg-bg-base">
      <aside className="relative w-60 shrink-0 border-r border-line-hairline px-3 pb-5 pt-3">
        <Icon icon={Search01Icon} size={16} className="pointer-events-none absolute left-6 top-[22px] text-content-tertiary" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search the Library" className="h-8 w-full rounded-full border border-line bg-bg-panel px-3 text-caption outline-none focus:border-line-strong" />
        <h2 className="mb-1 mt-5 text-caption font-semibold text-content-tertiary">Artifacts</h2>
        {([['all', 'All artifacts', GridViewIcon], ['documents', 'Documents', Note01Icon], ['web', 'Web artifacts', Globe02Icon]] as const).map(([id, label, icon]) => <button key={id} type="button" onClick={() => showView(id)} className={`flex w-full items-center gap-2 rounded-field px-2 py-2 text-left text-caption ${!system && view === id ? 'bg-fill-raised font-medium' : 'text-content-body hover:bg-fill-raised'}`}><Icon icon={icon} size={16} />{label}</button>)}
        <h2 className="mb-1 mt-4 text-caption font-semibold text-content-tertiary">Media</h2>
        {([['images', 'Images', Image01Icon], ['videos', 'Videos', Video01Icon], ['podcasts', 'Podcasts', AudioWave01Icon]] as const).map(([id, label, icon]) => <button key={id} type="button" onClick={() => showView(id)} className={`flex w-full items-center gap-2 rounded-field px-2 py-2 text-left text-caption ${!system && view === id ? 'bg-fill-raised font-medium' : 'text-content-body hover:bg-fill-raised'}`}><Icon icon={icon} size={16} />{label}</button>)}
        <div className="absolute bottom-5 left-3 right-3">{roots.map((root) => <button key={root.id} type="button" onClick={() => { setRootId(root.id); setSystem(true); setView('all'); setCurrentPath('') }} className={`flex w-full items-center gap-2 rounded-field px-2 py-2 text-left text-caption ${system && root.id === rootId ? 'bg-fill-raised font-medium' : 'text-content-body hover:bg-fill-raised'}`}><Icon icon={Folder01Icon} size={16} />{root.label === 'Workspace' ? 'System files' : root.label}</button>)}</div>
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto px-16 pb-10 pt-8">
        <div className="mx-auto w-full max-w-6xl">
        <div className="flex items-center justify-between">{selecting ? <h1 className="text-title-1 font-bold text-content-primary">{selectedPaths.size} selected</h1> : <div className="flex min-w-0 items-center gap-2">{currentPath && <button type="button" aria-label="Back to parent folder" onClick={goUp} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-raised">←</button>}<div className="min-w-0"><h1 className="truncate text-title-1 font-bold text-content-primary">{currentPath ? currentPath.split('/').pop() : system ? 'System files' : view === 'all' ? 'All artifacts' : view === 'web' ? 'Web artifacts' : view.charAt(0).toUpperCase() + view.slice(1)}</h1>{currentPath && <p className="truncate text-micro text-content-faint">{system ? `System files / ${currentPath}` : currentPath}</p>}</div></div>}{selecting ? <div aria-label="Selected artifacts actions" className="flex items-center gap-2"><button type="button" disabled={selectedPaths.size === 0} onClick={() => setDeleteConfirmOpen(true)} className="rounded-full bg-error px-3 py-2 text-caption font-semibold text-white disabled:opacity-40">Delete</button><button type="button" onClick={selectAll} className="rounded-full bg-fill-raised px-3 py-2 text-caption font-medium text-content-primary">Select all</button><button type="button" aria-label="Exit selection" title="Exit selection (Esc)" onClick={leaveSelectionMode} className="flex size-8 items-center justify-center rounded-full bg-fill-raised">×</button></div> : <div className="flex items-center gap-2"><button type="button" onClick={() => setSelecting(true)} className="rounded-full bg-fill-raised px-3 py-2 text-caption font-medium text-content-primary">Select</button><button type="button" aria-label={recentFirst ? 'Sorted by recent — sort by name' : 'Sorted by name — sort by recent'} onClick={() => setRecentFirst((value) => !value)} className="flex size-8 items-center justify-center rounded-full bg-fill-raised"><Icon icon={FilterHorizontalIcon} size={16} className="text-current" /></button><button type="button" onClick={createArtifact} className="flex items-center gap-1.5 rounded-full bg-muse-blue px-4 py-2 text-caption font-semibold text-white"><Icon icon={Add01Icon} size={16} className="text-current" />Create an artifact</button></div>}</div>
        {listing.isPending ? <div className="mt-8"><Spinner size={22} /></div> : entries.length === 0 ? <p className="mt-8 text-body-sm text-content-tertiary">No artifacts yet.</p> : (
          <div className="mt-4"><h2 className="mb-3 text-caption font-semibold text-content-primary">{view === 'all' ? 'All artifacts' : view === 'web' ? 'Web artifacts' : view.charAt(0).toUpperCase() + view.slice(1)}</h2><div className="grid grid-cols-[repeat(auto-fill,264px)] gap-5">
            {entries.map((entry) => <ArtifactCard key={entry.path} rootId={rootId} entry={entry} selecting={selecting} selected={selectedPaths.has(entry.path)} onOpen={() => openEntry(entry)} />)}
          </div></div>
        )}
        </div>
      </section>
      <Dialog open={Boolean(selectedEntry && !selectedEntry.isDirectory)} onOpenChange={(value) => !value && setSelectedEntry(null)} title={selectedEntry?.name} className="max-h-[78vh] w-[720px] overflow-y-auto">
        {preview.isPending ? <Spinner size={20} /> : preview.data?.dataUrl ? <img src={preview.data.dataUrl} alt={selectedEntry?.name ?? ''} className="max-h-[66vh] w-full object-contain" /> : preview.data?.binary || preview.data?.tooLarge ? <button type="button" onClick={() => selectedEntry && void window.clawmuse.fs.reveal(rootId, selectedEntry.path)} className="rounded-full bg-fill-raised px-4 py-2 text-caption font-semibold text-content-primary">Show in Finder</button> : <pre className="whitespace-pre-wrap font-sans text-body-sm leading-6 text-content-body">{preview.data?.content}</pre>}
      </Dialog>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialog.Title className="text-headline font-semibold text-content-primary">Delete {selectedPaths.size === 1 ? 'artifact' : `${selectedPaths.size} artifacts`}?</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-body-sm text-content-tertiary">This removes the selected local {selectedPaths.size === 1 ? 'item' : 'items'} from this computer.</AlertDialog.Description>
        <div className="mt-6 flex justify-end gap-2"><AlertDialog.Close className="rounded-full px-4 py-2 text-caption font-semibold hover:bg-fill-raised">Cancel</AlertDialog.Close><button type="button" onClick={() => void deleteSelected()} className="rounded-full bg-error px-4 py-2 text-caption font-semibold text-white">Delete</button></div>
      </AlertDialog>
    </div>
  )
}
