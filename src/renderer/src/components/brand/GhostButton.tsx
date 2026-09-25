import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { springs } from '@/design/tokens'
import { cn } from '@/lib/cn'
import { BUTTON_SIZE, type ButtonSize } from '@/components/brand/button-size'

interface GhostButtonProps {
  onClick?: () => void
  disabled?: boolean
  size?: ButtonSize
  /**
   * Required in spirit whenever the button holds only an icon: without it a
   * screen reader announces an empty button, and a tooltip-less icon is a
   * guess for everyone else too.
   */
  'aria-label'?: string
  title?: string
  className?: string
  children: ReactNode
}

/** Secondary action — a hairline over a faint fill, for anything that is not the main CTA. */
export function GhostButton({
  onClick,
  disabled,
  size = 'md',
  'aria-label': ariaLabel,
  title,
  className,
  children,
}: GhostButtonProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={springs.snappy}
      className={cn('btn btn-quiet', BUTTON_SIZE[size], className)}
    >
      {children}
    </motion.button>
  )
}
