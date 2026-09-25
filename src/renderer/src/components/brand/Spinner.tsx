import { motion } from 'motion/react'
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives/Icon'

interface SpinnerProps {
  size?: number
  className?: string
}

/** Continuously-rotating loading spinner — `Loading03Icon` spun via `motion` since the SVG itself is static. */
export function Spinner({ size = 16, className }: SpinnerProps) {
  return (
    <motion.div
      className="inline-flex"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
    >
      {/* `Icon` forces its own text color by default, so forward the caller's
          className to actually reach the SVG's `currentColor`. */}
      <Icon icon={Loading03Icon} size={size} className={cn('text-primary-light', className)} />
    </motion.div>
  )
}
