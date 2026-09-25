import type { ReactNode } from 'react'
import { Icon } from '@/components/primitives'
import { cn } from '@/lib/cn'

/** Muse HatchStatusSectionHeading. */
export function StatusSectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-body-sm font-medium text-content-primary">{children}</h3>
}

/** Muse NullState as the status tabs use it: 28pt icon, title, one line. */
export function StatusNullState({ icon, title, subtitle, action }: { icon: unknown; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 pt-8 text-center">
      <Icon icon={icon} size={28} className="text-content-secondary" />
      <h3 className="text-body-sm font-medium text-content-primary">{title}</h3>
      {subtitle && <p className="text-footnote text-content-primary">{subtitle}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/**
 * Muse HatchStatusListCell: 24pt icon column, footnote-emphasized title,
 * caption tertiary subtitle, optional trailing slot, hover background when
 * clickable, accent outline when selected.
 */
export function StatusListCell({
  icon,
  iconNode,
  iconClassName,
  title,
  subtitle,
  trailing,
  onClick,
  selected,
  lines = 1,
}: {
  icon?: unknown
  iconNode?: ReactNode
  iconClassName?: string
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  selected?: boolean
  lines?: 1 | 2 | 3
}) {
  const body = (
    <>
      <span className={cn('flex h-8 w-6 shrink-0 items-center justify-center', iconClassName)}>{iconNode ?? (icon != null && <Icon icon={icon} size={22} className="text-current" />)}</span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 text-muse-artifact-name font-semibold text-content-primary', lines === 1 ? 'truncate' : lines === 2 ? 'line-clamp-2' : 'line-clamp-3')} title={typeof title === 'string' ? title : undefined}>{title}</span>
          {trailing != null && <span className="shrink-0">{trailing}</span>}
        </span>
        {subtitle != null && <span className="mt-0.5 block truncate text-muse-artifact-meta text-content-tertiary">{subtitle}</span>}
      </span>
    </>
  )
  const className = cn('flex w-full items-start gap-2.5 rounded-lg border px-2 py-2 text-start', selected ? 'border-primary/30 bg-fill-accent' : 'border-transparent', onClick && 'cursor-pointer hover:bg-fill-raised')
  return onClick ? <button type="button" onClick={onClick} className={className}>{body}</button> : <div className={className}>{body}</div>
}

/** Muse formatDayHeader: "Today", "Yesterday", else "Sep 21". */
export function dayHeading(ms: number, now = new Date()): string {
  const date = new Date(ms)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === now.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Muse formatCompactRelativeDate: "just now", "5m", "3h", "Mon", then "Sep 21" / "Sep 21, 2025". */
export function compactAge(ms: number, now = Date.now()): string {
  const seconds = Math.floor(Math.max(0, now - ms) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const date = new Date(ms)
  if (now - ms < 7 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: 'short' })
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}
