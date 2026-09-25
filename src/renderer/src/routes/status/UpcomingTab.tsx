import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { z } from 'zod'
import {
  AlarmClockIcon,
  ArrowDown01Icon,
  Calendar03Icon,
  Clock01Icon,
  Clock05Icon,
  FavouriteIcon,
  Notification03Icon,
} from '@hugeicons/core-free-icons'
import { GhostButton, Skeleton, Spinner } from '@/components/brand'
import { useToast } from '@/components/patterns'
import { AlertDialog, Dialog, Icon } from '@/components/primitives'
import { StatusListCell, StatusNullState, StatusSectionHeading } from '@/components/status/StatusParts'
import { errorMessage, queryKeys, useTaskMutations, useTasks } from '@/hooks'
import { cn } from '@/lib/cn'
import { prefillComposer } from '@/lib/composer-prefill'
import { gatewayWS } from '@/services/gateway-ws.service'
import { tolerantArray } from '@/types'
import type { CronSchedule, ScheduledTask } from '@/types'
import { describeSchedule } from '@/utils/schedule'

// ── Schedule modes (Muse HatchTasksPanel) ────────────────────────────────────

/**
 * Muse keys every schedule by a mode (`daily@09:00`, `weekly@mon-09:00`, …).
 * OpenClaw jobs carry a structured `schedule` instead, so the mode is derived
 * from it: `at` is a one-off reminder, `every` is an interval (whole days and
 * whole weeks read as daily/weekly, which is what a person would call them),
 * and a cron expression is classified by which of its fields are pinned.
 */
export type ScheduleMode = 'runonce' | 'interval' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export type ScheduleGroupMode = Exclude<ScheduleMode, 'interval' | 'hourly'>

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/** Muse MODE_ALIAS: interval and hourly jobs sit in the Daily group. */
const MODE_ALIAS: Record<ScheduleMode, ScheduleGroupMode> = {
  runonce: 'runonce',
  interval: 'daily',
  hourly: 'daily',
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  yearly: 'yearly',
}

/** Muse MODE_ORDER. */
const MODE_ORDER: ScheduleGroupMode[] = ['runonce', 'daily', 'weekly', 'monthly', 'yearly']

/** Muse scheduleGroupLabel. */
const GROUP_LABEL: Record<ScheduleGroupMode, string> = {
  runonce: 'Reminders',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

const isWildcard = (field: string) => field === '*' || field === '?'

export function scheduleMode(schedule: CronSchedule | undefined): ScheduleMode {
  if (schedule?.kind === 'at') return 'runonce'
  if (schedule?.kind === 'every') {
    const every = schedule.everyMs ?? 0
    if (every > 0 && every % WEEK_MS === 0) return 'weekly'
    if (every > 0 && every % DAY_MS === 0) return 'daily'
    return 'interval'
  }
  if (schedule?.kind === 'cron' && schedule.expr) {
    let fields = schedule.expr.trim().split(/\s+/)
    // Croner's 6-field form leads with seconds.
    if (fields.length === 6) fields = fields.slice(1)
    if (fields.length !== 5) return 'interval'
    const [, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string]
    // Any hour that is not a fixed list fires several times a day.
    if (!/^\d+(,\d+)*$/.test(hour)) return 'hourly'
    if (!isWildcard(month)) return 'yearly'
    if (!isWildcard(dayOfMonth)) return 'monthly'
    if (!isWildcard(dayOfWeek)) return 'weekly'
    return 'daily'
  }
  return 'interval'
}

export interface ScheduleGroup<T> {
  mode: ScheduleGroupMode
  label: string
  schedules: T[]
}

/**
 * Muse groupSchedulesByMode + scheduleGroupLabel, over enabled jobs only (Muse
 * filters `enabled !== false`). Within a group the soonest run comes first —
 * the tab is called Upcoming.
 */
export function groupSchedulesByMode<T extends Pick<ScheduledTask, 'enabled' | 'schedule' | 'next_run_at'>>(tasks: T[]): ScheduleGroup<T>[] {
  const byMode = new Map<ScheduleGroupMode, T[]>()
  for (const task of tasks) {
    if (task.enabled === false) continue
    const mode = MODE_ALIAS[scheduleMode(task.schedule)]
    const bucket = byMode.get(mode)
    if (bucket) bucket.push(task)
    else byMode.set(mode, [task])
  }
  const nextRun = (task: T) => (task.next_run_at ? Date.parse(task.next_run_at) : Number.POSITIVE_INFINITY)
  return MODE_ORDER.filter((mode) => byMode.has(mode)).map((mode) => ({
    mode,
    label: GROUP_LABEL[mode],
    schedules: [...byMode.get(mode)!].sort((a, b) => nextRun(a) - nextRun(b)),
  }))
}

// ── Time text (Muse HatchTaskScheduleFormatting / hatchTimeUtils) ───────────

function timeIn(date: Date, tz?: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
  try {
    return date.toLocaleTimeString([], tz ? { ...options, timeZone: tz } : options).toLowerCase()
  } catch {
    return date.toLocaleTimeString([], options).toLowerCase()
  }
}

function dayKeyIn(date: Date, tz?: string): string {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
  try {
    return new Intl.DateTimeFormat('en-CA', tz ? { ...options, timeZone: tz } : options).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-CA', options).format(date)
  }
}

function shortDateIn(date: Date, tz?: string): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  try {
    return date.toLocaleDateString([], tz ? { ...options, timeZone: tz } : options)
  } catch {
    return date.toLocaleDateString([], options)
  }
}

