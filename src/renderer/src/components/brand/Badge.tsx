import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

interface BadgeProps {
  variant?: BadgeVariant
  className?: string
  children: ReactNode
}

const VARIANT: Record<BadgeVariant, string> = {
  success: 'bg-success-bg border-success-border text-success',
  warning: 'bg-warning-bg border-warning-border text-warning',
  error: 'bg-error-bg border-error-border text-error',
  info: 'bg-info-bg border-info-border text-info',
  neutral: 'bg-fill border-line-strong text-content-secondary',
}

/** Small status pill — variant maps 1:1 to the semantic tokens in `global.css`. */
export function Badge({ variant = 'neutral', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        // daisyUI's `badge` owns the height, padding and corner; only the
        // semantic colour below is ours.
        'badge badge-sm w-fit rounded-selector font-semibold tracking-wide',
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
