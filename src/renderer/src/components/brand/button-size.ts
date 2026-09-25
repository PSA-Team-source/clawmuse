/**
 * The one button size scale.
 *
 * Every button in the app resolves its height through here, and every height
 * comes from daisyUI's `--size-field` multiplier — so there is no longer a way
 * to produce a 31px or a 40px button by choosing padding instead of a size.
 *
 * Measured before this existed: thirty-two distinct button signatures across
 * seventeen screens. `GradientButton` and `GhostButton` used 36/44/52,
 * `PillButton` used 32, and a handful of one-off buttons had arrived at 16, 17,
 * 24, 31 and 40 through padding.
 *
 *   sm → 32px    md → 40px    lg → 48px
 *
 * These are daisyUI's numbers, not the app's previous 28/32/36/44/52. One scale
 * that is slightly different everywhere beats two scales that are exactly right
 * in places, and picking daisyUI's means the size can never drift from the
 * component library that draws it.
 */
export type ButtonSize = 'sm' | 'md' | 'lg'

export const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
}

/** Icon side lengths that sit correctly inside each button height. */
export const BUTTON_ICON: Record<ButtonSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
}
