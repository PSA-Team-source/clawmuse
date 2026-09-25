import type { ReactNode } from 'react'
import { AlertDialog as Base } from '@base-ui/react/alert-dialog'
import { cn } from '@/lib/cn'
import { backdropClass, popupClass } from './Dialog'

interface AlertDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  /**
   * `critical` lifts the dialog above everything including other modals. The
   * exec-approval prompt needs it: the agent is blocked until it is answered,
   * so it has to be reachable from whatever screen the user happens to be on.
   */
  layer?: 'modal' | 'critical'
  className?: string
  children: ReactNode
}

/**
 * A dialog that has to be answered.
 *
 * The difference from `Dialog` is not visual. An alert dialog will not close on
 * an outside click, because clicking away is the gesture people make without
 * deciding anything — and "delete this" or "let the agent run this command" is
 * not a question a reflex should be able to answer. Base UI enforces that: the
 * component has no `dismissible` prop to turn it off.
 *
 * Composed rather than canned, because these prompts are not uniform: the exec
 * approval shows the command's arguments, a delete confirmation shows a name.
 */
export function AlertDialog({
  open,
  onOpenChange,
  layer = 'modal',
  className,
  children,
}: AlertDialogProps) {
  const critical = layer === 'critical'
  return (
    <Base.Root open={open} onOpenChange={onOpenChange}>
      <Base.Portal>
        <Base.Backdrop className={cn(backdropClass, critical && 'z-200')} />
        <Base.Popup className={cn(popupClass, critical && 'z-200', className)}>
          {children}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}

AlertDialog.Title = Base.Title
AlertDialog.Description = Base.Description
AlertDialog.Close = Base.Close
