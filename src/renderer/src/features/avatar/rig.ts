/**
 * The avatar rig: the room's voxel character plus a face you can animate.
 *
 * The body comes from the room engine's `buildCharacter` (one character
 * builder, not two), and this module adds what the room never needed —
 * brows, lash lines for closed eyes, a three-piece mouth that can smile and
 * frown, accessories, a lap laptop, Zzz, confetti — then writes a `Pose`
 * (animator.ts) onto all of it once per frame.
 */
import * as THREE from 'three'
import {
  buildCharacter,
  setClawOpen,
  SHARED_RESOURCES,
  SPARK_GEO,
  SPARK_Y,
  type ClawRig,
} from '@/features/room3d/engine/character'
import { toonMat } from '@/features/room3d/engine/materials'
import { hash01 } from '@/features/room3d/engine/rng'
import type { CharacterData } from '@/features/room3d/engine/types'
import type { FloatingObject } from '@/features/room3d/engine/furniture'
import type { Pose } from './animator'
import { toHex, type ResolvedAvatarConfig } from './config'

function shared<T extends THREE.BufferGeometry | THREE.Material>(r: T): T {
  SHARED_RESOURCES.add(r)
  return r
}

const BROW_GEO = shared(new THREE.BoxGeometry(0.1, 0.028, 0.02))
const LASH_GEO = shared(new THREE.BoxGeometry(0.13, 0.02, 0.02))
const CORNER_GEO = shared(new THREE.BoxGeometry(0.035, 0.03, 0.02))
const TONGUE_GEO = shared(new THREE.BoxGeometry(0.08, 0.04, 0.012))
const UNIT_BOX = shared(new THREE.BoxGeometry(1, 1, 1))
const ZBAR_GEO = shared(new THREE.BoxGeometry(0.13, 0.03, 0.025))
const ZDIAG_GEO = shared(new THREE.BoxGeometry(0.17, 0.028, 0.025))
const CONFETTI_GEO = shared(new THREE.BoxGeometry(0.06, 0.06, 0.014))

const FACE_DARK = shared(new THREE.MeshBasicMaterial({ color: 0x2a1b22 }))
const MOUTH_DARK = shared(new THREE.MeshBasicMaterial({ color: 0x3a1f26 }))
const TONGUE_MAT = shared(new THREE.MeshBasicMaterial({ color: 0xff7f8a }))
const GOLD_MAT = shared(toonMat(0xffc83d, 0xffa000, 0.25))
const LAPTOP_MAT = shared(toonMat(0x2d2d3a))
const LAPTOP_KEYS_MAT = shared(toonMat(0x1a1a24))
const LENS_MAT = shared(new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.22, depthWrite: false }))
const CONFETTI_MAT = shared(new THREE.MeshBasicMaterial({ color: 0xffffff }))

/** Top of the head (head-local Y) per style, where hats and bands sit. */
const HEAD_TOP: Record<string, number> = { muse: 0.35, mage: 0.375, striker: 0.345, sentinel: 0.37, healer: 0.33 }

/** Root yaw: a gentle three-quarter turn reads as a figure, not a flat icon. */
export const BASE_YAW = 0.32
const CONFETTI_COUNT = 56
const CONFETTI_LIFE = 1.8
const CONFETTI_GRAVITY = -4.2

export interface AvatarRig {
  readonly root: THREE.Group
  readonly config: ResolvedAvatarConfig
  apply(pose: Pose, t: number): void
  dispose(): void
}

