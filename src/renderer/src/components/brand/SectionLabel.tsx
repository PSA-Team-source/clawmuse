import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Uppercase eyebrow label above a group/section (e.g. "ACCOUNT", "INTEGRATIONS"). */
export function SectionLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('text-caption font-semibold uppercase tracking-label text-content-muted', className)}>
      {children}
    </div>
  )
}
