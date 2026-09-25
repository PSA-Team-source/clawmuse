import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { springs } from '@/design/tokens'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/brand/Spinner'
import { BUTTON_ICON, BUTTON_SIZE, type ButtonSize } from '@/components/brand/button-size'

interface GradientButtonProps {
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  size?: ButtonSize
  type?: 'button' | 'submit'
  className?: string
  children: ReactNode
}

/**
 * Primary CTA — the orange→red gradient used for every "do the big thing".
 *
 * The default is `md` — the same default `GhostButton` has. They used to
 * differ (`lg` against `md`), which meant every place the two sat side by side
 * rendered a 48px button next to a 40px one: "New task" beside "Open chat" on
 * the Tasks empty state was the clearest example. A hero CTA still asks for
 * `lg` explicitly.
 *
 * Geometry comes from daisyUI's `.btn`; only the gradient is ours, because that
 * is the one thing daisyUI has no slot for. The height, padding, radius, weight
 * and disabled state are the same rule every other button in the app obeys.
 */
export function GradientButton({
  onClick,
  disabled,
  loading,
  size = 'md',
  type = 'button',
  className,
  children,
}: GradientButtonProps) {
  const isDisabled = disabled || loading

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      transition={springs.snappy}
      className={cn('btn btn-cta', BUTTON_SIZE[size], className)}
    >
      {loading ? <Spinner size={BUTTON_ICON[size]} className="text-white" /> : children}
    </motion.button>
  )
}
