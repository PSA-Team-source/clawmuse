import { cn } from '@/lib/cn'

/**
 * Named `Separator` after the ARIA role and every component library that has
 * one; it was `Divider`, which named the line rather than the job.
 * Hairline horizontal rule for splitting sections inside cards/panels. */
export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn('h-px w-full bg-line-subtle', className)} />
}
