// Ported verbatim from mobile `src/features/room3d/engine/furniture.ts` — pure
// three.js geometry/material builders, no RN dependency, no gesture/canvas code.
// Every dimension, position, and color below is load-bearing for room parity —
// do not "simplify" or round any of it.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { C, ROOM_COLORS, DESK_POSITIONS } from './constants'
import { toonMat } from './materials'

// Suppress unused-import warning: ROOM_COLORS is re-exported for consumers
export { ROOM_COLORS, DESK_POSITIONS }

// Light scaling constants (match web values)
const _LP = 4 * Math.PI
const _LD = Math.PI

// ── Types ────────────────────────────────────────────────────────────────────

export interface FloatingObject {
  mesh: THREE.Object3D
  type: string
  baseY?: number
  baseOpacity?: number
  baseIntensity?: number
  charIndex?: number
  posArray?: Float32Array
  geo?: THREE.BufferGeometry
  pCount?: number
}

// ── Furniture builders ────────────────────────────────────────────────────────

export function createWall(roomGroup: THREE.Group, axis: 'x' | 'z', pos: number): void {
  const isZ = axis === 'z'
  const wallGeo = new THREE.BoxGeometry(isZ ? 12 : 0.15, 5, isZ ? 0.15 : 12)
  const wallMat = new THREE.MeshStandardMaterial({ color: isZ ? C.wallZ : C.wallX, roughness: 0.9, metalness: 0.05 })
  const wall = new THREE.Mesh(wallGeo, wallMat)
  if (isZ) { wall.position.set(0, 2.42, pos - 0.075) }
  else { wall.position.set(pos - 0.075, 2.42, 0) }
  wall.receiveShadow = true
  wall.castShadow = true
  wall.matrixAutoUpdate = false
  wall.updateMatrix()
  roomGroup.add(wall)

  const trimGeo = new THREE.BoxGeometry(isZ ? 12.1 : 0.25, 0.2, isZ ? 0.25 : 12.1)
  const trimMat = new THREE.MeshStandardMaterial({ color: C.trim, roughness: 0.7, metalness: 0.2 })
  const trim = new THREE.Mesh(trimGeo, trimMat)
  if (isZ) { trim.position.set(0, 0.02, pos - 0.075) }
  else { trim.position.set(pos - 0.075, 0.02, 0) }
  trim.matrixAutoUpdate = false
  trim.updateMatrix()
  roomGroup.add(trim)
}

export function createMainDesk(roomGroup: THREE.Group, floatingObjects: FloatingObject[]): void {
  const deskGroup = new THREE.Group()
  deskGroup.position.set(0, 0, -5)

  const topGeo = new THREE.BoxGeometry(3.5, 0.12, 1.2)
  const topMat = new THREE.MeshStandardMaterial({ color: C.desk, roughness: 0.6, metalness: 0.3 })
  const top = new THREE.Mesh(topGeo, topMat)
  top.position.y = 0.9
  top.castShadow = true
  top.receiveShadow = true
  deskGroup.add(top)

  const legGeo = new THREE.BoxGeometry(0.1, 0.9, 0.1)
  const legMat = new THREE.MeshStandardMaterial({ color: C.deskLeg, roughness: 0.5, metalness: 0.4 });
  ([ [-1.6, 0.45, -0.5], [1.6, 0.45, -0.5], [-1.6, 0.45, 0.5], [1.6, 0.45, 0.5] ] as [number, number, number][]).forEach(p => {
    const leg = new THREE.Mesh(legGeo, legMat)
    leg.position.set(...p)
    leg.castShadow = true
    deskGroup.add(leg)
  })

  const monGeo = new THREE.BoxGeometry(1.4, 0.9, 0.06)
  const monMat = new THREE.MeshStandardMaterial({ color: C.monitor, roughness: 0.3, metalness: 0.5 })
  const monitor = new THREE.Mesh(monGeo, monMat)
  monitor.position.set(0, 1.5, -0.2)
  monitor.castShadow = true
  deskGroup.add(monitor)

  const screenGeo = new THREE.PlaneGeometry(1.3, 0.8)
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.6 })
  const screen = new THREE.Mesh(screenGeo, screenMat)
  screen.position.set(0, 1.5, -0.165)
  deskGroup.add(screen)
  floatingObjects.push({ mesh: screen, type: 'screenPulse', baseOpacity: 0.6 })

  const standGeo = new THREE.BoxGeometry(0.15, 0.45, 0.15)
  const stand = new THREE.Mesh(standGeo, legMat)
  stand.position.set(0, 1.16, -0.2)
  deskGroup.add(stand)

  roomGroup.add(deskGroup)
}

