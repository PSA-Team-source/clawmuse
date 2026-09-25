import { cn } from '@/lib/cn'
import { BRAND_CANVAS as CANVAS, BRAND_CORNER as CORNER, BRAND_ICON_BG, BRAND_RED, BRAND_MARK, BRAND_MARK_BOX as MARK } from '@shared/brand'

/**
 * The ClawMuse mark — a claw-shaped C holding a spark — drawn from the same geometry
 * as the app icon (resources/glyph.svg), so every in-app logo matches the Dock.
 * The geometry lives in @shared/brand so the share card draws the same mark;
 * `glyph` crops to the mark itself.
 */

function Mark() {
  return (
    <>
      <path d={BRAND_MARK.claw} />
      <path d={BRAND_MARK.spark} />
    </>
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
        <rect width={CANVAS} height={CANVAS} rx={CORNER} ry={CORNER} fill={BRAND_ICON_BG} />
        <g fill={BRAND_RED}><Mark /></g>
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