function box(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

/** A unit box scaled to size — shared geometry, one mesh per part. */
function block(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const m = box(UNIT_BOX, mat, x, y, z, parent)
  m.scale.set(sx, sy, sz)
  return m
}

function buildAccessory(config: ResolvedAvatarConfig, head: THREE.Group, owned: THREE.Material[]): void {
  const top = HEAD_TOP[config.style] ?? 0.35
  const outfit = toonMat(config.colors.outfit)
  owned.push(outfit)
  switch (config.accessory) {
    case 'cap': {
      block(outfit, 0.5, 0.14, 0.48, 0, top + 0.06, 0, head)
      block(outfit, 0.46, 0.035, 0.22, 0, top + 0.005, 0.3, head)
      block(FACE_DARK, 0.06, 0.03, 0.06, 0, top + 0.145, 0, head)
      break
    }
    case 'glasses': {
      for (const sx of [-1, 1]) {
        const x = 0.1 * sx
        block(FACE_DARK, 0.15, 0.022, 0.02, x, 0.1, 0.27, head)
        block(FACE_DARK, 0.15, 0.022, 0.02, x, -0.02, 0.27, head)
        block(FACE_DARK, 0.022, 0.14, 0.02, x - 0.064, 0.04, 0.27, head)
        block(FACE_DARK, 0.022, 0.14, 0.02, x + 0.064, 0.04, 0.27, head)
        block(LENS_MAT, 0.12, 0.1, 0.008, x, 0.04, 0.268, head)
        // Arm back to the ear.
        block(FACE_DARK, 0.02, 0.02, 0.26, 0.232 * sx, 0.08, 0.14, head)
      }
      block(FACE_DARK, 0.06, 0.02, 0.02, 0, 0.07, 0.27, head)
      break
    }
    case 'crown': {
      block(GOLD_MAT, 0.4, 0.08, 0.36, 0, top + 0.04, 0, head)
      for (const [x, z] of [[-0.17, 0.15], [0.17, 0.15], [-0.17, -0.15], [0.17, -0.15]] as const) {
        block(GOLD_MAT, 0.06, 0.1, 0.06, x, top + 0.13, z, head)
      }
      block(GOLD_MAT, 0.08, 0.14, 0.06, 0, top + 0.15, 0.15, head)
      const gem = new THREE.MeshBasicMaterial({ color: config.colors.outfit })
      owned.push(gem)
      block(gem, 0.06, 0.05, 0.02, 0, top + 0.04, 0.185, head)
      break
    }
    case 'headphones': {
      block(FACE_DARK, 0.58, 0.05, 0.09, 0, top + 0.04, 0, head)
      for (const sx of [-1, 1]) {
        block(FACE_DARK, 0.05, 0.28, 0.09, 0.29 * sx, top - 0.12, 0, head)
        block(outfit, 0.09, 0.2, 0.18, 0.3 * sx, -0.01, 0, head)
        block(FACE_DARK, 0.03, 0.14, 0.13, 0.26 * sx, -0.01, 0, head)
      }
      break
    }
    case 'none':
      break
  }
}

function buildLaptop(config: ResolvedAvatarConfig, owned: THREE.Material[]): THREE.Group {
  // Sits on the lap of the floor-sitting pose (thighs top out near y 0.17).
  const g = new THREE.Group()
  g.position.set(0, 0.19, 0.4)
  block(LAPTOP_MAT, 0.52, 0.035, 0.34, 0, 0, 0, g)
  block(LAPTOP_KEYS_MAT, 0.44, 0.01, 0.2, 0, 0.022, -0.03, g)
  const lid = new THREE.Group()
  lid.position.set(0, 0.015, 0.17)
  lid.rotation.x = 0.32
  g.add(lid)
  block(LAPTOP_MAT, 0.52, 0.33, 0.025, 0, 0.165, 0, lid)
  // Screen (faces the character) and the mark on the lid (faces the viewer).
  const glow = new THREE.MeshBasicMaterial({ color: config.colors.outfit })
  owned.push(glow)
  block(glow, 0.46, 0.27, 0.005, 0, 0.17, -0.014, lid)
  const mark = new THREE.Mesh(SPARK_GEO, glow)
  mark.scale.set(0.07, 0.07, 0.02)
  mark.position.set(0, 0.17, 0.016)
  lid.add(mark)
  return g
}

function buildZzz(owned: THREE.Material[]): { group: THREE.Group; zs: THREE.Group[]; mats: THREE.MeshBasicMaterial[] } {
  const group = new THREE.Group()
  const zs: THREE.Group[] = []
  const mats: THREE.MeshBasicMaterial[] = []
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x8f9ae0, transparent: true, opacity: 0, depthWrite: false })
    owned.push(mat)
    mats.push(mat)
    const z = new THREE.Group()
    box(ZBAR_GEO, mat, 0, 0.065, 0, z)
    box(ZBAR_GEO, mat, 0, -0.065, 0, z)
    const d = box(ZDIAG_GEO, mat, 0, 0, 0, z)
    d.rotation.z = Math.atan2(0.13, 0.13)
    group.add(z)
    zs.push(z)
  }
  return { group, zs, mats }
}