export function createWorkDesk(pos: THREE.Vector3, accentColor: number, floatingObjects: FloatingObject[]): THREE.Group {
  const dg = new THREE.Group()

  const dTop = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.12, 0.9),
    new THREE.MeshStandardMaterial({ color: C.desk, roughness: 0.6, metalness: 0.3 })
  )
  dTop.position.y = 0.9
  dTop.castShadow = true
  dTop.receiveShadow = true
  dg.add(dTop)

  const dlGeo = new THREE.BoxGeometry(0.08, 0.9, 0.08)
  const dlMat = new THREE.MeshStandardMaterial({ color: C.deskLeg, roughness: 0.5, metalness: 0.4 });
  ([ [-0.9, 0.45, -0.35], [0.9, 0.45, -0.35], [-0.9, 0.45, 0.35], [0.9, 0.45, 0.35] ] as [number, number, number][]).forEach(p => {
    const l = new THREE.Mesh(dlGeo, dlMat)
    l.position.set(...p)
    l.castShadow = true
    dg.add(l)
  })

  const mon = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.65, 0.05),
    new THREE.MeshStandardMaterial({ color: C.monitor, roughness: 0.3, metalness: 0.5 })
  )
  mon.position.set(0, 1.38, -0.15)
  mon.castShadow = true
  dg.add(mon)

  const scrGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.55),
    new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.5 })
  )
  scrGlow.position.set(0, 1.38, -0.12)
  dg.add(scrGlow)
  floatingObjects.push({ mesh: scrGlow, type: 'screenPulse', baseOpacity: 0.5 })

  const stnd = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.35, 0.1),
    dlMat
  )
  stnd.position.set(0, 1.12, -0.15)
  dg.add(stnd)

  const chair = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.07, 0.45),
    new THREE.MeshStandardMaterial({ color: C.deskLeg, roughness: 0.7 })
  )
  chair.position.set(0, 0.35, 0.6)
  chair.castShadow = true
  dg.add(chair)

  const chairBack = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.45, 0.05),
    new THREE.MeshStandardMaterial({ color: C.deskLeg, roughness: 0.7 })
  )
  chairBack.position.set(0, 0.57, 0.8)
  chairBack.castShadow = true
  dg.add(chairBack)

  dg.position.copy(pos)
  dg.lookAt(0, 0, 0)
  dg.rotation.y += Math.PI
  return dg
}

export function createShelf(roomGroup: THREE.Group, x: number, y: number, z: number): void {
  const shelfGeo = new THREE.BoxGeometry(0.12, 0.08, 1.8)
  const shelfMat = new THREE.MeshStandardMaterial({ color: C.deskLeg, roughness: 0.6, metalness: 0.3 })
  const shelf = new THREE.Mesh(shelfGeo, shelfMat)
  shelf.position.set(x, y, z)
  shelf.castShadow = true
  shelf.receiveShadow = true
  roomGroup.add(shelf)

  const bookColors = [0xff2d78, 0x00f0ff, 0xa855f7, 0xffaa44, 0x34d399]
  for (let i = 0; i < 4; i++) {
    const h = 0.25 + Math.random() * 0.15
    const bookGeo = new THREE.BoxGeometry(0.08, h, 0.18 + Math.random() * 0.08)
    // Index is always in [0, bookColors.length) via modulo — safe under noUncheckedIndexedAccess.
    const bookMat = new THREE.MeshStandardMaterial({ color: bookColors[i % bookColors.length]!, roughness: 0.8, metalness: 0.1 })
    const book = new THREE.Mesh(bookGeo, bookMat)
    book.position.set(x + 0.02, y + 0.04 + h / 2, z - 0.6 + i * 0.35)
    book.castShadow = true
    roomGroup.add(book)
  }
}

export function createPedestal(roomGroup: THREE.Group, floatingObjects: FloatingObject[]): void {
  const pedGroup = new THREE.Group()
  pedGroup.position.set(4, 0, -4.5)

  const colGeo = new THREE.CylinderGeometry(0.25, 0.35, 1.2, 6)
  const colMat = new THREE.MeshStandardMaterial({ color: C.pedestal, roughness: 0.5, metalness: 0.4 })
  const col = new THREE.Mesh(colGeo, colMat)
  col.position.y = 0.6
  col.castShadow = true
  pedGroup.add(col)

  const orbGeo = new THREE.IcosahedronGeometry(0.3, 1)
  const orbMat = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.9 })
  const orb = new THREE.Mesh(orbGeo, orbMat)
  orb.position.y = 1.5
  pedGroup.add(orb)
  floatingObjects.push({ mesh: orb, type: 'float', baseY: 1.5 })

  const orbLight = new THREE.PointLight(0xa855f7, 0.8 * _LP, 5, 2)
  orbLight.position.y = 1.5
  pedGroup.add(orbLight)
  floatingObjects.push({ mesh: orbLight, type: 'flickerLight', baseIntensity: 0.8 })

  roomGroup.add(pedGroup)
}

