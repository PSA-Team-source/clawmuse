/**
 * The ClawMuse mark — a claw-shaped C (its two round ends are the pincer tips)
 * holding a spark — as data, so the in-app logo (renderer), the share card
 * (drawn by main) and the app icon (resources/icon.svg, glyph.svg) are one
 * drawing. Coordinates are the icon's 1024 canvas; both shapes are filled paths
 * so any surface can tint them.
 */

export const BRAND_CORAL = '#FF5A4E'
/** The logo: a pure red mark on white. */
export const BRAND_RED = '#FF0000'
export const BRAND_ICON_BG = '#FFFFFF'
export const BRAND_CANVAS = 1024
/** The macOS/iOS icon corner radius. */
export const BRAND_CORNER = 0.2237 * BRAND_CANVAS
/** The mark's bounding box in the 1024 canvas. */
export const BRAND_MARK_BOX = { x: 228, y: 260, w: 569, h: 504 }

export const BRAND_MARK = {
  claw: 'M673.4 350.0A252 252 0 1 0 673.4 674.0A56 56 0 0 0 587.6 602.0A140 140 0 1 1 587.6 422.0A56 56 0 0 0 673.4 350.0Z',
  spark: 'M712.4 428.0C724.2 500.2 724.2 500.2 796.4 512.0C724.2 523.8 724.2 523.8 712.4 596.0C700.6 523.8 700.6 523.8 628.4 512.0C700.6 500.2 700.6 500.2 712.4 428.0Z',
} as const

/** The app-icon badge (white rounded square, red mark) as standalone SVG markup. */
export function brandBadgeSvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${BRAND_CANVAS} ${BRAND_CANVAS}" aria-hidden="true">`
    + `<rect width="${BRAND_CANVAS}" height="${BRAND_CANVAS}" rx="${BRAND_CORNER}" ry="${BRAND_CORNER}" fill="${BRAND_ICON_BG}"/>`
    + `<g fill="${BRAND_RED}"><path d="${BRAND_MARK.claw}"/><path d="${BRAND_MARK.spark}"/></g></svg>`
}
