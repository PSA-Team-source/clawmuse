import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface SettingsRowProps {
  label: ReactNode
  description?: string
  value?: string
  onClick?: () => void
  /** Custom trailing control (e.g. a `Switch`) — overrides the default value/chevron. */
  right?: ReactNode
  danger?: boolean
  className?: string
}

/**
 * One row inside a `SettingsGroup`. Clickable when `onClick` is given.
 * `last:border-b-0` lives on the OUTER element (button or div) so it correctly
 * reads the row's position among `SettingsGroup`'s actual children — nesting
 * it one level deeper would make it always "last" inside a single-child button.
 */
export function SettingsRow({ label, description, value, onClick, right, danger, className }: SettingsRowProps) {
  const rowClass = cn(
    'settings-row flex w-full items-center gap-3 border-b border-line-subtle px-4 py-3.5 text-left last:border-b-0',
    onClick && 'cursor-pointer hover:bg-fill-raised',
    className,
  )

  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <p className={cn('text-body', danger ? 'text-error' : 'text-content-primary')}>{label}</p>
        {description && <p className="mt-0.5 text-caption text-content-muted">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {right ? (
          right
        ) : (
          <>
            {value && <span className="text-body-sm text-content-muted">{value}</span>}
            {onClick && <span className="text-headline text-content-disabled">›</span>}
          </>
        )}
      </div>
    </>
  )

  if (!onClick) return <div className={rowClass}>{inner}</div>

  return (
    <button type="button" onClick={onClick} className={rowClass}>
      {inner}
    </button>
  )
}
