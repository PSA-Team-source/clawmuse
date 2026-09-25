import type { ReactNode } from 'react'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives/Icon'

export interface Segment<T extends string> {
  value: T
  label: ReactNode
  icon?: unknown
}

interface SegmentedControlProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  items: Segment<T>[]
  'aria-label': string
  className?: string
}

/**
 * A row of mutually exclusive options where one is always chosen.
 *
 * Three places had simulated this with `PillButton` and a string comparison,
 * which meant three slightly different answers to what "selected" looks like —
 * one of them an ad-hoc `bg-white/14` that said "selected" nowhere else.
 *
 * Base UI's toggle group is multi-select by design, so the wrapper enforces the
 * "exactly one" part: clicking the active segment does nothing rather than
 * leaving the control with no answer at all.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  items,
  'aria-label': ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      onValueChange={(next) => {
        // `next` holds the previous value plus the pressed one, or nothing at
        // all when the active segment was pressed. Either way, the only useful
        // answer is the one that is not already selected.
        const picked = (next as T[]).find((v) => v !== value)
        if (picked) onValueChange(picked)
      }}
      className={cn('flex rounded-full bg-fill-raised p-0.5', className)}
    >
      {items.map((item) => (
        <Toggle
          key={item.value}
          value={item.value}
          className={cn(
            // Same `btn` rule as every other control, so a segment is exactly
            // as tall as the pill beside it rather than nearly as tall.
            'btn btn-sm rounded-selector gap-1.5 outline-none select-none',
            'border-transparent bg-transparent text-content-muted',
            'hover:not-data-pressed:bg-fill-raised',
            // Indigo for the chosen segment — the same colour the sidebar uses
            // for the current screen.
            'data-pressed:border-primary/30 data-pressed:bg-fill-accent data-pressed:text-primary-light',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
          )}
        >
          {item.icon != null && <Icon icon={item.icon} size={15} className="text-current" />}
          {item.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
