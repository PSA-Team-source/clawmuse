/**
 * The avatar's little world: lights, camera framing and a renderer setup
 * shared by the stage, the badge hub and the exporter.
 */
import * as THREE from 'three'
import { AvatarAnimator, type AvatarState } from './animator'
import { createAvatarRig, type AvatarRig } from './rig'
import type { ResolvedAvatarConfig } from './config'

/** `full` = whole body with room to jump; `bust` = head and shoulders (badges). */
export type AvatarFraming = 'full' | 'bust'

const FRAMES: Record<AvatarFraming, { centerY: number; height: number; width: number; fov: number; lift: number }> = {
  // Floor to spark, plus the celebrate jump's headroom.
  full: { centerY: 1.36, height: 3.05, width: 2.1, fov: 26, lift: 0.55 },
  // Shoulders to spark, head a touch above centre.
  bust: { centerY: 1.8, height: 1.08, width: 1.02, fov: 24, lift: 0.3 },
}

export interface AvatarView {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly animator: AvatarAnimator
  readonly rig: AvatarRig
  /** Re-frames for a new aspect ratio (w / h). */
  setAspect(aspect: number): void
  /** Samples the animator at `t`, applies it and follows a sitting head (bust). */
  update(t: number): void
  setConfig(config: ResolvedAvatarConfig): void
  dispose(): void
}

export function createAvatarView(
  config: ResolvedAvatarConfig,
  opts: { framing: AvatarFraming; state?: AvatarState; reducedMotion?: boolean },
): AvatarView {
  const scene = new THREE.Scene()
  // Key from front-right, fill from the sky, coral rim from behind-left: the
  // flat-shaded voxels need all three to read as solid from any turn.
  const prevCM = THREE.ColorManagement.enabled
  THREE.ColorManagement.enabled = true
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3550, 1.9))
  const key = new THREE.DirectionalLight(0xffffff, 2.1)
  key.position.set(2.5, 4, 5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xff8f80, 1.4)
  rim.position.set(-4, 3, -3)
  scene.add(rim)
  THREE.ColorManagement.enabled = prevCM

  const frame = FRAMES[opts.framing]
  const camera = new THREE.PerspectiveCamera(frame.fov, 1, 0.1, 50)
  let aspect = 1
  let followY = 0

  const animator = new AvatarAnimator({
    seed: config.seed,
    initialState: opts.state ?? 'idle',
    reducedMotion: opts.reducedMotion,
  })
  let rig = createAvatarRig(config)
  scene.add(rig.root)

  function place(): void {
    const vHalf = THREE.MathUtils.degToRad(frame.fov / 2)
    const distV = frame.height / 2 / Math.tan(vHalf)
    const hHalf = Math.atan(Math.tan(vHalf) * aspect)
    const distH = frame.width / 2 / Math.tan(hHalf)
    const dist = Math.max(distV, distH)
    const cy = frame.centerY + followY
    camera.position.set(0, cy + frame.lift, dist)
    camera.lookAt(0, cy, 0)
  }

  function setAspect(a: number): void {
    aspect = Number.isFinite(a) && a > 0 ? a : 1
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    place()
  }
  setAspect(1)

  return {
    scene,
    camera,
    animator,
    get rig() {
      return rig
    },
    setAspect,
    update(t: number): void {
      const pose = animator.sample(t)
      rig.apply(pose, t)
      {
        // When the avatar sits down the camera follows: a badge (a portrait)
        // tracks the head; the full frame drops just enough to keep the
        // outstretched feet, which come toward the lens, in shot.
        const target = Math.min(0, pose.bodyY) * (opts.framing === 'bust' ? 0.85 : 0.4)
        if (target !== followY) {
          followY = target
          place()
        }
      }
    },
    setConfig(next: ResolvedAvatarConfig): void {
      rig.dispose()
      rig = createAvatarRig(next)
      scene.add(rig.root)
      animator.setSeed(next.seed)
    },
    dispose(): void {
      rig.dispose()
      scene.clear()
    },
  }
}

export interface RendererOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas
  antialias?: boolean
  preserveDrawingBuffer?: boolean
}

/** A transparent-background renderer configured for the avatar look. */
export function createAvatarRenderer(opts: RendererOptions): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas: opts.canvas,
    alpha: true,
    antialias: opts.antialias ?? true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    powerPreference: 'low-power',
  })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  return renderer
}
