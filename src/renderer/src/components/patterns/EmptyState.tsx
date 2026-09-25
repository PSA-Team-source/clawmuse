import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

/** Centred icon · title · description · CTA block for empty lists, errors, and disconnected states. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2.5 px-6 text-center', className)}>
      {icon && <div className="text-content-disabled">{icon}</div>}
      <h3 className="text-headline font-semibold text-content-primary">{title}</h3>
      {description && <p className="max-w-sm text-body-sm leading-5 text-content-tertiary">{description}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}
