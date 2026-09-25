/**
 * The ClawMuse mark — a claw catching a spark — as data, so the in-app logo
 * (renderer) and the share card (drawn by main) are the same drawing as the
 * app icon (resources/glyph.svg). Coordinates are the icon's 1024 canvas.
 */

export const BRAND_CORAL = '#FF5A4E'
export const BRAND_CANVAS = 1024
/** The macOS/iOS icon corner radius. */
export const BRAND_CORNER = 0.2237 * BRAND_CANVAS
/** The mark's bounding box in the 1024 canvas (measured from the rendered glyph). */
export const BRAND_MARK_BOX = { x: 322, y: 174, w: 478, h: 637 }

export const BRAND_MARK = {
  outer: 'translate(512 512) scale(0.86) translate(-512 -512) translate(34 -14)',
  claw: 'rotate(32 512 560)',
  jaws: [
    'M352 736 C 318 500 356 292 492 140 C 452 280 456 440 530 626 Z',
    'M512 642 C 616 482 618 330 566 196 C 682 288 712 460 672 668 Z',
  ],
  palm: { cx: 516, cy: 728, rx: 170, ry: 168 },
  spark: 'M742 132 C 748 186 760 198 814 204 C 760 210 748 222 742 276 C 736 222 724 210 670 204 C 724 198 736 186 742 132 Z',
} as const

/** The app-icon badge (coral rounded square, white mark) as standalone SVG markup. */
export function brandBadgeSvg(size: number): string {
  const { outer, claw, jaws, palm, spark } = BRAND_MARK
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${BRAND_CANVAS} ${BRAND_CANVAS}" aria-hidden="true">`
    + `<rect width="${BRAND_CANVAS}" height="${BRAND_CANVAS}" rx="${BRAND_CORNER}" ry="${BRAND_CORNER}" fill="${BRAND_CORAL}"/>`
    + `<g fill="#ffffff"><g transform="${outer}"><g transform="${claw}">${jaws.map((d) => `<path d="${d}"/>`).join('')}`
    + `<ellipse cx="${palm.cx}" cy="${palm.cy}" rx="${palm.rx}" ry="${palm.ry}"/></g><path d="${spark}"/></g></g></svg>`
}
