// Ported verbatim from mobile `src/features/room3d/engine/character.ts` — pure
// three.js character/layout builders. Only two changes vs. mobile:
//  1. `CharacterData` is imported from the local `./types` (mobile pulled it
//     from `@/types/room.types`, which does not exist on desktop).
//  2. Non-null assertions (`!`) added at bounds-checked array indices — the
//     desktop tsconfig enables `noUncheckedIndexedAccess`, which mobile's
//     tsconfig does not. Every assertion sites an index that is provably
//     in range (loop counter < array length); no runtime behavior changes.
//
// Desktop additions since the port: the `muse` body style (ClawMuse's mascot —
// claw mitts and a floating spark), seeded striker spikes (were Math.random,
// so a rebuild reshuffled them), and rig handles on `userData` for the face
// (eyes, pupils, mouth), hands, claws and spark that the avatar engine drives.
import * as THREE from 'three'
import { DESK_POSITIONS, IDLE_POSITIONS } from './constants'
import { hashStr, toonMat } from './materials'
import { mulberry32 } from './rng'
import { createWorkDesk } from './furniture'
import type { FloatingObject } from './furniture'
import type { CharacterData } from './types'

// Light scaling constant (matches furniture.ts)
const _LP = 4 * Math.PI

// ── Shared character resources ──────────────────────────────────────────────
// Geometry/materials that are IDENTICAL for every character (color-independent,
// fixed dimensions). Hoisting them to module scope avoids re-allocating the same
// objects per character on every roster rebuild, cuts memory, and lets three
// batch meshes that share a material reference (fewer GL state changes).
//
// These live for the whole app lifetime and must NEVER be disposed — the engine's
// dispose traversal checks SHARED_RESOURCES and skips anything registered here.
// (Disposing a shared singleton during a character rebuild would blank out every
// subsequent character.) The CPU-side buffers also survive GL-context recreation,
// so a fresh renderer simply re-uploads them.
export const SHARED_RESOURCES = new Set<THREE.BufferGeometry | THREE.Material>()
function shared<T extends THREE.BufferGeometry | THREE.Material>(r: T): T {
  SHARED_RESOURCES.add(r)
  return r
}

const HEAD_GEO = shared(new THREE.BoxGeometry(0.45, 0.45, 0.4))
const EYE_GEO = shared(new THREE.SphereGeometry(0.06, 6, 4))
const PUPIL_GEO = shared(new THREE.SphereGeometry(0.035, 6, 4))
const MOUTH_GEO = shared(new THREE.BoxGeometry(0.12, 0.03, 0.02))
const ARM_GEO = shared(new THREE.BoxGeometry(0.15, 0.5, 0.15))
const HAND_GEO = shared(new THREE.BoxGeometry(0.13, 0.13, 0.13))
const LEG_GEO = shared(new THREE.BoxGeometry(0.18, 0.5, 0.18))
const FOOT_GEO = shared(new THREE.BoxGeometry(0.17, 0.1, 0.25))
const SHADOW_GEO = shared(new THREE.CircleGeometry(0.4, 16))

const EYE_MAT = shared(new THREE.MeshBasicMaterial({ color: 0xffffff }))
const PUPIL_MAT = shared(new THREE.MeshBasicMaterial({ color: 0x111111 }))
const MOUTH_MAT = shared(new THREE.MeshBasicMaterial({ color: 0x332222 }))
const DARK_MAT = shared(toonMat(0x1a1a2e))
const SHADOW_MAT = shared(
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
)

// ── Muse (ClawMuse) parts ─────────────────────────────────────────────────────
// Claw mitt: a palm and two pincer jaws, the voxel read of the app icon's claw
// (resources/glyph.svg) — a thin fixed jaw and a heavier moving one.
const CLAW_PALM_GEO = shared(new THREE.BoxGeometry(0.16, 0.12, 0.15))
const CLAW_FIXED_GEO = shared(new THREE.BoxGeometry(0.055, 0.15, 0.1))
const CLAW_MOVING_GEO = shared(new THREE.BoxGeometry(0.07, 0.17, 0.11))
const CLAW_TIP_GEO = shared(new THREE.BoxGeometry(0.045, 0.05, 0.08))
const WHITE_MAT = shared(toonMat(0xfff6ee))

