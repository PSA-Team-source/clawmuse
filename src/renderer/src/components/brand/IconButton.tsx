import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives'

type IconButtonSize = 'xs' | 'sm' | 'md'

interface IconButtonProps {
  icon: unknown
  /**
   * Always required. An icon button has no text, so this *is* its name — without
   * it a screen reader announces "button" and nothing else, and it doubles as
   * the hover title for everyone using a mouse.
   */
  label: string
  onClick?: () => void
  disabled?: boolean
  shape?: 'square' | 'circle'
  size?: IconButtonSize
  /** `quiet` is the default — transparent until hovered. `filled` sits on a surface. */
  tone?: 'quiet' | 'filled' | 'danger'
  className?: string
  type?: 'button' | 'submit'
}

const SIZE: Record<IconButtonSize, string> = {
  xs: 'btn-xs',
  sm: 'btn-sm',
  md: 'btn-md',
}

const GLYPH: Record<IconButtonSize, number> = { xs: 13, sm: 16, md: 18 }

/**
 * The icon-only button.
 *
 * Written because measuring the app found this shape hand-rolled in twelve
 * places at four different sizes — `size-5`, `size-6`, `size-8`, `size-9` and a
 * couple built from `p-1.5` — each with its own hover treatment and half of
 * them missing an accessible name. They were the largest remaining source of
 * "the buttons are different sizes", because none of them went through a
 * component at all.
 *
 * Height and corner come from daisyUI's `btn`, so an icon button is the same
 * 24 / 32 / 40 as every other button on the same rung.
 */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  shape = 'square',
  size = 'sm',
  tone = 'quiet',
  className,
  type = 'button',
}: IconButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'btn',
        SIZE[size],
        shape === 'circle' ? 'btn-circle' : 'btn-square',
        tone === 'quiet' && 'border-transparent bg-transparent text-content-tertiary hover:bg-fill-raised hover:text-content-primary',
        tone === 'filled' && 'btn-quiet',
        tone === 'danger' && 'border-transparent bg-transparent text-content-tertiary hover:bg-error/12 hover:text-error',
        className,
      )}
    >
      <Icon icon={icon} size={GLYPH[size]} className="text-current" />
    </button>
  )
}
