import type { ReactNode } from 'react'
import { Tooltip as Base } from '@base-ui/react/tooltip'
import { cn } from '@/lib/cn'

interface TooltipProps {
  /** The label. Keep it to a few words — a tooltip that needs a sentence is a missing description. */
  content: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
}

/**
 * Mount once, near the root.
 *
 * The provider is what makes a row of icon buttons feel right: the first
 * tooltip waits, and while one is already showing the next appears instantly
 * instead of making the user pause over every button in turn.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Base.Provider delay={500} closeDelay={100}>
      {children}
    </Base.Provider>
  )
}

/**
 * A hover label for a control that shows only an icon.
 *
 * This does not replace `aria-label` — a tooltip is invisible to a screen
 * reader and never appears for a keyboard user who is not hovering. The icon
 * button still needs its accessible name; this is the sighted-mouse half of the
 * same answer.
 */
export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  return (
    <Base.Root>
      <Base.Trigger render={children as React.ReactElement} />
      <Base.Portal>
        <Base.Positioner side={side} sideOffset={8} className="z-100">
          <Base.Popup
            className={cn(
              'rounded-field border border-line-strong bg-bg-card px-2 py-1 shadow-popup',
              'text-caption text-content-secondary select-none',
              'origin-(--transform-origin) transition-[transform,opacity]',
              'duration-(--duration-fast) ease-entrance',
              'data-starting-style:scale-95 data-starting-style:opacity-0',
              'data-ending-style:scale-95 data-ending-style:opacity-0',
            )}
          >
            {content}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}
