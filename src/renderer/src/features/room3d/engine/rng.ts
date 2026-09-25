/**
 * Seeded randomness for anything that must look the same on every build.
 *
 * `Math.random` in a mesh builder means the same character renders differently
 * every time the roster rebuilds — and an exported avatar would not match the
 * one on screen. Builders take a `rand()` from here instead.
 */

/** The room's string hash (moved here from materials.ts so it is three-free). */
export function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return Math.abs(h)
}

/** mulberry32 — tiny, fast, well-distributed 32-bit PRNG. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable 32-bit seed from a string or number seed. */
export function seedOf(seed: string | number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.abs(Math.floor(seed)) >>> 0
  return hashStr(String(seed)) >>> 0
}

/** One deterministic value in [0, 1) for (seed, index) — no generator state. */
export function hash01(seed: number, index: number): number {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
