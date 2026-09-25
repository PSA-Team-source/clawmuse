import type { ReactNode } from 'react'
import { Collapsible as Base } from '@base-ui/react/collapsible'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives/Icon'

interface CollapsibleProps {
  /** The always-visible summary row. */
  summary: ReactNode
  /** Which end the chevron sits on — leading for a heading, trailing for a row that has its own leading icon. */
  chevron?: 'start' | 'end'
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerClassName?: string
  panelClassName?: string
  className?: string
  children: ReactNode
}

/**
 * A disclosure.
 *
 * Three chat components had built this from a `useState` and a rotating
 * chevron. What they could not do from that position is animate the height —
 * `height: auto` is not animatable — so the thinking block and every tool card
 * snapped open. Base UI measures the panel and publishes
 * `--collapsible-panel-height`, which is what makes the transition possible.
 *
 * It also gets `aria-expanded` and `aria-controls` right, which the hand-rolled
 * versions had spelled three different ways.
 */
export function Collapsible({
  summary,
  chevron = 'start',
  defaultOpen,
  open,
  onOpenChange,
  triggerClassName,
  panelClassName,
  className,
  children,
}: CollapsibleProps) {
  const marker = (
    <Icon
      icon={ArrowRight01Icon}
      size={14}
      className={cn(
        'shrink-0 text-content-muted transition-transform',
        'duration-(--duration-fast) ease-standard group-data-panel-open:rotate-90',
      )}
    />
  )

  return (
    <Base.Root
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
      className={className}
    >
      <Base.Trigger
        className={cn(
          'group flex w-full cursor-pointer items-center gap-1.5 text-left outline-none',
          'focus-visible:rounded-field focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
          triggerClassName,
        )}
      >
        {chevron === 'start' && marker}
        {summary}
        {chevron === 'end' && marker}
      </Base.Trigger>
      <Base.Panel
        className={cn(
          'h-(--collapsible-panel-height) overflow-hidden',
          'transition-[height] duration-(--duration-normal) ease-standard',
          'data-starting-style:h-0 data-ending-style:h-0',
          panelClassName,
        )}
      >
        {children}
      </Base.Panel>
    </Base.Root>
  )
}
