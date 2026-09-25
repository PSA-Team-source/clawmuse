import { Clock01Icon, Delete02Icon, PlayIcon } from '@hugeicons/core-free-icons'
import type { CronSchedule, ScheduledTask } from '@/types'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives'
import { Switch } from '@/components/primitives'
import { RunStatusBadge } from './RunStatusBadge'

interface TaskCardProps {
  task: ScheduledTask
  onToggle: (enabled: boolean) => void
  onRun: () => void
  onDelete: () => void
  onOpen: () => void
  running?: boolean
  className?: string
}

function formatSchedule(schedule: CronSchedule): string {
  if (schedule.kind === 'every' && schedule.everyMs) {
    const minutes = Math.round(schedule.everyMs / 60_000)
    if (minutes < 60) return `Every ${minutes}m`
    const hours = Math.round(minutes / 60)
    return `Every ${hours}h`
  }
  if (schedule.kind === 'at' && schedule.at) return `At ${schedule.at}`
  if (schedule.expr) return schedule.expr
  return 'No schedule'
}

function relativeTime(iso?: string | null): string | null {
  if (!iso) return null
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return null
  const diffMs = target - Date.now()
  const diffMin = Math.round(diffMs / 60_000)
  if (Math.abs(diffMin) < 1) return 'now'
  if (Math.abs(diffMin) < 60) return diffMin > 0 ? `in ${diffMin}m` : `${-diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (Math.abs(diffHr) < 24) return diffHr > 0 ? `in ${diffHr}h` : `${-diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  return diffDay > 0 ? `in ${diffDay}d` : `${-diffDay}d ago`
}

/** Scheduled-task row: name, enable toggle, schedule summary, last-run status, run-now and delete actions. */
export function TaskCard({ task, onToggle, onRun, onDelete, onOpen, running, className }: TaskCardProps) {
  const message = (task.payload?.message as string | undefined) ?? (task.payload?.text as string | undefined) ?? task.description ?? ''
  const next = relativeTime(task.next_run_at)

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-box border border-line-subtle bg-fill p-3.5 transition-opacity hover:border-line-strong',
        !task.enabled && 'opacity-55',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="-my-1 min-h-7 min-w-0 flex-1 cursor-pointer truncate py-1 text-left text-body font-semibold text-content-primary hover:text-primary-light"
        >
          {task.display_name || task.name || 'Untitled task'}
        </button>
        <Switch
          checked={task.enabled}
          onCheckedChange={onToggle}
          aria-label={`${task.enabled ? 'Pause' : 'Resume'} ${task.display_name || task.name}`}
        />
      </div>

      {!!message && <p className="line-clamp-2 text-footnote text-content-tertiary">{message}</p>}

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Icon icon={Clock01Icon} size={13} className="shrink-0 text-content-muted" />
          <span className="truncate text-caption text-content-muted">{formatSchedule(task.schedule)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RunStatusBadge status={task.last_status} />
          {next && <span className="text-micro text-content-muted">{next}</span>}
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-fill-accent text-primary-light hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Run now"
            title="Run now"
          >
            <Icon icon={PlayIcon} size={14} className="text-current" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-content-tertiary hover:bg-error/10 hover:text-error"
            aria-label="Delete task"
            title="Delete task"
          >
            <Icon icon={Delete02Icon} size={14} className="text-current" />
          </button>
        </div>
      </div>
    </div>
  )
}
