/**
 * Material surfaces.
 *
 * Named for thickness rather than for a role, so a screen picks the one that
 * matches how far the surface floats — not the one whose name happens to
 * mention the component it was first written for.
 */
export type Material = 'thin' | 'regular' | 'thick'

const CLASS: Record<Material, string> = {
  thin: 'material-thin',
  regular: 'material-regular',
  thick: 'material-thick',
}

/** Default corner per material — thicker surfaces are larger, and read better rounder. */
const RADIUS: Record<Material, string> = {
  thin: 'rounded-full',
  regular: 'rounded-box',
  thick: 'rounded-box',
}

export function materialClass(material: Material, withRadius = true): string {
  return withRadius ? `${CLASS[material]} ${RADIUS[material]}` : CLASS[material]
}
