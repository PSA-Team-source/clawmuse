import { Switch as Base } from '@base-ui/react/switch'
import { cn } from '@/lib/cn'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  /**
   * What this switch controls. A toggle carries no text of its own, so without
   * it VoiceOver announces a bare "switch" and the user has to infer the
   * subject from whatever happens to sit nearby.
   */
  'aria-label'?: string
  className?: string
}

/**
 * The settings toggle, sized and coloured as Muse's: a borderless 36×22
 * track, blue when on, with a 17px thumb that stretches while pressed.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  'aria-label': ariaLabel,
  className,
}: SwitchProps) {
  return (
    <Base.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      // Muse's exact inset (22 − 17 = 5px split evenly); off the 4px grid on purpose.
      style={{ padding: 2.5 }}
      className={cn(
        // `inline-flex`, not the default: Base UI renders the root as a <span>,
        // and an inline span ignores width and height outright. Without this the
        // track collapsed to 20×65 — squashed sideways and stretched down by its
        // own thumb — everywhere it was not a direct flex child.
        'group relative inline-flex h-[22px] w-9 shrink-0 items-center',
        'cursor-pointer rounded-full bg-switch-off',
        'transition-colors duration-(--duration-fast) ease-standard',
        'data-checked:bg-muse-blue',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
    >
      <Base.Thumb
        className={cn(
          'block h-[17px] w-[17px] rounded-full bg-white shadow-sm',
          'transition-all duration-150 ease-out',
          'data-checked:translate-x-[14px]',
          'group-active:w-6 group-active:data-checked:translate-x-[7px]',
        )}
      />
    </Base.Root>
  )
}