function buildConfetti(config: ResolvedAvatarConfig): {
  mesh: THREE.InstancedMesh
  vel: Float32Array
  spin: Float32Array
} {
  const mesh = new THREE.InstancedMesh(CONFETTI_GEO, CONFETTI_MAT, CONFETTI_COUNT)
  mesh.frustumCulled = false
  mesh.visible = false
  const palette = [config.colors.outfit, 0xff5a4e, 0xfff6ee, 0xffc83d, 0x7cc7ff, 0xb28dff, 0x5fe3a1]
  const color = new THREE.Color()
  const vel = new Float32Array(CONFETTI_COUNT * 3)
  const spin = new Float32Array(CONFETTI_COUNT * 3)
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const r = (k: number) => hash01(config.seed ^ 0xc0ffee, i * 8 + k)
    const angle = r(0) * Math.PI * 2
    const up = 2.2 + r(1) * 1.8
    const out = 0.6 + r(2) * 1.3
    vel[i * 3] = Math.cos(angle) * out
    vel[i * 3 + 1] = up
    vel[i * 3 + 2] = Math.sin(angle) * out * 0.6
    spin[i * 3] = (r(3) - 0.5) * 16
    spin[i * 3 + 1] = (r(4) - 0.5) * 16
    spin[i * 3 + 2] = (r(5) - 0.5) * 16
    mesh.setColorAt(i, color.setHex(palette[Math.floor(r(6) * palette.length)]!))
  }
  return { mesh, vel, spin }
}

/**
 * Builds a rig for `config`. Colours are converted with colour management
 * forced on for the duration of the build: the room engine turns it off
 * globally for its own tuned look, and the avatar must render the brand coral
 * as #FF5A4E whether or not the room was ever opened.
 */
export function createAvatarRig(config: ResolvedAvatarConfig): AvatarRig {
  const prevCM = THREE.ColorManagement.enabled
  THREE.ColorManagement.enabled = true
  try {
    return buildRig(config)
  } finally {
    THREE.ColorManagement.enabled = prevCM
  }
}

