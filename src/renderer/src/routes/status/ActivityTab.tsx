import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { AlertCircleIcon, CheckmarkCircle02Icon, LeftToRightListBulletIcon, PauseIcon, StopIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/primitives'
import { Spinner } from '@/components/brand/Spinner'
import { useToast } from '@/components/patterns'
import { SettingsButton } from '@/components/settings/ChoiceRow'
import { StatusNullState, StatusSectionHeading, dayHeading } from '@/components/status/StatusParts'
import { queryKeys, useConnected } from '@/hooks/queries'
import { cn } from '@/lib/cn'
import { gatewayWS } from '@/services/gateway-ws.service'
import { canonicalSessionKey } from '@/services/session-key'

/**
 * Muse's Activity tab (HatchTimeline → TimelineDaySection → TimelineRow),
 * fed by the OpenClaw task ledger (`tasks.list`): every cron run, sub-agent,
 * ACP and CLI task the local runtime executed, newest first, grouped by day.
 */

// ── Wire shape (openclaw gateway-protocol TaskSummarySchema) ────────────────

type TaskLedgerStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'

export interface TaskSummary {
  id: string
  taskId?: string
  kind?: string
  runtime?: string
  status: TaskLedgerStatus
  title?: string
  agentId?: string
  sessionKey?: string
  childSessionKey?: string
  /** Newer gateways only; `false` means there is no conversation to open. */
  hasTranscript?: boolean
  createdAt?: number | string
  updatedAt?: number | string
  progressSummary?: string
  terminalSummary?: string
  error?: string
}

interface TasksPage {
  tasks: TaskSummary[]
  /** Opaque: bound to the ledger revision, so it expires when tasks change. */
  nextCursor?: string
}

// ── Pure mapping (tested in __tests__/activity-tab.test.ts) ─────────────────

/** Muse's timeline statuses; `stopped` is its override for a cancelled run. */
export type ActivityStatus = 'pending' | 'error' | 'success' | 'stopped'

export interface ActivityRow {
  id: string
  title: string
  subtitle?: string
  status: ActivityStatus
  at: number
  /** The conversation the row opens, or null when there is none. */
  sessionKey: string | null
}

export interface ActivityDay {
  key: string
  label: string
  rows: ActivityRow[]
}

const STATUS: Record<TaskLedgerStatus, ActivityStatus> = {
  queued: 'pending',
  running: 'pending',
  completed: 'success',
  failed: 'error',
  timed_out: 'error',
  cancelled: 'stopped',
}

function toMs(value: number | string | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Muse formatSubtitle: "1 file(s)" → "1 file", "3 file(s)" → "3 files". */
function formatSubtitle(text: string): string {
  return text.replace(/(\d+)\s+(\w+)\(s\)/g, (_match, count: string, noun: string) => (Number(count) === 1 ? `${count} ${noun}` : `${count} ${noun}s`))
}

function subtitleFor(task: TaskSummary, status: ActivityStatus): string | undefined {
  const text =
    status === 'pending' ? task.progressSummary
    : status === 'error' ? task.error || task.terminalSummary || (task.status === 'timed_out' ? 'Timed out' : undefined)
    : status === 'stopped' ? task.terminalSummary || task.error || 'Stopped'
    : task.terminalSummary
  const trimmed = text?.trim()
  return trimmed ? formatSubtitle(trimmed) : undefined
}

/**
 * The conversation a task's transcript lives in — the gateway's own
 * `taskTranscriptSessionKey`: a sub-agent's is its child session, anything
 * else falls back to the session that asked for it.
 */
function transcriptKey(task: TaskSummary): string | null {
  if (task.hasTranscript === false) return null
  const child = task.childSessionKey?.trim()
  const key = task.runtime === 'subagent' ? child : child || task.sessionKey?.trim()
  return key ? canonicalSessionKey(key) : null
}

export function toActivityRow(task: TaskSummary): ActivityRow | null {
  const at = toMs(task.createdAt) ?? toMs(task.updatedAt)
  if (at === null) return null
  const status = STATUS[task.status] ?? 'success'
  return {
    id: task.taskId ?? task.id,
    title: task.title?.trim() || 'Background task',
    subtitle: subtitleFor(task, status),
    status,
    at,
    sessionKey: transcriptKey(task),
  }
}

/**
 * Flattens ledger pages into Muse's day groups: de-duplicated by task id (an
 * offset page can repeat a row when the ledger moves between fetches), newest
 * first, one section per local calendar day.
 */
export function groupActivity(tasks: TaskSummary[], now = new Date()): ActivityDay[] {
  const seen = new Set<string>()
  const rows: ActivityRow[] = []
  for (const task of tasks) {
    const row = toActivityRow(task)
    if (!row || seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
  }
  rows.sort((a, b) => b.at - a.at)
  const days: ActivityDay[] = []
  for (const row of rows) {
    const key = new Date(row.at).toDateString()
    const last = days[days.length - 1]
    if (last?.key === key) last.rows.push(row)
    else days.push({ key, label: dayHeading(row.at, now), rows: [row] })
  }
  return days
}

/** Muse formatActionTime: "3:42 pm". */
function actionTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

// ── Data ────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50
/** Fallback while something is running: task events are sent `dropIfSlow`. */
const ACTIVE_POLL_MS = 5_000
/** Task events arrive per progress update; one refetch per burst is enough. */
const EVENT_COALESCE_MS = 1_000
// Under `tasks`, so the gateway store's `cron` event invalidation refreshes it too.
const activityKey = [...queryKeys.tasks, 'activity'] as const

function hasPending(data: InfiniteData<TasksPage> | undefined): boolean {
  return Boolean(data?.pages.some((page) => page.tasks.some((task) => task.status === 'queued' || task.status === 'running')))
}

function useActivity() {
  const connected = useConnected()
  const queryClient = useQueryClient()
  const query = useInfiniteQuery({
    queryKey: activityKey,
    queryFn: ({ pageParam }) => gatewayWS.call<TasksPage>('tasks.list', { limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: connected,
    staleTime: 5_000,
    refetchInterval: (q) => (hasPending(q.state.data) ? ACTIVE_POLL_MS : false),
    refetchIntervalInBackground: true,
  })

  // The gateway pushes a `task` event on every ledger upsert/delete. Bound to
  // `connected` because the gateway store clears every socket listener before
  // each reconnect.
  useEffect(() => {
    if (!connected) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = gatewayWS.on('event', (frame) => {
      if (frame.event !== 'task' || timer) return
      timer = setTimeout(() => {
        timer = null
        void queryClient.invalidateQueries({ queryKey: activityKey })
      }, EVENT_COALESCE_MS)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [connected, queryClient])

  return query
}

/** Muse useOnInView with a 400px lead, measured against the panel's own scroller. */
function useInView(onEnter: () => void) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const callback = useRef(onEnter)
  useEffect(() => {
    callback.current = onEnter
  })
  useEffect(() => {
    if (!node) return
    let root: HTMLElement | null = node.parentElement
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) callback.current()
    }, { root, rootMargin: '400px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return setNode
}

// ── View ────────────────────────────────────────────────────────────────────

const TILE: Record<ActivityStatus, { icon: unknown; className: string }> = {
  pending: { icon: null, className: 'text-content-primary' },
  success: { icon: CheckmarkCircle02Icon, className: 'text-content-primary' },
  error: { icon: AlertCircleIcon, className: 'text-error' },
  stopped: { icon: PauseIcon, className: 'text-content-secondary' },
}

/** Muse HatchActivityIconTile: 40pt squircle, 24pt glyph; pending animates. */
function ActivityTile({ status }: { status: ActivityStatus }) {
  const tile = TILE[status]
  return (
    <span aria-hidden className={cn('flex size-10 shrink-0 items-center justify-center rounded-field bg-fill-raised', tile.className)}>
      {status === 'pending' ? <Spinner size={20} className="text-content-primary" /> : <Icon icon={tile.icon} size={24} className="text-current" />}
    </span>
  )
}

/** Muse HatchStatusStackedRow: tile, title / subtitle / time, optional hover action. */
function StackedRow({ tile, title, subtitle, meta, onClick, hoverAction }: { tile: ReactNode; title: string; subtitle?: string; meta: string; onClick?: () => void; hoverAction?: ReactNode }) {
  const interactive = onClick != null || hoverAction != null
  const body = (
    <>
      {tile}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="break-words text-body-sm font-medium text-content-primary">{title}</div>
        {subtitle != null && <div className="break-words text-footnote text-content-secondary">{subtitle}</div>}
        <div className="text-caption tabular-nums text-content-secondary">{meta}</div>
      </div>
    </>
  )
  const className = cn('flex w-full items-start gap-2 py-2 text-start', interactive && 'rounded-field px-2 hover:bg-fill-raised', onClick != null && 'cursor-pointer', hoverAction != null && 'pe-10')
  const row = onClick ? <button type="button" onClick={onClick} className={className}>{body}</button> : <div className={className}>{body}</div>
  if (!interactive) return row
  return (
    <div className="group relative -mx-2">
      {row}
      {hoverAction != null && (
        <div className="pointer-events-none absolute end-2 top-1/2 z-20 -translate-y-1/2 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          {hoverAction}
        </div>
      )}
    </div>
  )
}

function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Stop task" title="Stop task" onClick={onClick} className="flex size-7 items-center justify-center rounded-full border border-line bg-bg-panel text-content-primary hover:bg-fill-raised">
      <Icon icon={StopIcon} size={16} className="text-current" />
    </button>
  )
}

function TimelineRow({ row, stopping, onStop, onOpen }: { row: ActivityRow; stopping: boolean; onStop: (row: ActivityRow) => void; onOpen: (key: string) => void }) {
  const key = row.sessionKey
  return (
    <StackedRow
      tile={<ActivityTile status={row.status} />}
      title={row.title}
      subtitle={row.subtitle}
      meta={actionTime(row.at)}
      onClick={key ? () => onOpen(key) : undefined}
      hoverAction={row.status === 'pending' && !stopping ? <StopButton onClick={() => onStop(row)} /> : undefined}
    />
  )
}

export default function ActivityTab() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { show } = useToast()
  const query = useActivity()
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = query
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set())

  const days = useMemo(() => groupActivity(data?.pages.flatMap((page) => page.tasks) ?? []), [data])

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return
    // A cursor expires when the ledger moves; restart from the top instead.
    void fetchNextPage().then((result) => {
      if (result.isError) void refetch()
    })
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, refetch])
  const sentinel = useInView(loadMore)

  const stop = useCallback(async (row: ActivityRow) => {
    setStopping((prev) => new Set(prev).add(row.id))
    const release = () => setStopping((prev) => { const next = new Set(prev); next.delete(row.id); return next })
    try {
      const result = await gatewayWS.call<{ found: boolean; cancelled: boolean; reason?: string }>('tasks.cancel', { taskId: row.id })
      if (!result.cancelled) {
        release()
        show({ title: 'Couldn’t stop this task', description: result.reason ?? (result.found ? undefined : 'It has already finished.'), variant: 'error' })
      }
    } catch (error) {
      release()
      show({ title: 'Couldn’t stop this task', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    } finally {
      void queryClient.invalidateQueries({ queryKey: activityKey })
    }
  }, [queryClient, show])

  const open = useCallback((key: string) => navigate(`/chat/${encodeURIComponent(key)}`), [navigate])

  if (isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading activity" className="flex items-center justify-center px-4 py-8">
        <Spinner size={20} className="text-content-secondary" />
      </div>
    )
  }
  if (isError && days.length === 0) {
    return (
      <div role="alert" className="pb-3">
        <StatusNullState icon={AlertCircleIcon} title="Couldn’t load this activity feed" subtitle="Please try again." action={<SettingsButton onClick={() => void refetch()}>Try again</SettingsButton>} />
      </div>
    )
  }
  if (days.length === 0) {
    return (
      <div className="pb-3">
        <StatusNullState icon={LeftToRightListBulletIcon} title="Activity" subtitle="No activity yet" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-3">
      {days.map((day) => (
        <section key={day.key} className="flex flex-col gap-2">
          <StatusSectionHeading>{day.label}</StatusSectionHeading>
          <div className="flex flex-col gap-px">
            {day.rows.map((row) => (
              <TimelineRow key={row.id} row={row} stopping={stopping.has(row.id)} onStop={(r) => void stop(r)} onOpen={open} />
            ))}
          </div>
        </section>
      ))}
      {hasNextPage && (
        <div ref={sentinel} className="flex items-center justify-center py-4">
          {isFetchingNextPage && <Spinner size={16} className="text-content-secondary" />}
        </div>
      )}
    </div>
  )
}
