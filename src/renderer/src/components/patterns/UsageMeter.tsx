import type { UsageInfo } from '@/types'
import { cn } from '@/lib/cn'

interface UsageMeterProps {
  usage: UsageInfo | null
  variant?: 'compact' | 'full'
  className?: string
}

/** <80% success, >=80% warning, >=100% or capped → error. */
function barColor(percent: number, capped: boolean): string {
  if (capped || percent >= 100) return 'bg-error'
  if (percent >= 80) return 'bg-warning'
  return 'bg-success'
}

/** Renders whatever `usage` it is handed — data comes from `useUsage()` at the call site, never fetched here. */
export function UsageMeter({ usage, variant = 'compact', className }: UsageMeterProps) {
  if (!usage) return null

  const percent = Math.min(100, Math.max(0, Math.round(usage.percent)))
  const fillClass = barColor(percent, usage.capped)

  if (variant === 'compact') {
    return (
      <div
        className={cn('flex items-center gap-1.5', className)}
        title={`AI usage: ${percent}%`}
        aria-label={`AI usage ${percent} percent`}
      >
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-fill-stronger">
          <div className={cn('h-full rounded-full transition-[width]', fillClass)} style={{ width: `${percent}%` }} />
        </div>
        <span className={cn('text-micro font-semibold', usage.capped ? 'text-error' : 'text-content-muted')}>
          {usage.capped ? 'Limit reached' : `${percent}%`}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2.5 rounded-box border border-line-subtle bg-fill p-4', className)}>
      <div className="flex items-center justify-between">
        <span className="text-body-sm text-content-body">AI usage this month</span>
        <span className="text-body-sm font-bold text-content-primary">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-fill-stronger">
        <div className={cn('h-full rounded-full transition-[width]', fillClass)} style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-caption text-content-muted">
          ${usage.used.toFixed(2)} / ${usage.limit.toFixed(2)}
        </span>
        {usage.capped && <span className="text-footnote font-semibold text-error">Limit reached</span>}
      </div>
    </div>
  )
}
