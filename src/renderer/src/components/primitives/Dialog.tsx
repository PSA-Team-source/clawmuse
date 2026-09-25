import type { ReactNode } from 'react'
import { Dialog as Base } from '@base-ui/react/dialog'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives/Icon'

interface DialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  title?: string
  description?: string
  className?: string
  backdropClassName?: string
  children: ReactNode
}

/** Shared by `Dialog` and `AlertDialog` so the two never drift apart visually. */
export const backdropClass = cn(
  'fixed inset-0 z-50 bg-scrim',
  'transition-opacity duration-(--duration-normal) ease-standard',
  'data-starting-style:opacity-0 data-ending-style:opacity-0',
)

export const popupClass = cn(
  'material-thick fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
  'w-[440px] max-w-[calc(100vw-2rem)] rounded-box p-6 shadow-modal outline-none',
  'transition-[transform,opacity] duration-(--duration-normal) ease-entrance',
  'data-starting-style:scale-95 data-starting-style:opacity-0',
  'data-ending-style:scale-95 data-ending-style:opacity-0',
)

/**
 * A dismissible dialog: the user can close it and nothing happens.
 *
 * For anything the user must answer — deleting, approving spend, running a
 * command — use `AlertDialog` instead. It traps focus the same way but refuses
 * to close on an outside click or Escape, because those are the two gestures
 * people make by reflex, and a reflex should not be able to answer a question
 * that matters.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  className,
  backdropClassName,
  children,
}: DialogProps) {
  return (
    <Base.Root open={open} onOpenChange={onOpenChange}>
      <Base.Portal>
        <Base.Backdrop className={cn(backdropClass, backdropClassName)} />
        <Base.Popup className={cn(popupClass, className)}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              {/* A dialog needs an accessible name even where the design shows none. */}
              <Base.Title
                className={title ? 'text-headline font-semibold text-content-primary' : 'sr-only'}
              >
                {title ?? 'Dialog'}
              </Base.Title>
              {description && (
                <Base.Description className="mt-1 text-body-sm text-content-tertiary">
                  {description}
                </Base.Description>
              )}
            </div>
            <Base.Close
              className="shrink-0 cursor-pointer rounded-full p-1 text-content-tertiary transition-colors hover:bg-fill-raised hover:text-content-primary"
              aria-label="Close dialog"
              title="Close"
            >
              <Icon icon={Cancel01Icon} size={16} className="text-current" />
            </Base.Close>
          </div>
          {children}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}
