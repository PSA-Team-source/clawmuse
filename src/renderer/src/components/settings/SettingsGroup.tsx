import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { SectionLabel } from '@/components/brand'

interface SettingsGroupProps {
  title?: string
  children: ReactNode
  className?: string
}

/** Card wrapper for a group of `SettingsRow`s, with an optional eyebrow title. */
export function SettingsGroup({ title, children, className }: SettingsGroupProps) {
  return (
    <div className={cn('settings-group mb-6', className)}>
      {title && (
        <div className="mb-2 px-4">
          <SectionLabel>{title}</SectionLabel>
        </div>
      )}
      <div className="overflow-hidden rounded-box border border-line bg-fill-subtle">{children}</div>
    </div>
  )
}