/**
 * The spark from the icon: four points joined by concave curves. Control
 * points are the glyph's own (its spark is 144 units across with handles at
 * 6 and 18 from the centre lines → 0.083 and 0.25 of the radius).
 */
function sparkGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  const a = 0.083
  const b = 0.25
  s.moveTo(0, 1)
  s.bezierCurveTo(a, b, b, a, 1, 0)
  s.bezierCurveTo(b, -a, a, -b, 0, -1)
  s.bezierCurveTo(-a, -b, -b, -a, -1, 0)
  s.bezierCurveTo(-b, a, -a, b, 0, 1)
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false, curveSegments: 8 })
  geo.translate(0, 0, -0.15)
  return geo
}
export const SPARK_GEO = shared(sparkGeometry())
/** Body-space height the spark floats at, above the head. */
export const SPARK_Y = 2.24
export const MUSE_CORAL = 0xff5a4e

export interface ClawRig {
  group: THREE.Group
  /** Pivot groups; rotate on Z to open (mirrored per side). */
  fixed: THREE.Group
  moving: THREE.Group
  side: 1 | -1
}

function buildClaw(mat: THREE.Material, side: 1 | -1): ClawRig {
  const group = new THREE.Group()
  group.position.y = -0.5
  const palm = new THREE.Mesh(CLAW_PALM_GEO, mat)
  palm.castShadow = true
  group.add(palm)

  // `side` mirrors the claw so the heavy jaw is always on the outside.
  const fixed = new THREE.Group()
  fixed.position.set(-0.04 * side, -0.05, 0)
  group.add(fixed)
  const fixedJaw = new THREE.Mesh(CLAW_FIXED_GEO, mat)
  fixedJaw.position.y = -0.075
  fixed.add(fixedJaw)
  const fixedTip = new THREE.Mesh(CLAW_TIP_GEO, WHITE_MAT)
  fixedTip.position.y = -0.17
  fixed.add(fixedTip)

  const moving = new THREE.Group()
  moving.position.set(0.04 * side, -0.05, 0)
  group.add(moving)
  const movingJaw = new THREE.Mesh(CLAW_MOVING_GEO, mat)
  movingJaw.position.y = -0.085
  moving.add(movingJaw)
  const movingTip = new THREE.Mesh(CLAW_TIP_GEO, WHITE_MAT)
  movingTip.position.set(0, -0.19, 0)
  moving.add(movingTip)

  const claw: ClawRig = { group, fixed, moving, side }
  setClawOpen(claw, 0.2)
  return claw
}

