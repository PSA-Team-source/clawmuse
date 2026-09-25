/**
 * engine.ts — desktop WebGL renderer + render loop + raycast + camera control + dispose
 *
 * Ported from mobile `src/features/room3d/engine/engine.ts` (itself ported from
 * the web Scene.tsx animation loop). Desktop-specific changes vs. the mobile expo-gl engine:
 *
 *   - Real `HTMLCanvasElement` + `THREE.WebGLRenderer({ canvas, antialias: true,
 *     alpha: false })`. The mobile version had to fake a `canvas` object because
 *     three reaches for `document.createElement('canvas')` on React Native (no
 *     DOM) — Electron's renderer is a real browser, so that shim is gone.
 *   - No `gl.endFrameEXP()` — that call only exists to flush expo-gl's offscreen
 *     framebuffer to the native view; a real `WebGLRenderer` presents to its
 *     canvas automatically inside `.render()`.
 *   - Shadow map ON (`renderer.shadowMap.enabled = true`, `PCFSoftShadowMap`) —
 *     the mobile GL engine disabled shadows for WebGL1 perf headroom, but
 *     desktop GPUs don't need that tradeoff, and the mobile WebGPU renderer
 *     already ships shadows at this quality (see mobile `gpu/makeWebGPURenderer.ts`).
 *     Directional-light shadow config + castShadow/receiveShadow flags already
 *     exist unmodified in furniture.ts/character.ts; enabling it here is what
 *     makes them actually render.
 *   - `toneMappingExposure = 3.1` — the mobile WebGPU renderer's tuned value
 *     (brighter), not the GL fallback's 1.45.
 *   - Orthographic camera applies `VIEW_SHIFT_RATIO = 0.22` (top/bottom frustum
 *     shift), matching the mobile WebGPU renderer's framing so the room reads
 *     centered instead of hugging the top of the viewport.
 *   - `setPixelRatio(Math.min(window.devicePixelRatio, 2))` for Retina/HiDPI.
 *   - `hitTestAt` is a desktop-only addition (see RoomEngine below) for mouse
 *     hover — touch has no hover state, so mobile never needed this.
 *
 * Every `Math.sin`/`Math.cos` coefficient in the animation loop below is
 * copied VERBATIM from the mobile GL engine — this is a parity requirement,
 * not a style choice: changing a single coefficient makes the room animate
 * differently from the mobile app.
 */

import * as THREE from 'three'
import {
  buildBaseRoom,
  addLighting,
  createMainDesk,
  createShelf,
  createPedestal,
  createRug,
  createNeonStrips,
  createHoloTable,
  createCrates,
  type FloatingObject,
} from './furniture'
import { computeOfficeLayout, buildAllCharacters, SHARED_RESOURCES } from './character'
import type { CharacterData } from './types'

// ── Global: match mobile engine.ts / web Scene.tsx ───────────────────────────
THREE.ColorManagement.enabled = false

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const BASE_FRUSTUM = 11
const _LP = 4 * Math.PI
// Lowers the room on screen (top/bottom frustum shift) so it reads centred
// instead of hugging the top — matches the mobile WebGPU renderer's framing
// (mobile gpu/RoomCanvasGPU.tsx + gpu/useCameraControls.ts).
const VIEW_SHIFT_RATIO = 0.22

// Hoisted unit vector — avoids per-frame Vector3 allocation in ring scale lerp
const _V_ONE = new THREE.Vector3(1, 1, 1)

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface CreateEngineOpts {
  canvas: HTMLCanvasElement
  width: number
  height: number
  charData: CharacterData[]
  onSelect?: (skillIndex: number) => void
  /** Called once per rendered frame (after render) with the freshly-projected
   *  character anchors, so consumers can update the label overlay from the
   *  SAME rAF loop instead of running a second one (two rAF loops contend for
   *  the main-thread budget — research-confirmed harmful on the mobile source). */
  onFrame?: (anchors: { skillIndex: number; xPx: number; yPx: number; visible: boolean }[]) => void
}