/** Muse formatNextRunTime: "9:00 am" when it is today in the job's zone, else "Sep 24, 9:00 am". */
export function formatNextRunTime(ms: number, tz?: string, now = new Date()): string | null {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  const time = timeIn(date, tz)
  return dayKeyIn(date, tz) === dayKeyIn(now, tz) ? time : `${shortDateIn(date, tz)}, ${time}`
}

/**
 * Muse formatScheduleTime: interval and hourly jobs show their cadence, every
 * other job shows when it next fires.
 */
export function scheduleSubtitle(task: Pick<ScheduledTask, 'schedule' | 'next_run_at'>, now = new Date()): string {
  const mode = scheduleMode(task.schedule)
  if (mode !== 'interval' && mode !== 'hourly' && task.next_run_at) {
    const next = formatNextRunTime(Date.parse(task.next_run_at), task.schedule.tz, now)
    if (next) return next
  }
  return describeSchedule(task.schedule)
}

/** Muse formatActivityTime: "3:05 PM" today, "Mon 3:05 PM" this week, else "Sep 21, 3:05 PM". */
export function formatRunTime(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (date.toDateString() === new Date(now).toDateString()) return time
  const age = now - ms
  if (age > 0 && age < WEEK_MS) return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

// ── Runs (OpenClaw cron.runs) ────────────────────────────────────────────────

export type RunTone = 'success' | 'error' | 'muted'

const RUN_DOT_CLASS: Record<RunTone, string> = {
  success: 'text-success',
  error: 'text-error',
  muted: 'text-content-secondary',
}

/**
 * Muse runStatusPresentation, mapped onto OpenClaw's finished-run statuses:
 * `ok` → Succeeded, `error` → Failed (or Timed out when the failover reason
 * says so), `skipped` → Skipped. OpenClaw only logs finished runs, so Muse's
 * Queued/Dispatched states never occur here.
 */
export function runStatusPresentation(status?: string | null, errorReason?: string | null): { label: string; tone: RunTone } {
  switch ((status ?? '').toLowerCase()) {
    case 'ok':
      return { label: 'Succeeded', tone: 'success' }
    case 'error':
      return errorReason === 'timeout' ? { label: 'Timed out', tone: 'error' } : { label: 'Failed', tone: 'error' }
    case 'skipped':
      return { label: 'Skipped', tone: 'muted' }
    case 'cancelled':
      return { label: 'Cancelled', tone: 'muted' }
    default:
      return { label: 'Unknown', tone: 'muted' }
  }
}

const cronRunEntrySchema = z
  .object({
    ts: z.number(),
    runAtMs: z.number().optional(),
    runId: z.string().optional(),
    status: z.string().optional(),
    error: z.string().optional(),
    errorReason: z.string().optional(),
  })
  .loose()

const cronRunsPageSchema = z
  .object({
    entries: tolerantArray(cronRunEntrySchema, 'cron.runs.entries'),
    nextOffset: z.number().nullish(),
  })
  .loose()

type CronRunEntry = z.infer<typeof cronRunEntrySchema>

/** Muse TASK_RUN_FETCH_INCREMENT; the dialog reveals five at a time. */
const RUN_FETCH_INCREMENT = 10
const RUN_REVEAL_INCREMENT = 5

function useJobRuns(jobId: string) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.tasks, 'status-runs', jobId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const raw = await gatewayWS.call('cron.runs', { id: jobId, limit: RUN_FETCH_INCREMENT, offset: pageParam, sortDir: 'desc' })
      const parsed = cronRunsPageSchema.safeParse(raw)
      if (!parsed.success) throw new Error('The gateway returned run history in an unexpected shape.')
      return parsed.data
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    staleTime: 15_000,
  })
}