/** Opens a claw mitt: 0 = pinched shut, 1 = wide. */
export function setClawOpen(claw: ClawRig, open: number): void {
  const o = Math.max(0, Math.min(1, open))
  claw.fixed.rotation.z = -claw.side * (0.04 + o * 0.28)
  claw.moving.rotation.z = claw.side * (0.08 + o * 0.55)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OfficeLayout {
  positions: THREE.Vector3[]
  isWorker: boolean[]
  usesMainDesk: boolean[]
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function computeOfficeLayout(charData: CharacterData[]): OfficeLayout {
  if (charData.length === 0) return { positions: [], isWorker: [], usesMainDesk: [] }

  const positions: THREE.Vector3[] = new Array(charData.length)
  const isWorker: boolean[] = new Array(charData.length)
  const usesMainDesk: boolean[] = new Array(charData.length).fill(false)

  let deskIdx = 0
  let idleIdx = 0

  for (let i = 0; i < charData.length; i++) {
    const hasTasks = (charData[i]!.taskCount ?? 0) > 0
    isWorker[i] = hasTasks

    if (hasTasks) {
      if (deskIdx < DESK_POSITIONS.length) {
        const [x, y, z] = DESK_POSITIONS[deskIdx]!
        positions[i] = new THREE.Vector3(x, y, z)
        if (deskIdx === 0) usesMainDesk[i] = true
      } else {
        const row = deskIdx % 2
        const col = Math.floor(deskIdx / 2) + 3
        positions[i] = new THREE.Vector3(col * 2.5 - 2.5, 0, row === 0 ? -3 : -1)
      }
      deskIdx++
    } else {
      if (idleIdx < IDLE_POSITIONS.length) {
        const [x, y, z] = IDLE_POSITIONS[idleIdx]!
        positions[i] = new THREE.Vector3(x, y, z)
      } else {
        const angle = (idleIdx / Math.max(idleIdx + 1, 8)) * Math.PI * 2
        const r = 3.5
        positions[i] = new THREE.Vector3(Math.cos(angle) * r, 0, 2.5 + Math.sin(angle) * r)
      }
      idleIdx++
    }
  }

  return { positions, isWorker, usesMainDesk }
}

// ── Character builder ─────────────────────────────────────────────────────────

export function buildCharacter(cfg: CharacterData, index: number, floatingObjects: FloatingObject[]): THREE.Group {
  const group = new THREE.Group()

  const skinMat = toonMat(cfg.skin)
  const hairMat = toonMat(cfg.hair)
  const accentMat = toonMat(cfg.accentHex, cfg.accentHex, 0.3)
  // Color-independent materials are shared singletons (see SHARED_RESOURCES).
  const darkMat = DARK_MAT
  const eyeMat = EYE_MAT
  const pupilMat = PUPIL_MAT

  const bodyGroup = new THREE.Group()
  group.add(bodyGroup)

  let tw: number, th: number, td: number
  if (cfg.style === 'sentinel') { tw = 0.65; th = 0.7; td = 0.4 }
  else if (cfg.style === 'striker') { tw = 0.55; th = 0.65; td = 0.35 }
  else { tw = 0.5; th = 0.6; td = 0.35 }

  const torso = new THREE.Mesh(new THREE.BoxGeometry(tw, th, td), accentMat)
  torso.position.y = 1.0
  torso.castShadow = true
  bodyGroup.add(torso)

  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.style === 'sentinel' ? 0.68 : 0.53, 0.08, cfg.style === 'sentinel' ? 0.43 : 0.38),
    darkMat
  )
  belt.position.y = 0.72
  bodyGroup.add(belt)

  if (cfg.style === 'muse') {
    // White collar — the icon's white-on-coral, worn.
    const collar = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.02, 0.07, td + 0.02), WHITE_MAT)
    collar.position.y = 1.27
    bodyGroup.add(collar)
  }

  const headGroup = new THREE.Group()
  headGroup.position.y = 1.6
  bodyGroup.add(headGroup)

  const head = new THREE.Mesh(HEAD_GEO, skinMat)
  head.castShadow = true
  headGroup.add(head)

  const eyeGeo = EYE_GEO
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
  eyeL.position.set(-0.1, 0.04, 0.2)
  headGroup.add(eyeL)
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat)
  eyeR.position.set(0.1, 0.04, 0.2)
  headGroup.add(eyeR)

  const pupilGeo = PUPIL_GEO
  const pupilL = new THREE.Mesh(pupilGeo, pupilMat)
  pupilL.position.set(-0.1, 0.04, 0.24)
  headGroup.add(pupilL)
  const pupilR = new THREE.Mesh(pupilGeo, pupilMat)
  pupilR.position.set(0.1, 0.04, 0.24)
  headGroup.add(pupilR)

  const mouth = new THREE.Mesh(MOUTH_GEO, MOUTH_MAT)
  mouth.position.set(0, -0.1, 0.21)
  headGroup.add(mouth)

  // Hair styles
  // Seeded, never Math.random: a rebuild (or an exported still) must produce
  // exactly the character that was on screen.
  const rand = mulberry32(cfg.seed ?? hashStr(`${cfg.name}:${cfg.style}`))
  if (cfg.style === 'muse') {
    // A bob that leaves the forehead clear, so brows read on skin.
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.46), hairMat)
    top.position.set(0, 0.27, -0.01)
    headGroup.add(top)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42, 0.14), hairMat)
    back.position.set(0, 0.05, -0.17)
    headGroup.add(back)
    for (const sx of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.32), hairMat)
      lock.position.set(0.25 * sx, 0.04, -0.02)
      headGroup.add(lock)
    }
    const fringeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), hairMat)
    fringeL.position.set(-0.11, 0.19, 0.2)
    fringeL.rotation.z = -0.12
    headGroup.add(fringeL)
    const fringeR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.06), hairMat)
    fringeR.position.set(0.12, 0.2, 0.2)
    fringeR.rotation.z = 0.18
    headGroup.add(fringeR)
  } else if (cfg.style === 'mage') {
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.45), hairMat)
    hair.position.set(0, 0.2, -0.02)
    headGroup.add(hair)
    const hairSide = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.3), hairMat)
    hairSide.position.set(-0.3, -0.05, 0)
    headGroup.add(hairSide)
    const hairSide2 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.3), hairMat)
    hairSide2.position.set(0.3, 0, 0)
    headGroup.add(hairSide2)
  } else if (cfg.style === 'striker') {
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.45), hairMat)
    hair.position.set(0, 0.22, 0)
    headGroup.add(hair)
    for (let s = 0; s < 5; s++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 4), hairMat)
      spike.position.set(-0.15 + s * 0.075, 0.4 + rand() * 0.1, -0.05 + rand() * 0.1)
      spike.rotation.z = (rand() - 0.5) * 0.5
      headGroup.add(spike)
    }
  } else if (cfg.style === 'sentinel') {
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.3, 0.48), accentMat)
    helmet.position.set(0, 0.22, -0.02)
    headGroup.add(helmet)
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.08, 0.06),
      new THREE.MeshBasicMaterial({ color: cfg.accentHex, transparent: true, opacity: 0.7 })
    )
    visor.position.set(0, 0.12, 0.22)
    headGroup.add(visor)
  } else {
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.48), hairMat)
    hair.position.set(0, 0.18, -0.04)
    headGroup.add(hair)
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), hairMat)
    bun.position.set(0, 0.15, -0.28)
    headGroup.add(bun)
  }

  // Arms
  const armGeo = ARM_GEO
  const armOff = cfg.style === 'sentinel' ? 0.42 : 0.35

  const leftArmGroup = new THREE.Group()
  leftArmGroup.position.set(-armOff, 1.15, 0)
  bodyGroup.add(leftArmGroup)
  const leftArm = new THREE.Mesh(armGeo, skinMat)
  leftArm.position.y = -0.25
  leftArm.castShadow = true
  leftArmGroup.add(leftArm)

  const rightArmGroup = new THREE.Group()
  rightArmGroup.position.set(armOff, 1.15, 0)
  bodyGroup.add(rightArmGroup)
  const rightArm = new THREE.Mesh(armGeo, skinMat)
  rightArm.position.y = -0.25
  rightArm.castShadow = true
  rightArmGroup.add(rightArm)

  // Hands — claw mitts for the muse, plain mitts for everyone else.
  let leftHand: THREE.Object3D
  let rightHand: THREE.Object3D
  let claws: [ClawRig, ClawRig] | null = null
  if (cfg.style === 'muse') {
    claws = [buildClaw(accentMat, -1), buildClaw(accentMat, 1)]
    leftHand = claws[0].group
    rightHand = claws[1].group
  } else {
    leftHand = new THREE.Mesh(HAND_GEO, accentMat)
    leftHand.position.y = -0.5
    rightHand = new THREE.Mesh(HAND_GEO, accentMat)
    rightHand.position.y = -0.5
  }
  leftArmGroup.add(leftHand)
  rightArmGroup.add(rightHand)

  // Legs
  const legGeo2 = LEG_GEO

  const leftLegGroup = new THREE.Group()
  leftLegGroup.position.set(-0.13, 0.55, 0)
  bodyGroup.add(leftLegGroup)
  const leftLeg = new THREE.Mesh(legGeo2, darkMat)
  leftLeg.position.y = -0.25
  leftLeg.castShadow = true
  leftLegGroup.add(leftLeg)

  const rightLegGroup = new THREE.Group()
  rightLegGroup.position.set(0.13, 0.55, 0)
  bodyGroup.add(rightLegGroup)
  const rightLeg = new THREE.Mesh(legGeo2, darkMat)
  rightLeg.position.y = -0.25
  rightLeg.castShadow = true
  rightLegGroup.add(rightLeg)

  // Feet
  const footGeo = FOOT_GEO
  const leftFoot = new THREE.Mesh(footGeo, accentMat)
  leftFoot.position.set(0, -0.5, 0.04)
  leftLegGroup.add(leftFoot)
  const rightFoot = new THREE.Mesh(footGeo, accentMat)
  rightFoot.position.set(0, -0.5, 0.04)
  rightLegGroup.add(rightFoot)

  // Style-specific accessories
  if (cfg.style === 'mage') {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), toonMat(0x664422))
    staff.position.set(0.5, 1.0, 0)
    staff.rotation.z = 0.15
    bodyGroup.add(staff)

    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.12, 0),
      new THREE.MeshBasicMaterial({ color: cfg.accentHex, transparent: true, opacity: 0.9 })
    )
    crystal.position.set(0.55, 1.95, 0)
    bodyGroup.add(crystal)
    floatingObjects.push({ mesh: crystal, type: 'crystalSpin' })

    const staffLight = new THREE.PointLight(cfg.accentHex, 0.4 * _LP, 3, 2)
    staffLight.position.set(0.55, 1.95, 0)
    bodyGroup.add(staffLight)
  }

  if (cfg.style === 'sentinel') {
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.08), accentMat)
    shield.position.set(0, 1.1, -0.28)
    shield.rotation.x = 0.1
    bodyGroup.add(shield)
    const padGeo = new THREE.BoxGeometry(0.25, 0.12, 0.25)
    const padL = new THREE.Mesh(padGeo, accentMat)
    padL.position.set(-0.38, 1.35, 0)
    bodyGroup.add(padL)
    const padR = new THREE.Mesh(padGeo, accentMat)
    padR.position.set(0.38, 1.35, 0)
    bodyGroup.add(padR)
  }

  if (cfg.style === 'healer') {
    const ringGeo = new THREE.TorusGeometry(0.3, 0.02, 8, 16)
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: cfg.accentHex, transparent: true, opacity: 0.6 }))
    ring.position.y = 2.1
    ring.rotation.x = Math.PI / 2
    bodyGroup.add(ring)
    floatingObjects.push({ mesh: ring, type: 'healRing' })

    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.015, 8, 16),
      new THREE.MeshBasicMaterial({ color: cfg.accentHex, transparent: true, opacity: 0.4 })
    )
    ring2.position.y = 2.2
    ring2.rotation.x = Math.PI / 2
    bodyGroup.add(ring2)
    floatingObjects.push({ mesh: ring2, type: 'healRing2' })
  }

  let spark: THREE.Group | null = null
  if (cfg.style === 'muse') {
    spark = new THREE.Group()
    spark.position.y = SPARK_Y
    // Unlit, in the outfit colour: reads on light and dark backgrounds alike.
    const star = new THREE.Mesh(SPARK_GEO, new THREE.MeshBasicMaterial({ color: cfg.accentHex }))
    star.scale.setScalar(0.17)
    spark.add(star)
    bodyGroup.add(spark)
    floatingObjects.push({ mesh: spark, type: 'sparkSpin', baseY: SPARK_Y })
  }

  // Shadow
  const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.02
  group.add(shadow)

  group.rotation.y = Math.PI * 0.15 + index * 0.3

  group.userData = {
    id: index,
    bodyGroup,
    headGroup,
    leftArm: leftArmGroup,
    rightArm: rightArmGroup,
    leftLeg: leftLegGroup,
    rightLeg: rightLegGroup,
    // Rig handles for the avatar engine (the room only animates the above).
    eyes: [eyeL, eyeR],
    pupils: [pupilL, pupilR],
    mouth,
    hands: [leftHand, rightHand],
    claws,
    spark,
    shadow,
  }
  return group
}