export interface RoomEngine {
  resize(w: number, h: number): void
  setCharacters(charData: CharacterData[]): void
  raycastAt(xPx: number, yPx: number): number | null
  /** Hover hit-test — identical raycast to `raycastAt` but does NOT fire
   *  `onSelect`. Desktop-only addition: mouse hover (cursor → 'pointer' over a
   *  character) has no equivalent in the mobile touch-gesture source. */
  hitTestAt(xPx: number, yPx: number): number | null
  panBy(dxPx: number, dyPx: number): void
  zoomBy(factor: number): void
  projectAnchors(): { skillIndex: number; xPx: number; yPx: number; visible: boolean }[]
  setPaused(p: boolean): void
  /**
   * @param releaseContext Whether to hand the canvas's WebGL context back to
   *   the GPU. Pass `false` when another engine is about to be built on the
   *   SAME `<canvas>` element — see the implementation for why that matters.
   */
  dispose(releaseContext?: boolean): void
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createEngine(opts: CreateEngineOpts): RoomEngine {
  const { canvas, onSelect, onFrame } = opts
  let width = opts.width
  let height = opts.height
  let paused = false
  let raf = 0
  let frustum = BASE_FRUSTUM
  let _infoLogged = false

  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // updateStyle=false — the canvas's CSS box is owned by its flex/ResizeObserver
  // parent (RoomCanvas.tsx), not by three; letting three also write canvas.style
  // would fight that layout on every resize tick.
  renderer.setSize(width, height, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 3.1
  renderer.outputColorSpace = THREE.SRGBColorSpace

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene()
  const bgColor = 0x08080f
  scene.background = new THREE.Color(bgColor)
  scene.fog = new THREE.FogExp2(bgColor, 0.02)

  // ── Clock ─────────────────────────────────────────────────────────────────
  const clock = new THREE.Clock()

  // ── Camera (orthographic iso, web Scene.tsx:955-961 + VIEW_SHIFT_RATIO) ────
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  camera.position.set(15, 15, 15)
  camera.lookAt(0, 0, 0)
  camera.zoom = 1

  // ── Room ──────────────────────────────────────────────────────────────────
  const roomGroup = new THREE.Group()
  scene.add(roomGroup)
  const floatingObjects: FloatingObject[] = []
  buildBaseRoom(scene, roomGroup, true)
  addLighting(scene, true)

  // ── Furniture (web Scene.tsx:966–983) ─────────────────────────────────────
  createMainDesk(roomGroup, floatingObjects)
  createShelf(roomGroup, -5.5, 2.5, -3)
  createShelf(roomGroup, -5.5, 3.2, -1)
  createPedestal(roomGroup, floatingObjects)
  createRug(roomGroup)
  createNeonStrips(roomGroup, floatingObjects)
  createHoloTable(roomGroup, floatingObjects)
  createCrates(roomGroup)

  // ── Ambient particle system (web Scene.tsx:988–1009) ──────────────────────
  // 150 points scattered in a 14×6×14 box; drift upward, wrap at y=6.
  const PARTICLE_COUNT = 150
  const pPos = new Float32Array(PARTICLE_COUNT * 3)
  const pVel: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    pPos[i * 3] = (Math.random() - 0.5) * 14
    pPos[i * 3 + 1] = Math.random() * 6
    pPos[i * 3 + 2] = (Math.random() - 0.5) * 14
    pVel.push({
      x: (Math.random() - 0.5) * 0.003,
      y: (Math.random() - 0.5) * 0.002 + 0.002,
      z: (Math.random() - 0.5) * 0.003,
    })
  }
  const pGeo = new THREE.BufferGeometry()
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  const pPoints = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.04,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  scene.add(pPoints)

  // ── Processing light pool ───────────────────────────────────────────────────
  // A small FIXED pool of point lights, shared across all processing characters,
  // replaces a per-character PointLight. Each extra point light is a per-pixel
  // loop in three's forward shader, so binding light count to the roster size
  // would make the scene linearly more expensive with every agent. The pool
  // keeps the dynamic-light count constant (base lights + PROC_LIGHT_POOL).
  // Lights stay permanently in the scene at intensity 0 when idle — toggling
  // visibility would change the light count and force a shader recompile
  // (hitch), so only intensity is animated. Added to the scene (not charGroup)
  // so they survive character rebuilds.
  const PROC_LIGHT_POOL = 4
  const procLights: THREE.PointLight[] = []
  for (let i = 0; i < PROC_LIGHT_POOL; i++) {
    const L = new THREE.PointLight(0xffffff, 0, 5, 2)
    scene.add(L)
    procLights.push(L)
  }

  // Capture how many floatingObjects the room build produced so that
  // setCharacters rebuilds only drop character-produced entries.
  const roomFOCount = floatingObjects.length

  // ── Characters ────────────────────────────────────────────────────────────
  let charGroup = new THREE.Group()
  scene.add(charGroup)
  let characters: THREE.Group[] = []
  let selectionRings: THREE.Mesh[] = []
  let characterGroups: THREE.Group[] = []
  let charIsProcessing: boolean[] = []
  let lastRosterSig = ''

  // Signature of everything that affects the BUILT meshes (roster, body style,
  // accent, and whether a status ring is shown). Excludes isProcessing — that is
  // a per-frame dynamic state handled by charIsProcessing without a rebuild.
  function rosterSig(data: CharacterData[]): string {
    return data
      .map((d) => `${d.name}:${d.style}:${d.accent}:${(d.taskCount ?? 0) > 0 ? 1 : 0}`)
      .join('|')
  }

  function buildChars(data: CharacterData[]): void {
    // Dispose and remove orphaned selection rings (added to scene directly, not to charGroup)
    for (const ring of selectionRings) {
      scene.remove(ring)
      ring.geometry.dispose()
      ;(ring.material as THREE.Material).dispose()
    }
    selectionRings = []

    // Remove previous charGroup and dispose its children. Shared singletons
    // (SHARED_RESOURCES) are skipped — they are reused by future rebuilds.
    if (charGroup.parent) {
      scene.remove(charGroup)
      charGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry && !SHARED_RESOURCES.has(mesh.geometry)) mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => { if (!SHARED_RESOURCES.has(m)) m.dispose() })
        } else if (mesh.material && !SHARED_RESOURCES.has(mesh.material)) {
          (mesh.material as THREE.Material).dispose()
        }
      })
    }

    // Truncate only the character-produced floatingObjects (indices ≥ roomFOCount);
    // room furniture animations (neon, holo, pedestal, main desk) survive rebuilds.
    floatingObjects.length = roomFOCount

    charGroup = new THREE.Group()
    scene.add(charGroup)

    charIsProcessing = data.map((c) => !!c.isProcessing)

    if (data.length === 0) {
      characters = []
      selectionRings = []
      characterGroups = []
      return
    }

    const layout = computeOfficeLayout(data)
    const res = buildAllCharacters(scene, charGroup, data, layout, floatingObjects)
    characters = res.characters
    selectionRings = res.selectionRings
    characterGroups = res.characterGroups
  }

  buildChars(opts.charData)
  lastRosterSig = rosterSig(opts.charData)

  // ── Raycasting ────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()

  // ── updateCam ─────────────────────────────────────────────────────────────
  function updateCam(): void {
    const a = width / height || 1
    const shiftY = frustum * VIEW_SHIFT_RATIO
    camera.left = -frustum * a
    camera.right = frustum * a
    camera.top = frustum + shiftY
    camera.bottom = -frustum + shiftY
    camera.updateProjectionMatrix()
  }
  updateCam()

  // Project each character's head anchor to screen pixels for the label
  // overlay. Shared by the public method and the per-frame onFrame.
  const _projV = new THREE.Vector3()
  // Reused across frames to avoid allocating a fresh array + object literals on
  // every rendered frame (this runs in the rAF loop via onFrame → GC churn that
  // shows up as periodic micro-stutter). The returned array and its entries are
  // SHARED/mutated — consumers must read them synchronously (RoomCanvas does).
  type Anchor = { skillIndex: number; xPx: number; yPx: number; visible: boolean }
  const _anchorScratch: Anchor[] = []
  const _anchorPool: Anchor[] = []
  function projectAnchorsInternal(): Anchor[] {
    _anchorScratch.length = 0
    for (let i = 0; i < characterGroups.length; i++) {
      const g = characterGroups[i]!
      const anchorY = (g.userData.anchorY as number) ?? 2.2
      _projV.set(0, anchorY, 0)
      g.localToWorld(_projV)
      _projV.project(camera)
      let a = _anchorPool[i]
      if (!a) {
        a = { skillIndex: 0, xPx: 0, yPx: 0, visible: false }
        _anchorPool[i] = a
      }
      a.skillIndex = g.userData.skillIndex as number
      a.xPx = (_projV.x * 0.5 + 0.5) * width
      a.yPx = (-_projV.y * 0.5 + 0.5) * height
      a.visible = _projV.z < 1
      _anchorScratch.push(a)
    }
    return _anchorScratch
  }

  // Shared by raycastAt (selects on hit) and hitTestAt (peek-only, for hover).
  function hitTestInternal(xPx: number, yPx: number): number | null {
    ndc.set((xPx / width) * 2 - 1, -(yPx / height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(characterGroups, true)
    if (!hits.length) return null

    // Walk up parent chain to find the group tagged with skillIndex
    let o: THREE.Object3D | null = hits[0]!.object
    while (o && o.userData.skillIndex === undefined) {
      o = o.parent
    }
    return o !== null && o.userData.skillIndex !== undefined ? (o.userData.skillIndex as number) : null
  }

  // ── Animation Loop (ported from web Scene.tsx:1047–1229) ─────────────────
  function loop(): void {
    raf = requestAnimationFrame(loop)

    if (paused) return

    const time = clock.getElapsedTime()

    // ── Character idle animations (web Scene.tsx:1052–1114) ─────────────────
    characters.forEach((char, i) => {
      const ud = char.userData
      const sitting = ud.isSitting as boolean | undefined
      const speed = 1.0

      if (sitting) {
        if (ud.bodyGroup) {
          (ud.bodyGroup as THREE.Group).position.y = Math.sin(time * 1.2 + i * 1.5) * 0.01
        }
        if (ud.headGroup) {
          (ud.headGroup as THREE.Group).rotation.y = Math.sin(time * 0.5 + i * 2) * 0.05
          ;(ud.headGroup as THREE.Group).rotation.x = Math.sin(time * 0.8 + i) * 0.03 - 0.1
        }
        if (ud.leftArm) {
          (ud.leftArm as THREE.Group).rotation.x = -0.5 + Math.sin(time * 4 + i) * 0.08
        }
        if (ud.rightArm) {
          (ud.rightArm as THREE.Group).rotation.x = -0.5 + Math.sin(time * 4 + i + 1.5) * 0.08
        }
        if (ud.leftLeg) {
          (ud.leftLeg as THREE.Group).rotation.x = -0.8
        }
        if (ud.rightLeg) {
          (ud.rightLeg as THREE.Group).rotation.x = -0.8
        }
      } else {
        if (ud.bodyGroup) {
          (ud.bodyGroup as THREE.Group).position.y = Math.sin(time * 1.8 + i * 1.5) * 0.03
        }
        if (ud.headGroup) {
          (ud.headGroup as THREE.Group).rotation.y = Math.sin(time * 0.7 + i * 2) * 0.1
          ;(ud.headGroup as THREE.Group).rotation.x = Math.sin(time * 0.5 + i * 1.3) * 0.05
        }
        if (ud.leftArm) {
          (ud.leftArm as THREE.Group).rotation.x = Math.sin(time * speed + i) * 0.1
        }
        if (ud.rightArm) {
          (ud.rightArm as THREE.Group).rotation.x = Math.sin(time * speed + i + Math.PI) * 0.1
        }
        if (ud.leftLeg) {
          (ud.leftLeg as THREE.Group).rotation.x = Math.sin(time * speed * 0.8 + i) * 0.05
        }
        if (ud.rightLeg) {
          (ud.rightLeg as THREE.Group).rotation.x =
            Math.sin(time * speed * 0.8 + i + Math.PI) * 0.05
        }
      }

      // Selection ring pulse (web Scene.tsx:1102–1109)
      const ring = selectionRings[i]
      if (ring) {
        const mat = ring.material as THREE.MeshBasicMaterial
        mat.opacity += (0 - mat.opacity) * 0.1
        ring.rotation.z = time * 0.5
        ring.scale.lerp(_V_ONE, 0.1)
      }
    })

    // ── Floating objects animation (web Scene.tsx:1122–1209) ─────────────────
    floatingObjects.forEach((obj) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous mesh/light union keyed by obj.type; matches mobile source
      const mesh = obj.mesh as any
      switch (obj.type) {
        case 'float':
          mesh.position.y = obj.baseY! + Math.sin(time * 2) * 0.15
          mesh.rotation.y = time * 0.8
          mesh.rotation.x = time * 0.3
          break
        case 'flickerLight':
          mesh.intensity =
            obj.baseIntensity! + Math.sin(time * 4) * 0.2 + Math.sin(time * 7.3) * 0.1
          break
        case 'screenPulse':
          mesh.material.opacity = obj.baseOpacity! + Math.sin(time * 1.5) * 0.15
          break
        case 'neonPulse':
          mesh.material.opacity = obj.baseOpacity! + Math.sin(time * 2) * 0.1
          break
        case 'neonPulse2':
          mesh.material.opacity = obj.baseOpacity! + Math.sin(time * 2.3 + 1) * 0.1
          break
        case 'hologram':
          mesh.rotation.y = time * 1.2
          mesh.rotation.x = time * 0.4
          mesh.position.y = obj.baseY! + Math.sin(time * 1.5) * 0.1
          break
        case 'crystalSpin':
          mesh.rotation.y = time * 2
          mesh.rotation.x = time * 1.2
          break
        case 'healRing':
          mesh.rotation.z = time * 1.5
          mesh.material.opacity = 0.4 + Math.sin(time * 2) * 0.2
          break
        case 'healRing2':
          mesh.rotation.z = -time * 2
          mesh.material.opacity = 0.3 + Math.sin(time * 2.5) * 0.15
          break
        case 'statusRing':
          mesh.material.opacity = 0.3 + Math.sin(time * 1.2) * 0.15
          mesh.rotation.z = time * 0.3
          break
        case 'processingGlow': {
          const on = charIsProcessing[obj.charIndex ?? -1] ?? false
          const tgt = on ? 0.5 + Math.sin(time * 4) * 0.35 : 0
          mesh.material.opacity += (tgt - mesh.material.opacity) * 0.08
          if (mesh.material.opacity > 0.01) {
            mesh.scale.setScalar(0.7 + Math.sin(time * 3) * 0.5)
            mesh.rotation.y = time * 2
            mesh.rotation.x = time * 0.7
          }
          break
        }
        case 'processingRing': {
          const on = charIsProcessing[obj.charIndex ?? -1] ?? false
          const tgt = on ? 0.35 + Math.sin(time * 3) * 0.2 : 0
          mesh.material.opacity += (tgt - mesh.material.opacity) * 0.06
          if (mesh.material.opacity > 0.01) {
            mesh.rotation.z = time * 2
            const s = 1 + Math.sin(time * 2) * 0.3
            mesh.scale.set(s, s, 1)
          }
          break
        }
        case 'processingParticles': {
          const on = charIsProcessing[obj.charIndex ?? -1] ?? false
          const tgt = on ? 0.7 : 0
          mesh.material.opacity += (tgt - mesh.material.opacity) * 0.06
          if (mesh.material.opacity > 0.01 && obj.posArray && obj.geo) {
            for (let p = 0; p < obj.pCount!; p++) {
              const angle = (p / obj.pCount!) * Math.PI * 2 + time * 2.5
              const r = 0.3 + Math.sin(time * 1.5 + p * 0.5) * 0.15
              const yOff = (p / obj.pCount!) * 0.8 + Math.sin(time * 3 + p) * 0.1
              obj.posArray[p * 3] = Math.cos(angle) * r
              obj.posArray[p * 3 + 1] = obj.baseY! + yOff
              obj.posArray[p * 3 + 2] = Math.sin(angle) * r
            }
            obj.geo.attributes.position!.needsUpdate = true
          }
          break
        }
      }
    })

    // ── Processing light pool driver ──────────────────────────────────────────
    // Assign pool lights to the characters currently processing (up to
    // PROC_LIGHT_POOL simultaneously), reproducing the old per-character
    // 'processingLight' pulse; fade any unused pool light back to zero.
    let _slot = 0
    for (let i = 0; i < characterGroups.length && _slot < procLights.length; i++) {
      if (!charIsProcessing[i]) continue
      const g = characterGroups[i]!
      const L = procLights[_slot++]!
      L.position.set(g.position.x, (g.userData.procBaseY as number) ?? 2.2, g.position.z)
      L.color.set((g.userData.accentColor as number) ?? 0x00f0ff)
      const tgt = (0.5 + Math.sin(time * 4) * 0.3) * _LP
      L.intensity += (tgt - L.intensity) * 0.08
    }
    for (; _slot < procLights.length; _slot++) {
      const L = procLights[_slot]!
      L.intensity += (0 - L.intensity) * 0.08
    }

    // ── Ambient particle drift (web Scene.tsx:1212–1227) ─────────────────────
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const v = pVel[i]!
      pPos[i * 3]! += v.x
      pPos[i * 3 + 1]! += v.y
      pPos[i * 3 + 2]! += v.z

      // Wrap: reset to floor when particle drifts above ceiling
      if (pPos[i * 3 + 1]! > 6) {
        pPos[i * 3] = (Math.random() - 0.5) * 14
        pPos[i * 3 + 1] = 0
        pPos[i * 3 + 2] = (Math.random() - 0.5) * 14
      }

      // Subtle sinusoidal sway
      pPos[i * 3]! += Math.sin(time * 0.5 + i) * 0.001
      pPos[i * 3 + 2]! += Math.cos(time * 0.4 + i) * 0.001
    }
    pGeo.attributes.position!.needsUpdate = true

    renderer.render(scene, camera)

    // Dev-only: log the post-optimization draw-call / triangle / light counts once
    // so the Measure→Optimize→Re-measure loop has a number to compare against.
    if (!_infoLogged && import.meta.env.DEV) {
      _infoLogged = true
      const info = renderer.info.render
      console.log(
        `[room3d] draw calls: ${info.calls} · triangles: ${info.triangles} · point lights: ${procLights.length} pooled`,
      )
    }

    // Drive the label overlay from this single rAF loop (running a second rAF
    // competes for the main-thread budget — research-confirmed harmful on the
    // mobile source; kept identical here).
    if (onFrame) onFrame(projectAnchorsInternal())
  }

  loop()

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    resize(w: number, h: number): void {
      width = w
      height = h
      renderer.setSize(width, height, false)
      updateCam()
    },

    setCharacters(charData: CharacterData[]): void {
      // Only rebuild meshes when the roster actually changes. taskCount badges
      // (label overlay) and isProcessing glow are dynamic state — updating them
      // must NOT dispose+recreate every character, which would cause visible
      // flicker (the "agents disappear" frame) and GC/GL churn on every chat
      // delta / task poll.
      const sig = rosterSig(charData)
      if (sig === lastRosterSig) {
        charIsProcessing = charData.map((c) => !!c.isProcessing)
        return
      }
      lastRosterSig = sig
      buildChars(charData)
    },

    raycastAt(xPx: number, yPx: number): number | null {
      const idx = hitTestInternal(xPx, yPx)
      if (idx !== null) onSelect?.(idx)
      return idx
    },

    hitTestAt(xPx: number, yPx: number): number | null {
      return hitTestInternal(xPx, yPx)
    },

    panBy(dxPx: number, dyPx: number): void {
      // Pan camera in world space proportional to pixel delta
      camera.position.x -= dxPx * 0.02
      camera.position.z += dyPx * 0.02
      camera.lookAt(0, 0, 0)
    },

    zoomBy(factor: number): void {
      // Clamp frustum so zoom stays within MIN_ZOOM..MAX_ZOOM of base
      const minFrustum = BASE_FRUSTUM / MAX_ZOOM
      const maxFrustum = BASE_FRUSTUM / MIN_ZOOM
      frustum = Math.min(Math.max(frustum / factor, minFrustum), maxFrustum)
      updateCam()
    },

    projectAnchors() {
      return projectAnchorsInternal()
    },

    setPaused(p: boolean): void {
      paused = p
    },

    dispose(releaseContext = true): void {
      cancelAnimationFrame(raf)
      // Skip shared singletons: their CPU buffers are reused by the next engine
      // instance and a fresh renderer simply re-uploads them. Disposing them
      // here would blank the next room.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry && !SHARED_RESOURCES.has(mesh.geometry)) mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => { if (!SHARED_RESOURCES.has(m)) m.dispose() })
        } else if (mesh.material && !SHARED_RESOURCES.has(mesh.material)) {
          (mesh.material as THREE.Material).dispose()
        }
      })
      renderer.dispose()
      // Explicitly release the real WebGL context — desktop owns the canvas
      // element for the lifetime of the route, so without this a rapid
      // mount/unmount cycle (switching rooms/modes) would leak GL contexts.
      // expo-gl's context on mobile is owned by the native module and doesn't
      // have (or need) an equivalent call.
      //
      // But this is permanent for the canvas ELEMENT, not just this renderer:
      // once forced, every later `getContext()` on the same canvas returns a
      // context whose `isContextLost()` is true, and three's WebGLCapabilities
      // then reads `null` out of `getShaderPrecisionFormat()` and throws. So it
      // must not run when the engine is being rebuilt onto the same canvas —
      // that would leave the room permanently black.
      if (releaseContext) renderer.forceContextLoss()
    },
  }
}