/** Muse HatchTaskRunCell. */
function RunCell({ run }: { run: CronRunEntry }) {
  const { label, tone } = runStatusPresentation(run.status, run.errorReason)
  const reason = run.status === 'ok' ? undefined : run.error
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full bg-current', RUN_DOT_CLASS[tone])} />
      <div className="flex min-w-0 flex-1 items-center gap-1 truncate text-caption text-content-secondary">
        <span>{label}</span>
        {reason && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate" title={reason}>{reason}</span>
          </>
        )}
      </div>
      <span className="shrink-0 text-caption tabular-nums text-content-secondary">{formatRunTime(run.runAtMs ?? run.ts)}</span>
    </div>
  )
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** Heartbeat is OpenClaw's own system job (payload kind `heartbeat`, declared `heartbeat:<agent>`). */
function isHeartbeat(task: ScheduledTask): boolean {
  return task.payload.kind === 'heartbeat'
}

type TileKind = 'heartbeat' | 'reminder' | 'clock' | 'calendar'

const TILE_ICON: Record<TileKind, unknown> = {
  heartbeat: FavouriteIcon,
  reminder: Notification03Icon,
  clock: Clock01Icon,
  calendar: Calendar03Icon,
}

const TILE_CLASS: Record<TileKind, string> = {
  heartbeat: 'text-error',
  reminder: 'text-content-secondary',
  clock: 'text-content-secondary',
  calendar: 'text-content-secondary',
}

/** Muse ScheduleTile: heart for the heartbeat, bell for reminders, clock for intervals, calendar otherwise. */
function tileKind(task: ScheduledTask): TileKind {
  if (isHeartbeat(task)) return 'heartbeat'
  const mode = scheduleMode(task.schedule)
  if (mode === 'runonce') return 'reminder'
  if (mode === 'interval' || mode === 'hourly') return 'clock'
  return 'calendar'
}

function UpcomingSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading scheduled tasks" className="flex flex-col gap-4 px-4 pb-3">
      {[3, 2].map((rows, section) => (
        <div key={section} aria-hidden="true" className="flex flex-col gap-2">
          <div className="pt-2">
            <Skeleton className="h-4 w-24" />
          </div>
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex items-start gap-2.5 px-2 py-2">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Detail (Muse HatchTaskDetailDialog) ──────────────────────────────────────

/** Muse useHatchScheduledTaskActions: Edit prefills the chat with the task's name. */
export function editTaskPrompt(task: Pick<ScheduledTask, 'name' | 'display_name'>): string {
  return `Edit my scheduled task “${task.display_name || task.name}”: `
}

function TaskDetail({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  // The panel sits beside the chat, so its composer receives the draft.
  function editInChat(target: ScheduledTask) {
    onClose()
    prefillComposer(editTaskPrompt(target))
  }
  const { show } = useToast()
  const { remove } = useTaskMutations()
  const runs = useJobRuns(task.cron_job_id)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [visible, setVisible] = useState(RUN_REVEAL_INCREMENT)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const loaded = useMemo(() => runs.data?.pages.flatMap((page) => page.entries) ?? [], [runs.data])
  const shown = loaded.slice(0, visible)
  const canSeeMore = visible < loaded.length || runs.hasNextPage

  async function seeMore() {
    if (visible >= loaded.length && runs.hasNextPage) await runs.fetchNextPage()
    setVisible((count) => count + RUN_REVEAL_INCREMENT)
  }

  function handleDelete() {
    remove.mutate(task.cron_job_id, {
      onSuccess: () => {
        setConfirmDelete(false)
        onClose()
        show({ title: 'Task deleted', variant: 'success' })
      },
      onError: (error) => show({ title: "Couldn't delete task. Try again.", description: errorMessage(error), variant: 'error' }),
    })
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setHistoryOpen((open) => !open)}
        aria-expanded={historyOpen}
        className="flex items-center gap-1 self-start py-1 text-footnote font-medium text-content-secondary transition-colors hover:text-content-primary"
      >
        Run history
        <Icon icon={ArrowDown01Icon} size={14} className={cn('text-current transition-transform duration-200 ease-out', !historyOpen && '-rotate-90')} />
      </button>
      {historyOpen && (
        <div className="mt-1">
          {runs.isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Spinner size={16} />
            </div>
          ) : runs.isError && loaded.length === 0 ? (
            <div className="flex items-center justify-between gap-2 py-2">
              <p className="text-caption text-content-secondary">Couldn't load run history.</p>
              <GhostButton size="sm" onClick={() => void runs.refetch()}>Retry</GhostButton>
            </div>
          ) : loaded.length === 0 ? (
            <p className="py-2 text-caption text-content-secondary">Has not run yet</p>
          ) : (
            <div className="max-h-60 overflow-y-auto pe-2">
              {shown.map((run, index) => (
                <RunCell key={run.runId ?? `${run.ts}-${index}`} run={run} />
              ))}
              {canSeeMore && (
                <button
                  type="button"
                  onClick={() => void seeMore()}
                  disabled={runs.isFetchingNextPage}
                  className="flex h-8 w-full items-center justify-center rounded-lg text-footnote font-medium text-content-primary hover:bg-fill-raised disabled:opacity-50"
                >
                  {runs.isFetchingNextPage ? <Spinner size={14} /> : 'See more'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Muse's Edit hands the task to the agent: the composer is prefilled
          and the user says what to change. */}
      <div className={cn('mt-10 grid gap-2', isHeartbeat(task) ? 'grid-cols-1' : 'grid-cols-2')}>
        <GhostButton onClick={() => editInChat(task)}>Edit</GhostButton>
        {/* The heartbeat is declared by the gateway itself; deleting it here
            would only be undone on the next config load. */}
        {!isHeartbeat(task) && (
          <GhostButton onClick={() => setConfirmDelete(true)} className="border-error/40 bg-error/10 text-error">
            Delete
          </GhostButton>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Title className="text-headline font-semibold text-content-primary">Delete task?</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-body-sm text-content-secondary">
          “{task.display_name || task.name}” will stop running. This can't be undone.
        </AlertDialog.Description>
        <div className="mt-6 flex justify-end gap-2">
          <GhostButton onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>Cancel</GhostButton>
          <GhostButton onClick={handleDelete} disabled={remove.isPending} className="border-error/40 bg-error/10 text-error">
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </GhostButton>
        </div>
      </AlertDialog>
    </div>
  )
}

// ── Tab ──────────────────────────────────────────────────────────────────────

/**
 * Status panel → Upcoming (Muse ScheduledTasksList): the enabled scheduled
 * jobs from the gateway's cron engine, grouped Reminders / Daily / Weekly /
 * Monthly / Yearly, each showing when it next fires. Selecting one opens its
 * schedule and run history.
 */
export default function UpcomingTab() {
  const { data: tasks, isLoading, isError, refetch, isFetching } = useTasks()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const groups = useMemo(() => groupSchedulesByMode(tasks ?? []), [tasks])
  const selected = useMemo(
    () => (selectedId ? (tasks ?? []).find((task) => task.cron_job_id === selectedId && task.enabled) ?? null : null),
    [tasks, selectedId],
  )
  const hasSchedules = groups.length > 0

  if (isLoading) return <UpcomingSkeleton />

  if (isError && !tasks) {
    return (
      <div className="px-4 pb-3">
        <StatusNullState
          icon={AlarmClockIcon}
          title="Couldn't load scheduled tasks"
          subtitle="The agent's scheduler didn't answer."
          action={<GhostButton size="sm" onClick={() => void refetch()} disabled={isFetching}>Try again</GhostButton>}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-3">
      {isError && (
        <div role="alert" className="rounded-lg bg-fill-raised px-3 py-2 text-footnote text-content-primary">
          Couldn't refresh scheduled tasks.
        </div>
      )}
      {!hasSchedules && <StatusNullState icon={Clock05Icon} title="Upcoming" subtitle="Nothing scheduled yet" />}
      {groups.map((group) => (
        <section key={group.mode} className="flex flex-col gap-2">
          <StatusSectionHeading>{group.label}</StatusSectionHeading>
          <div className="-mx-2 flex flex-col gap-px">
            {group.schedules.map((task) => {
              const kind = tileKind(task)
              return (
                <StatusListCell
                  key={task.cron_job_id}
                  icon={TILE_ICON[kind]}
                  iconClassName={TILE_CLASS[kind]}
                  title={task.display_name || task.name}
                  subtitle={scheduleSubtitle(task)}
                  selected={selectedId === task.cron_job_id}
                  onClick={() => setSelectedId((current) => (current === task.cron_job_id ? null : task.cron_job_id))}
                />
              )
            })}
          </div>
        </section>
      ))}

      {selected && (
        <Dialog
          open
          onOpenChange={(open) => { if (!open) setSelectedId(null) }}
          title={selected.display_name || selected.name}
          description={describeSchedule(selected.schedule)}
        >
          <TaskDetail key={selected.cron_job_id} task={selected} onClose={() => setSelectedId(null)} />
        </Dialog>
      )}
    </div>
  )
}
