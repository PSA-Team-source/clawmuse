import { cn } from '@/lib/cn'

/**
 * The ClawMuse mark — a claw catching a spark — drawn from the same geometry
 * as the app icon (resources/glyph.svg), so every in-app logo matches the Dock.
 * Coordinates are the icon's 1024 canvas; `glyph` crops to the mark itself.
 */

const BRAND_CORAL = '#FF5A4E'
const CANVAS = 1024
const CORNER = 0.2237 * CANVAS // the macOS/iOS icon corner radius
/** The mark's bounding box in the 1024 canvas (measured from the rendered glyph). */
const MARK = { x: 322, y: 174, w: 478, h: 637 }

function Mark() {
  return (
    <g transform="translate(512 512) scale(0.86) translate(-512 -512) translate(34 -14)">
      <g transform="rotate(32 512 560)">
        <path d="M352 736 C 318 500 356 292 492 140 C 452 280 456 440 530 626 Z" />
        <path d="M512 642 C 616 482 618 330 566 196 C 682 288 712 460 672 668 Z" />
        <ellipse cx="516" cy="728" rx="170" ry="168" />
      </g>
      <path d="M742 132 C 748 186 760 198 814 204 C 760 210 748 222 742 276 C 736 222 724 210 670 204 C 724 198 736 186 742 132 Z" />
    </g>
  )
}

interface ClawMuseLogoProps {
  size?: number
  variant?: 'glyph' | 'badge'
  className?: string
}

export function ClawMuseLogo({ size = 64, variant = 'glyph', className }: ClawMuseLogoProps) {
  if (variant === 'badge') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${CANVAS} ${CANVAS}`} className={className} aria-hidden>
        <rect width={CANVAS} height={CANVAS} rx={CORNER} ry={CORNER} fill={BRAND_CORAL} />
        <g fill="#ffffff"><Mark /></g>
      </svg>
    )
  }
  return (
    // `fill="currentColor"` — tint with a `text-*` class.
    <svg width={(size * MARK.w) / MARK.h} height={size} viewBox={`${MARK.x} ${MARK.y} ${MARK.w} ${MARK.h}`} className={cn('text-white', className)} aria-hidden>
      <g fill="currentColor"><Mark /></g>
    </svg>
  )
}
