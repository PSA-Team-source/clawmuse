import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { springs } from '@/design/tokens'
import { cn } from '@/lib/cn'

type PillVariant = 'accent' | 'cta' | 'neutral'

interface PillButtonProps {
  onClick?: () => void
  variant?: PillVariant
  disabled?: boolean
  className?: string
  children: ReactNode
}

/**
 * Two colours, two meanings — and they are not interchangeable.
 *
 * **Indigo (`accent`) says "this one is selected."** It is the same colour as
 * the active nav item and the current room, so it reads as state.
 * **Orange (`cta`) says "this does the thing."** It matches `GradientButton`,
 * which is the primary action everywhere else.
 *
 * Mixing them is what made "New skill" appear twice on one screen in two
 * different colours: the header used the default (indigo) while the empty state
 * used a `GradientButton` (orange), so the same action looked like two.
 *
 * A "create" action is `cta`. A segmented choice is `accent` when on and
 * `neutral` when off.
 */
const VARIANT: Record<PillVariant, string> = {
  accent: 'btn-pill',
  cta: 'btn-cta',
  neutral: 'btn-pill',
}

/**
 * Small pill action used in headers and toolbars.
 *
 * Height, padding and radius come from daisyUI now — `btn-sm` is 32px and
 * `--radius-selector` is fully round, so this can no longer land at 31px
 * between the chip and the back link the way the padding-based version did.
 */
export function PillButton({
  onClick,
  variant = 'accent',
  disabled,
  className,
  children,
}: PillButtonProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // `accent` is the selected colour, so it says so to assistive tech too —
      // and `.btn-pill` keys its indigo off the same attribute.
      aria-pressed={variant === 'accent' ? true : undefined}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={springs.snappy}
      className={cn('btn btn-sm', VARIANT[variant], variant === 'cta' && 'rounded-selector', className)}
    >
      {children}
    </motion.button>
  )
}
