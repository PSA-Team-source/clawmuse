import { cn } from '@/lib/cn'

/**
 * Shimmer placeholder. Sizing is entirely className-driven (e.g. `h-4 w-32`) —
 * the shimmer animation itself lives in `global.css`'s `.skeleton` utility.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-field', className)} />
}
