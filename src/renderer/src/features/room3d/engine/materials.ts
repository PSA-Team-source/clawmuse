// Ported verbatim from mobile `src/features/room3d/engine/materials.ts` — pure
// three.js + string hashing, no RN dependency.
import * as THREE from 'three'

export function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return Math.abs(h)
}

export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16) || 0x00f0ff
}

export function toonMat(color: number, emissive = 0x000000, emissiveI = 0) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0.05, flatShading: true, emissive, emissiveIntensity: emissiveI,
  })
}
