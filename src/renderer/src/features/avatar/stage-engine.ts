/**
 * The large interactive avatar: one WebGL context, one avatar, a rAF loop
 * that stops entirely while nobody can see it.
 */
import type { WebGLRenderer } from 'three'
import type { AvatarReaction, AvatarState } from './animator'
import type { ResolvedAvatarConfig } from './config'
import { createAvatarRenderer, createAvatarView, type AvatarFraming } from './scene'

/** The avatar you drive — what `AvatarStage` hands to `onReady`. */
export interface AvatarController {
  readonly state: AvatarState
  setState(state: AvatarState): void
  /** 0..1 mouth drive for `talking`; feed it per frame or per text delta. */
  setTalkLevel(level: number): void
  /** Squash-and-stretch giggle. */
  poke(): void
  /** Any reaction: poke, spin (dir ±1) or dance. */
  react(kind: AvatarReaction, dir?: number): void
  /** Look target relative to the avatar, each axis −1..1 (x right, y up). */
  lookAt(x: number, y: number): void
  clearLook(): void
}

export interface StageStats {
  /** Mean CPU time per frame (animate + render submit), ms. */
  frameMs: number
  /** Mean interval between rendered frames, ms. */
  intervalMs: number
  frames: number
}

export interface StageEngine {
  readonly avatar: AvatarController
  resize(width: number, height: number, dpr: number): void
  /** Visible = on screen and document not hidden. The loop stops when false. */
  setVisible(visible: boolean): void
  setReducedMotion(reduced: boolean): void
  setConfig(config: ResolvedAvatarConfig): void
  stats(): StageStats
  dispose(): void
}

export interface StageEngineOptions {
  canvas: HTMLCanvasElement
  config: ResolvedAvatarConfig
  framing: AvatarFraming
  state: AvatarState
  reducedMotion: boolean
  /** The context was lost and did not come back — the host should remount. */
  onFatal(): void
}

const RESTORE_TIMEOUT_MS = 2500

export function createStageEngine(opts: StageEngineOptions): StageEngine {
  const { canvas } = opts
  const renderer: WebGLRenderer = createAvatarRenderer({ canvas })
  const view = createAvatarView(opts.config, {
    framing: opts.framing,
    state: opts.state,
    reducedMotion: opts.reducedMotion,
  })
  const t0 = performance.now()
  const now = () => (performance.now() - t0) / 1000

  let raf = 0
  let visible = true
  let lost = false
  let disposed = false
  let restoreTimer: ReturnType<typeof setTimeout> | null = null
  let cpuSum = 0
  let intervalSum = 0
  let frames = 0
  let lastFrameAt = 0

  function frame(): void {
    raf = 0
    if (disposed || lost || !visible) return
    const start = performance.now()
    view.update(now())
    renderer.render(view.scene, view.camera)
    const end = performance.now()
    cpuSum += end - start
    if (lastFrameAt) intervalSum += start - lastFrameAt
    lastFrameAt = start
    frames++
    raf = requestAnimationFrame(frame)
  }

  function kick(): void {
    if (!raf && !disposed && !lost && visible) {
      lastFrameAt = 0
      raf = requestAnimationFrame(frame)
    }
  }

  // Auto-heal a lost context: three rebuilds its GL state on restore; if the
  // browser never restores it, hand back to the host to remount a fresh canvas.
  const onLost = (e: Event) => {
    e.preventDefault()
    lost = true
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    restoreTimer = setTimeout(() => {
      if (lost && !disposed) opts.onFatal()
    }, RESTORE_TIMEOUT_MS)
  }
  const onRestored = () => {
    lost = false
    if (restoreTimer) clearTimeout(restoreTimer)
    restoreTimer = null
    kick()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  const avatar: AvatarController = {
    get state() {
      return view.animator.state
    },
    setState: (state) => view.animator.setState(state, now()),
    setTalkLevel: (level) => view.animator.setTalkLevel(level),
    poke: () => view.animator.react('poke', now()),
    react: (kind, dir = 1) => view.animator.react(kind, now(), dir),
    lookAt: (x, y) => view.animator.lookAt(x, y),
    clearLook: () => view.animator.clearLook(),
  }

  kick()

  return {
    avatar,
    resize(width, height, dpr) {
      if (width <= 0 || height <= 0) return
      renderer.setPixelRatio(Math.min(Math.max(dpr, 1), 2))
      renderer.setSize(width, height, false)
      view.setAspect(width / height)
      // Draw now so a resize never shows a stretched or empty frame.
      if (!lost && !disposed) {
        view.update(now())
        renderer.render(view.scene, view.camera)
      }
    },
    setVisible(v) {
      visible = v
      if (v) kick()
      else if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    },
    setReducedMotion(reduced) {
      view.animator.setReducedMotion(reduced)
    },
    setConfig(config) {
      view.setConfig(config)
    },
    stats() {
      return {
        frameMs: frames ? cpuSum / frames : 0,
        intervalMs: frames > 1 ? intervalSum / (frames - 1) : 0,
        frames,
      }
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      if (restoreTimer) clearTimeout(restoreTimer)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      view.dispose()
      renderer.dispose()
      // Hand the context back now rather than at GC: the browser caps live
      // contexts (~16) and a remount must never push an older one out.
      renderer.forceContextLoss()
    },
  }
}
