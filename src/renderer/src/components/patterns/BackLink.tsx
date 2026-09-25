import { useNavigate } from 'react-router-dom'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives/Icon'

interface BackLinkProps {
  /** Where "back" goes. Explicit rather than `history.back()`: a detail screen
   *  reached from a deep link has no history to return to. */
  to: string
  /** The place being returned to, e.g. "Settings". */
  label: string
  /**
   * Intercepts the navigation — for a screen that must ask about unsaved work
   * first. Responsible for navigating itself once it decides to.
   */
  onClick?: () => void
  className?: string
}

/**
 * The "← Somewhere" control at the top of every detail screen.
 *
 * Written after measuring the app: thirteen screens had one of these and they
 * had drifted into three different styles — purple/medium, grey/medium and
 * grey/regular — for a control that does exactly the same thing everywhere. A
 * component is the only way that stays fixed.
 *
 * The hit area is 32px tall while the text sits where it always did: padding
 * grows the target, a negative margin cancels it in layout.
 */
export function BackLink({ to, label, onClick, className }: BackLinkProps) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={onClick ?? (() => navigate(to))}
      aria-label={`Back to ${label}`}
      className={cn(
        '-mx-2 flex min-h-8 w-fit cursor-pointer items-center gap-1.5 rounded-field px-2',
        'text-body-sm font-medium text-content-tertiary transition-colors hover:text-content-primary',
        className,
      )}
    >
      <Icon icon={ArrowLeft01Icon} size={16} className="text-current" />
      {label}
    </button>
  )
}
