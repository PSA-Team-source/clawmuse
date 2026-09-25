import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface ChipProps {
  children: ReactNode
  /** Filled when on; outlined when off. */
  selected?: boolean
  onClick?: () => void
  className?: string
}

/**
 * A small, tappable label: a filter, a tag, a preset.
 *
 * Measuring the app turned up four shapes doing this job — pill and 12px
 * radius, 400 and 500 weight, with and without a border — and two of them sat
 * on the same screen a few rows apart. One component, one shape.
 *
 * `btn-xs` (24px) is the smallest rung of the shared scale, which is where a
 * chip belongs: smaller than a toolbar pill, and still the same shape language.
 */
export function Chip({ children, selected = false, onClick, className }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      className={cn('btn btn-xs btn-pill capitalize', className)}
      // `.btn-pill` reads its selected colour from this, so a chip with no
      // handler can still show state without pretending to be pressable.
      data-selected={selected ? '' : undefined}
    >
      {children}
    </button>
  )
}