export function createRug(roomGroup: THREE.Group): void {
  const rugGeo = new THREE.CircleGeometry(3, 32)
  const rugMat = new THREE.MeshStandardMaterial({ color: C.rug, roughness: 0.95, transparent: true, opacity: 0.7 })
  const rug = new THREE.Mesh(rugGeo, rugMat)
  rug.rotation.x = -Math.PI / 2
  rug.position.set(0, 0.02, 0)
  rug.receiveShadow = true
  roomGroup.add(rug)

  const rugRingGeo = new THREE.RingGeometry(2.2, 2.5, 32)
  const rugRingMat = new THREE.MeshStandardMaterial({ color: C.rugRing, roughness: 0.9, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  const rugRing = new THREE.Mesh(rugRingGeo, rugRingMat)
  rugRing.rotation.x = -Math.PI / 2
  rugRing.position.set(0, 0.025, 0)
  roomGroup.add(rugRing)
}

export function createNeonStrips(roomGroup: THREE.Group, floatingObjects: FloatingObject[]): void {
  const neonGeo = new THREE.BoxGeometry(8, 0.06, 0.06)
  const neonMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.9 })
  const neon = new THREE.Mesh(neonGeo, neonMat)
  neon.position.set(0, 3.5, -5.9)
  roomGroup.add(neon)
  floatingObjects.push({ mesh: neon, type: 'neonPulse', baseOpacity: 0.9 })

  const neonLight = new THREE.PointLight(0x00f0ff, 0.6 * _LP, 8, 2)
  neonLight.position.set(0, 3.5, -5.5)
  roomGroup.add(neonLight)

  const neon2Geo = new THREE.BoxGeometry(0.06, 0.06, 6)
  const neon2Mat = new THREE.MeshBasicMaterial({ color: 0xff2d78, transparent: true, opacity: 0.7 })
  const neon2 = new THREE.Mesh(neon2Geo, neon2Mat)
  neon2.position.set(-5.9, 2.8, 0)
  roomGroup.add(neon2)
  floatingObjects.push({ mesh: neon2, type: 'neonPulse2', baseOpacity: 0.7 })

  const neon2Light = new THREE.PointLight(0xff2d78, 0.4 * _LP, 6, 2)
  neon2Light.position.set(-5.5, 2.8, 0)
  roomGroup.add(neon2Light)
}

export function createHoloTable(roomGroup: THREE.Group, floatingObjects: FloatingObject[]): void {
  const htGroup = new THREE.Group()
  htGroup.position.set(-3, 0, 1)

  const tableGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.08, 8)
  const tableMat = new THREE.MeshStandardMaterial({ color: C.holoTable, roughness: 0.4, metalness: 0.5 })
  const table = new THREE.Mesh(tableGeo, tableMat)
  table.position.y = 0.7
  table.castShadow = true
  table.receiveShadow = true
  htGroup.add(table)

  const tLegGeo = new THREE.CylinderGeometry(0.12, 0.2, 0.7, 6)
  const tLeg = new THREE.Mesh(tLegGeo, tableMat)
  tLeg.position.y = 0.35
  tLeg.castShadow = true
  htGroup.add(tLeg)

  const holoGeo = new THREE.IcosahedronGeometry(0.4, 0)
  const holoMat = new THREE.MeshBasicMaterial({ color: 0x34d399, wireframe: true, transparent: true, opacity: 0.6 })
  const holo = new THREE.Mesh(holoGeo, holoMat)
  holo.position.y = 1.2
  htGroup.add(holo)
  floatingObjects.push({ mesh: holo, type: 'hologram', baseY: 1.2 })

  const holoLight = new THREE.PointLight(0x34d399, 0.5 * _LP, 4, 2)
  holoLight.position.y = 1.2
  htGroup.add(holoLight)

  roomGroup.add(htGroup)
}

export function createCrates(roomGroup: THREE.Group): void {
  function makeCrate(x: number, y: number, z: number) {
    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5)
    const mat = new THREE.MeshStandardMaterial({ color: C.crate, roughness: 0.85 })
    const crate = new THREE.Mesh(geo, mat)
    crate.position.set(x, y + 0.25, z)
    crate.castShadow = true
    crate.receiveShadow = true
    crate.rotation.y = Math.random() * 0.3
    roomGroup.add(crate)
  }
  makeCrate(4.5, 0, 4)
  makeCrate(4.9, 0, 3.3)
  makeCrate(4.5, 0.55, 4)
}

// ── Room builder ──────────────────────────────────────────────────────────────