// ── All-character builder ─────────────────────────────────────────────────────

// anchorY: world Y the name-label overlay is projected from. Set above the head
// (head top ≈ 2.0) with extra clearance so the pill floats clearly over the agent.
const CHAR_ANCHOR_Y = 2.9

export function buildAllCharacters(
  scene: THREE.Scene,
  charGroup: THREE.Group,
  charData: CharacterData[],
  layout: OfficeLayout,
  floatingObjects: FloatingObject[],
): {
  characters: THREE.Group[]
  selectionRings: THREE.Mesh[]
  charColors: THREE.Color[]
  characterGroups: THREE.Group[]
} {
  const characters: THREE.Group[] = []
  const selectionRings: THREE.Mesh[] = []
  const charColors = charData.map(c => new THREE.Color(c.accentHex))
  const charPositions = layout.positions
  // characterGroups is returned for raycast + label-projection in later tasks
  const characterGroups: THREE.Group[] = []

  charData.forEach((cfg, i) => {
    // Bounds are guaranteed by computeOfficeLayout building one entry per
    // character (same charData.length) — `!` is safe under noUncheckedIndexedAccess.
    const isWorker = layout.isWorker[i]!
    const charPos = charPositions[i]!
    const charMesh = buildCharacter(cfg, i, floatingObjects)
    charMesh.position.copy(charPos)

    if (isWorker) {
      if (!layout.usesMainDesk[i]) {
        const desk = createWorkDesk(charPos, cfg.accentHex, floatingObjects)
        charGroup.add(desk)
      }
      charMesh.position.y = -0.2
      charMesh.userData.isSitting = true
      charMesh.lookAt(0, charMesh.position.y, 0)
    } else {
      charMesh.lookAt(0, 0, 0)
      charMesh.rotation.y += (Math.random() - 0.5) * 0.8
    }

    charGroup.add(charMesh)
    characters.push(charMesh)

    // Tag group for raycast + label overlay
    charMesh.userData.skillIndex = i
    charMesh.userData.anchorY = CHAR_ANCHOR_Y
    // Accent color + processing-glow height, read by the engine's shared point-light
    // pool to illuminate whichever characters are currently processing (replaces the
    // per-character PointLight that made light count grow linearly with the roster).
    charMesh.userData.accentColor = cfg.accentHex
    characterGroups.push(charMesh)

    // Status ring for workers
    if (isWorker) {
      const statusRing = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.65, 32),
        new THREE.MeshBasicMaterial({
          color: cfg.accentHex,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
      statusRing.rotation.x = -Math.PI / 2
      statusRing.position.copy(charPos)
      statusRing.position.y = 0.05
      charGroup.add(statusRing)
      floatingObjects.push({ mesh: statusRing, type: 'statusRing', charIndex: i })

      // NOTE: badge canvas (document.createElement) removed here — task/badge
      // count is rendered by the DOM LabelOverlay component instead.
    }

    // Processing effects
    const procBaseY = isWorker ? 2.1 : 2.3
    charMesh.userData.procBaseY = procBaseY

    const procGlow = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.2, 2),
      new THREE.MeshBasicMaterial({
        color: cfg.accentHex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    procGlow.position.copy(charPos)
    procGlow.position.y = procBaseY
    charGroup.add(procGlow)

    // NOTE: the per-character PointLight was removed here. Its illumination is now
    // provided by a small fixed pool of shared point lights driven in the engine
    // loop, so the dynamic-light count no longer grows with the number of agents.

    const procRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.03, 8, 32),
      new THREE.MeshBasicMaterial({
        color: cfg.accentHex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    procRing.rotation.x = -Math.PI / 2
    procRing.position.copy(charPos)
    procRing.position.y = 0.1
    charGroup.add(procRing)

    const procPCount = 24
    const procPArr = new Float32Array(procPCount * 3)
    for (let p = 0; p < procPCount; p++) {
      const a = (p / procPCount) * Math.PI * 2
      procPArr[p * 3] = Math.cos(a) * 0.4
      procPArr[p * 3 + 1] = procBaseY + (p / procPCount) * 0.6
      procPArr[p * 3 + 2] = Math.sin(a) * 0.4
    }
    const procPGeo = new THREE.BufferGeometry()
    procPGeo.setAttribute('position', new THREE.BufferAttribute(procPArr, 3))
    const procParticles = new THREE.Points(procPGeo, new THREE.PointsMaterial({
      color: cfg.accentHex,
      size: 0.07,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }))
    procParticles.position.copy(charPos)
    charGroup.add(procParticles)

    floatingObjects.push(
      { mesh: procGlow, type: 'processingGlow', charIndex: i },
      { mesh: procRing, type: 'processingRing', charIndex: i },
      {
        mesh: procParticles,
        type: 'processingParticles',
        charIndex: i,
        posArray: procPArr,
        geo: procPGeo,
        pCount: procPCount,
        baseY: procBaseY,
      }
    )
  })

  // Selection rings
  characters.forEach((char, i) => {
    const ringGeo = new THREE.RingGeometry(0.5, 0.58, 32)
    const ringMat = new THREE.MeshBasicMaterial({
      color: charColors[i] ?? new THREE.Color(0x00f0ff),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(charPositions[i]!)
    ring.position.y = 0.03
    scene.add(ring)
    selectionRings.push(ring)
  })

  return { characters, selectionRings, charColors, characterGroups }
}
