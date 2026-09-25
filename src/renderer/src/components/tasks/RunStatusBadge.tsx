import { cn } from '@/lib/cn'

interface RunStatusBadgeProps {
  status?: string | null
  className?: string
}

const COLOR_CLASS: Record<string, string> = {
  ok: 'text-success',
  success: 'text-success',
  error: 'text-error',
  failed: 'text-error',
  running: 'text-warning',
  pending: 'text-primary-light',
}

const DOT_CLASS: Record<string, string> = {
  ok: 'bg-success',
  success: 'bg-success',
  error: 'bg-error',
  failed: 'bg-error',
  running: 'bg-warning',
  pending: 'bg-primary-light',
}

/** Small dot + label for a scheduled task's last run outcome. Renders nothing when there's no run yet. */
export function RunStatusBadge({ status, className }: RunStatusBadgeProps) {
  if (!status) return null
  const key = status.toLowerCase()
  const textClass = COLOR_CLASS[key] ?? 'text-content-muted'
  const dotClass = DOT_CLASS[key] ?? 'bg-content-muted'

  return (
    <span
      className={cn(
        // Same `badge` rule as `Badge`, so the two stay level with each other
        // without either restating a height.
        'badge badge-sm gap-1.5 rounded-selector font-semibold capitalize',
        'border-current/30 bg-transparent',
        textClass,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', dotClass)} />
      {status}
    </span>
  )
}