export function buildBaseRoom(scene: THREE.Scene, roomGroup: THREE.Group, isDark: boolean): void {
  // isDark is reserved for future theme variants; currently all tiles use the same palette
  void isDark
  void scene
  const gridSize = 12
  const offset = -gridSize / 2 + 0.5

  // Floor checkerboard: 144 tiles → 2 merged meshes (one per color). The grid is
  // fully static, so baking each tile's position into geometry and merging by
  // material drops ~142 draw calls with PIXEL-IDENTICAL output. mergeGeometries
  // copies the source buffers, so the per-tile geometries are disposed after.
  const darkGeos: THREE.BufferGeometry[] = []
  const altGeos: THREE.BufferGeometry[] = []
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      const isDarkTile = (x + z) % 2 === 0
      const geo = new THREE.BoxGeometry(0.96, 0.08, 0.96)
      geo.translate(offset + x, -0.04, offset + z)
      ;(isDarkTile ? darkGeos : altGeos).push(geo)
    }
  }
  const floorMat = new THREE.MeshStandardMaterial({ color: C.floor, roughness: 0.85, metalness: 0.1 })
  const floorAltMat = new THREE.MeshStandardMaterial({ color: C.floorAlt, roughness: 0.85, metalness: 0.1 })
  const darkFloor = new THREE.Mesh(mergeGeometries(darkGeos), floorMat)
  const altFloor = new THREE.Mesh(mergeGeometries(altGeos), floorAltMat)
  for (const m of [darkFloor, altFloor]) {
    m.receiveShadow = true
    // Static merged surface — freeze its matrix so it is skipped every frame.
    m.matrixAutoUpdate = false
    m.updateMatrix()
    roomGroup.add(m)
  }
  darkGeos.forEach((g) => g.dispose())
  altGeos.forEach((g) => g.dispose())

  const baseGeo = new THREE.BoxGeometry(gridSize, 0.15, gridSize)
  const baseMat = new THREE.MeshStandardMaterial({ color: C.base, roughness: 1 })
  const base = new THREE.Mesh(baseGeo, baseMat)
  base.position.y = -0.16
  base.receiveShadow = true
  base.matrixAutoUpdate = false
  base.updateMatrix()
  roomGroup.add(base)

  createWall(roomGroup, 'z', -gridSize / 2)
  createWall(roomGroup, 'x', -gridSize / 2)
}

export function addLighting(scene: THREE.Scene, isDark: boolean): void {
  // Ambient + hemisphere + directional match web values (full 5-light fill rig).
  scene.add(new THREE.AmbientLight(0x1a1025, (isDark ? 0.6 : 1.0) * _LD))
  scene.add(new THREE.HemisphereLight(0x2a2040, 0x0a0a15, (isDark ? 0.4 : 0.7) * _LD))

  // Directional key light with soft shadows (web parity, Scene.tsx:473-485).
  // Desktop renderer enables shadowMap globally (unlike the mobile GL fallback,
  // which disabled shadows entirely for WebGL1 perf) — see engine.ts.
  const dir = new THREE.DirectionalLight(isDark ? 0xffeedd : 0xffffff, (isDark ? 0.8 : 1.2) * _LD)
  dir.position.set(8, 16, 6)
  dir.castShadow = true
  dir.shadow.mapSize.set(2048, 2048)
  dir.shadow.camera.left = -12
  dir.shadow.camera.right = 12
  dir.shadow.camera.top = 12
  dir.shadow.camera.bottom = -12
  dir.shadow.camera.near = 1
  dir.shadow.camera.far = 40
  dir.shadow.bias = -0.0002
  dir.shadow.normalBias = 0.02
  scene.add(dir)

  // Decorative fill point lights — full set of 5 (match web).
  // The object-anchored neon point lights (pedestal/neon strips/holo) remain.
  ;(
    [
      { color: 0x00f0ff, pos: [-4, 3, -4] as [number, number, number], intensity: 0.8 * _LP },
      { color: 0xff2d78, pos: [4, 2.5, -3] as [number, number, number], intensity: 0.6 * _LP },
      { color: 0xa855f7, pos: [-3, 2, 4] as [number, number, number], intensity: 0.5 * _LP },
      { color: 0x34d399, pos: [3, 3, 3] as [number, number, number], intensity: 0.4 * _LP },
      { color: 0xffaa44, pos: [0, 5, 0] as [number, number, number], intensity: 0.3 * _LP },
    ] as { color: number; pos: [number, number, number]; intensity: number }[]
  ).forEach(cfg => {
    const light = new THREE.PointLight(cfg.color, cfg.intensity, 15, 2)
    light.position.set(...cfg.pos)
    scene.add(light)
  })
}

// Re-export toonMat so engine consumers can access it from a single import
export { toonMat }
