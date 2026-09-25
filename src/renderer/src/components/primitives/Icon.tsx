import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { cn } from '@/lib/cn'

interface IconProps {
  /**
   * Typed `unknown` at the boundary because callers pass hugeicons constants
   * from `@hugeicons/core-free-icons`, whose exported `IconSvgObject` type is
   * structurally compatible but not nominally the same as `IconSvgElement`.
   */
  icon: unknown
  size?: number
  className?: string
  strokeWidth?: number
}

/** App-wide icon wrapper around HugeiconsIcon. Defaults to `content-primary` via `currentColor`. */
export function Icon({ icon, size = 20, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <HugeiconsIcon
      icon={icon as IconSvgElement}
      size={size}
      strokeWidth={strokeWidth}
      className={cn('text-content-primary', className)}
    />
  )
}
