/**
 * The few design values that cannot be a class name.
 *
 * `global.css` is the source of truth for the design system. This module used
 * to restate it — a second colour ramp, a second radius scale, a second type
 * scale, a second spacing scale — and the file said as much: it documented the
 * two colour ramps as a *deliberate* mismatch (0.7/0.6/0.5 in CSS against
 * 0.6/0.4/0.2 here). Two ramps that disagree are not two ramps, they are one
 * ramp and a bug waiting for someone to reach for the wrong one.
 *
 * Measured before deleting: the radius, spacing and typography scales had no
 * callers at all, and the colour ramp had exactly one — the xterm theme, which
 * reads CSS variables directly now (see `cssColor`).
 *
 * What is left is the part CSS genuinely cannot express: spring configurations
 * for motion, which are objects, not values.
 */

/**
 * Reads a design token at runtime.
 *
 * For the handful of APIs that take a colour string and cannot take a class —
 * xterm's theme, a canvas fill, a three.js material. Going through the
 * stylesheet means these follow the tokens automatically instead of drifting
 * the moment someone edits `global.css` and forgets this file exists.
 */
export function cssColor(token: string, fallback = '#000000'): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`)
  return value.trim() || fallback
}

/** Durations in ms. Mirrors `--duration-*` for the places that animate from JS. */
export const animation = {
  instant: 100,
  fast: 150,
  normal: 250,
  slow: 400,
  pulse: 1500,
  shimmer: 1200,
} as const

/**
 * Motion spring presets.
 *
 * These stay in JavaScript because a spring is a physics configuration, not a
 * value — CSS has no way to express damping and stiffness, and the easing
 * tokens in `global.css` are the CSS-side equivalent for anything that can use
 * a cubic-bezier instead.
 */
export const springs = {
  snappy: { type: 'spring', damping: 20, stiffness: 300 },
  bouncy: { type: 'spring', damping: 14, stiffness: 200 },
  gentle: { type: 'spring', damping: 25, stiffness: 200 },
} as const
