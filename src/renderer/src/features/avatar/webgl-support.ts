/**
 * Whether this machine can draw the 3D avatar at all. Checked once: a blocked
 * GPU (remote desktop, a GPU blocklist, `--disable-gpu`) does not come back
 * mid-session, and every avatar surface falls back to the logo badge instead.
 */
let cached: boolean | null = null

export function hasWebGL(): boolean {
  if (cached !== null) return cached
  try {
    if (typeof document === 'undefined') return (cached = false)
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    cached = !!gl
    // Give the probe context back right away — contexts are capped.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    cached = false
  }
  return cached
}

/** Test hook: forget the cached probe. */
export function resetWebGLProbe(): void {
  cached = null
}