function buildRig(config: ResolvedAvatarConfig): AvatarRig {
  const owned: THREE.Material[] = []
  const data: CharacterData = {
    name: config.name,
    cls: config.style,
    accent: toHex(config.colors.outfit),
    accentHex: config.colors.outfit,
    skin: config.colors.skin,
    hair: config.colors.hair,
    style: config.style,
    stats: [0, 0, 0],
    seed: config.seed,
  }
  const ignoredFloaters: FloatingObject[] = []
  const root = buildCharacter(data, 0, ignoredFloaters)
  root.rotation.y = BASE_YAW
  const ud = root.userData
  const body = ud.bodyGroup as THREE.Group
  const head = ud.headGroup as THREE.Group
  const armL = ud.leftArm as THREE.Group
  const armR = ud.rightArm as THREE.Group
  const legL = ud.leftLeg as THREE.Group
  const legR = ud.rightLeg as THREE.Group
  const [eyeL, eyeR] = ud.eyes as [THREE.Mesh, THREE.Mesh]
  const [pupilL, pupilR] = ud.pupils as [THREE.Mesh, THREE.Mesh]
  const mouthC = ud.mouth as THREE.Mesh
  const claws = ud.claws as [ClawRig, ClawRig] | null
  const spark = ud.spark as THREE.Group | null
  const shadow = ud.shadow as THREE.Mesh

  // ── Face additions ──────────────────────────────────────────────────────────
  const FACE_Z = 0.24
  mouthC.material = MOUTH_DARK
  const cornerL = box(CORNER_GEO, MOUTH_DARK, -0.075, -0.1, 0.21, head)
  const cornerR = box(CORNER_GEO, MOUTH_DARK, 0.075, -0.1, 0.21, head)
  const tongue = box(TONGUE_GEO, TONGUE_MAT, 0, -0.1, 0.222, head)
  const lashL = box(LASH_GEO, FACE_DARK, -0.1, 0.03, 0.262, head)
  const lashR = box(LASH_GEO, FACE_DARK, 0.1, 0.03, 0.262, head)
  // The sentinel's visor already is its brow line.
  const hasBrows = config.style !== 'sentinel'
  const browL = box(BROW_GEO, FACE_DARK, -0.1, 0.125, FACE_Z, head)
  const browR = box(BROW_GEO, FACE_DARK, 0.1, 0.125, FACE_Z, head)
  browL.visible = browR.visible = hasBrows

  buildAccessory(config, head, owned)

  // ── Spark glow (muse) ───────────────────────────────────────────────────────
  let sparkGlow: THREE.Mesh | null = null
  let sparkGlowMat: THREE.MeshBasicMaterial | null = null
  if (spark) {
    sparkGlowMat = new THREE.MeshBasicMaterial({
      // A paler halo than the star, so the mark keeps its edge.
      color: new THREE.Color(config.colors.outfit).lerp(new THREE.Color(0xffffff), 0.45),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    })
    owned.push(sparkGlowMat)
    sparkGlow = new THREE.Mesh(SPARK_GEO, sparkGlowMat)
    sparkGlow.scale.set(0.25, 0.25, 0.05)
    sparkGlow.position.z = -0.03
    spark.add(sparkGlow)
  }

  // ── Props ───────────────────────────────────────────────────────────────────
  const laptop = buildLaptop(config, owned)
  root.add(laptop)
  const zzz = buildZzz(owned)
  body.add(zzz.group)
  const confetti = buildConfetti(config)
  root.add(confetti.mesh)

  const _m = new THREE.Matrix4()
  const _q = new THREE.Quaternion()
  const _e = new THREE.Euler()
  const _p = new THREE.Vector3()
  const _s = new THREE.Vector3()

  function apply(p: Pose, t: number): void {
    root.rotation.y = BASE_YAW + p.bodyRotY
    body.position.y = p.bodyY
    body.rotation.x = p.bodyRotX
    body.rotation.z = p.bodyRotZ
    const sq = Math.max(0.5, p.squash)
    const xz = 1 / Math.sqrt(sq)
    body.scale.set(xz, sq, xz)
    head.rotation.set(p.headRotX, p.headRotY, p.headRotZ)
    armL.rotation.set(p.armLX, 0, p.armLZ)
    armR.rotation.set(p.armRX, 0, p.armRZ)
    legL.rotation.x = p.legLX
    legR.rotation.x = p.legRX
    if (claws) {
      setClawOpen(claws[0], p.clawL)
      setClawOpen(claws[1], p.clawR)
    }

    // Eyes: lids are the Y scale; a lash line fades in as they close.
    const open = Math.max(0, Math.min(1, p.eyeOpen))
    const ey = 0.08 + 0.92 * open
    eyeL.scale.y = eyeR.scale.y = ey
    pupilL.scale.y = pupilR.scale.y = ey
    const lash = open < 0.4 ? 1 - open / 0.4 : 0
    lashL.visible = lashR.visible = lash > 0.02
    lashL.scale.x = lashR.scale.x = 0.4 + 0.6 * lash
    const px = Math.max(-1, Math.min(1, p.pupilX)) * 0.028
    const py = Math.max(-1, Math.min(1, p.pupilY)) * 0.022 * open
    pupilL.position.set(-0.1 + px, 0.04 + py, 0.24)
    pupilR.position.set(0.1 + px, 0.04 + py, 0.24)

    if (hasBrows) {
      const lift = 0.125 + p.browLift * 0.03
      browL.position.y = lift
      browR.position.y = lift + p.browAsym * 0.03
      // Positive angle raises the inner ends (worried/sleepy), negative knits them.
      browL.rotation.z = -p.browAngle
      browR.rotation.z = p.browAngle - p.browAsym * 0.25
    }

    // Mouth: centre bar stretches open, corners ride up (smile) or down (frown).
    const w = Math.max(0.3, p.mouthWidth)
    const mo = Math.max(0, p.mouthOpen)
    mouthC.scale.set(w, 1 + mo * 4.2, 1)
    mouthC.position.y = -0.1 - mo * 0.03
    const cx = 0.06 * w + 0.016
    const smile = Math.max(-1, Math.min(1, p.mouthSmile)) * (1 - Math.min(1, mo) * 0.5)
    cornerL.position.set(-cx, -0.1 + smile * 0.022 - mo * 0.02, 0.21)
    cornerR.position.set(cx, -0.1 + smile * 0.022 - mo * 0.02, 0.21)
    cornerL.rotation.z = -smile * 0.6
    cornerR.rotation.z = smile * 0.6
    tongue.visible = mo > 0.35
    tongue.scale.set(w, 1, 1)
    tongue.position.y = -0.1 - mo * 0.07

    if (spark) {
      spark.rotation.y = p.sparkSpin
      spark.position.y = SPARK_Y + p.sparkY
      spark.scale.setScalar(p.sparkScale)
      if (sparkGlowMat && sparkGlow) {
        const g = Math.max(0, Math.min(1, p.sparkGlow))
        sparkGlowMat.opacity = 0.12 + 0.3 * g
        const s = 0.24 + 0.1 * g
        sparkGlow.scale.set(s, s, 0.05)
      }
    }

    // Laptop pops in with the working pose.
    const lp = Math.max(0, Math.min(1, p.laptop))
    laptop.visible = lp > 0.01
    laptop.scale.setScalar(lp < 1 ? lp * lp * (3 - 2 * lp) : 1)

    // Zzz: three letters rising in a staggered loop.
    const zw = Math.max(0, Math.min(1, p.zzz))
    zzz.group.visible = zw > 0.01
    if (zzz.group.visible) {
      for (let i = 0; i < 3; i++) {
        const ph = (((t * 0.42 + i / 3) % 1) + 1) % 1
        const z = zzz.zs[i]!
        z.position.set(0.22 + ph * 0.3, 1.85 + ph * 0.75, 0.05)
        z.rotation.z = -0.25 + Math.sin(t * 2 + i) * 0.12
        z.scale.setScalar(0.55 + ph * 0.7)
        zzz.mats[i]!.opacity = zw * Math.sin(Math.PI * ph) * 0.95
      }
    }

    // Confetti: ballistic from the spark height; a pure function of burst age.
    const age = p.confettiAge
    const cw = Math.max(0, Math.min(1, p.confetti))
    confetti.mesh.visible = cw > 0.01 && age >= 0 && age < CONFETTI_LIFE
    if (confetti.mesh.visible) {
      const fade = age > CONFETTI_LIFE - 0.45 ? (CONFETTI_LIFE - age) / 0.45 : 1
      const sc = cw * fade * Math.min(1, age * 12)
      for (let i = 0; i < CONFETTI_COUNT; i++) {
        const v = confetti.vel
        _p.set(
          v[i * 3]! * age,
          SPARK_Y - 0.1 + v[i * 3 + 1]! * age + 0.5 * CONFETTI_GRAVITY * age * age,
          v[i * 3 + 2]! * age,
        )
        _e.set(confetti.spin[i * 3]! * age, confetti.spin[i * 3 + 1]! * age, confetti.spin[i * 3 + 2]! * age)
        _q.setFromEuler(_e)
        _s.setScalar(sc)
        confetti.mesh.setMatrixAt(i, _m.compose(_p, _q, _s))
      }
      confetti.mesh.instanceMatrix.needsUpdate = true
    }

    // Contact shadow shrinks as the body leaves the ground.
    const lift = Math.max(0, p.bodyY)
    shadow.scale.setScalar(Math.max(0.4, 1 - lift * 1.2))
  }

  return {
    root,
    config,
    apply,
    dispose(): void {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry && !SHARED_RESOURCES.has(mesh.geometry)) mesh.geometry.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        for (const m of mats) if (!SHARED_RESOURCES.has(m)) m.dispose()
      })
      for (const m of owned) m.dispose()
      confetti.mesh.dispose()
      root.removeFromParent()
    },
  }
}
