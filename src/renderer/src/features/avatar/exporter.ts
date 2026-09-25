/**
 * Stills and clips of the avatar, rendered frame by frame.
 *
 * Every export replays the animator from t = 0 at a fixed step, so the same
 * config + options always produce the same pixels — a share link and the file
 * someone downloads show the identical frame. Talking exports have no live
 * voice, so they are driven by `syntheticTalk` (deterministic in the seed).
 */
import type * as THREE from 'three'
import { syntheticTalk, type AvatarState } from './animator'
import { resolveAvatarConfig, type AvatarConfig, type ResolvedAvatarConfig } from './config'
import { encodeGifAsync } from './gif'
import { createAvatarRenderer, createAvatarView, type AvatarFraming, type AvatarView } from './scene'

export interface ExportCommon {
  state?: AvatarState
  /** Output edge in pixels (square). */
  size?: number
  /** Transparent background (default true). */
  transparent?: boolean
  /** Background when not transparent. Default: the app's dark base. */
  background?: string
  framing?: AvatarFraming
  /**
   * Draw the avatar into a larger picture (a share clip: avatar beside a
   * card). Transparent defaults to false when set.
   */
  compose?: ExportCompose
}

export interface ExportCompose {
  /** Output size in pixels, each 16..MAX_SIZE. */
  width: number
  height: number
  /**
   * Draws one output frame onto a cleared canvas. `avatar` holds this frame
   * of the avatar (`size` square, transparent). Must depend only on `t` — the
   * export is deterministic only if this is.
   */
  draw(ctx: CanvasRenderingContext2D, avatar: CanvasImageSource, t: number): void
}

export interface PngOptions extends ExportCommon {
  /** Animation time of the still, seconds. Default 0.6 (settled, mid-gesture). */
  time?: number
}

export interface ClipOptions extends ExportCommon {
  seconds?: number
  fps?: number
  /**
   * Animation time of the first frame, seconds (default 0). Starting a
   * periodic state one period in makes the last frame lead back into the
   * first, so the clip loops without a seam.
   */
  offset?: number
}

const STEP = 1 / 60
const DEFAULT_BG = '#181819'
const MAX_SIZE = 2048

class FrameRenderer {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  private readonly glCanvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  readonly view: AvatarView
  private simT = 0
  private readonly talk: boolean

  constructor(
    private readonly config: ResolvedAvatarConfig,
    private readonly opts: ReturnType<typeof normalize>['opts'],
  ) {
    const size = opts.size
    this.glCanvas = document.createElement('canvas')
    this.renderer = createAvatarRenderer({ canvas: this.glCanvas, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(size, size, false)
    this.view = createAvatarView(config, { framing: opts.framing, state: opts.state })
    this.view.setAspect(1)
    this.talk = opts.state === 'talking'
    this.canvas = document.createElement('canvas')
    this.canvas.width = opts.compose?.width ?? size
    this.canvas.height = opts.compose?.height ?? size
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D canvas unavailable')
    this.ctx = ctx
  }

  /** Advances the simulation to `t` in fixed steps and draws that frame. */
  drawAt(t: number): void {
    const animator = this.view.animator
    while (this.simT + STEP <= t + 1e-9) {
      this.simT += STEP
      if (this.talk) animator.setTalkLevel(syntheticTalk(this.simT, this.config.seed))
      animator.sample(this.simT)
    }
    if (this.talk) animator.setTalkLevel(syntheticTalk(t, this.config.seed))
    this.view.update(t)
    this.renderer.render(this.view.scene, this.view.camera)
    const { transparent, background, compose } = this.opts
    const { width, height } = this.canvas
    this.ctx.clearRect(0, 0, width, height)
    if (!transparent) {
      this.ctx.fillStyle = background
      this.ctx.fillRect(0, 0, width, height)
    }
    if (compose) compose.draw(this.ctx, this.glCanvas, t)
    else this.ctx.drawImage(this.glCanvas, 0, 0)
  }

  frame(): ImageData {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
  }

  dispose(): void {
    this.view.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

function normalize(config: AvatarConfig | ResolvedAvatarConfig | undefined, o: ExportCommon) {
  const resolved = isResolved(config) ? config : resolveAvatarConfig(config)
  const size = Math.round(Math.min(MAX_SIZE, Math.max(16, o.size ?? 512)))
  const compose = o.compose
  if (compose && ![compose.width, compose.height].every((n) => Number.isInteger(n) && n >= 16 && n <= MAX_SIZE)) {
    throw new RangeError(`Composed export size must be whole pixels in 16..${MAX_SIZE}`)
  }
  return {
    config: resolved,
    opts: {
      state: o.state ?? 'idle',
      size,
      transparent: o.transparent ?? !compose,
      background: o.background ?? DEFAULT_BG,
      framing: o.framing ?? 'full',
      compose,
    } as const,
  }
}

function isResolved(c: unknown): c is ResolvedAvatarConfig {
  return !!c && typeof c === 'object' && typeof (c as ResolvedAvatarConfig).seed === 'number' && typeof (c as ResolvedAvatarConfig).colors?.outfit === 'number'
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encode failed'))), type)
  })
}

/** A PNG still of the avatar. */
export async function exportPng(config: AvatarConfig | ResolvedAvatarConfig | undefined, options: PngOptions = {}): Promise<Blob> {
  const { config: resolved, opts } = normalize(config, options)
  const fr = new FrameRenderer(resolved, opts)
  try {
    fr.drawAt(Math.max(0, options.time ?? 0.6))
    return await toBlob(fr.canvas, 'image/png')
  } finally {
    fr.dispose()
  }
}

/** The WebM variant this browser can record, preferring codecs that keep alpha. */
export function pickClipMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}

/**
 * A WebM clip. Frames are rendered deterministically but the recorder runs on
 * the wall clock, so this takes `seconds` of real time; keep the window
 * visible while it records (a hidden window throttles timers).
 */
export async function exportClip(config: AvatarConfig | ResolvedAvatarConfig | undefined, options: ClipOptions = {}): Promise<Blob> {
  const mimeType = pickClipMimeType()
  if (!mimeType) throw new Error('This system cannot record WebM video')
  const { config: resolved, opts } = normalize(config, options)
  const fps = Math.min(60, Math.max(1, Math.round(options.fps ?? 30)))
  const seconds = Math.min(30, Math.max(0.5, options.seconds ?? 3))
  const frames = Math.round(seconds * fps)
  const offset = Math.max(0, options.offset ?? 0)
  const fr = new FrameRenderer(resolved, opts)
  try {
    const stream = fr.canvas.captureStream(0)
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
    if (!track) throw new Error('Canvas capture unavailable')
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: Math.min(12_000_000, Math.max(1_000_000, fr.canvas.width * fr.canvas.height * fps * 0.12)),
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve()
      recorder.onerror = () => reject(new Error('Recording failed'))
    })
    // Draw frame 0 before starting so the first captured frame is not blank.
    fr.drawAt(offset)
    recorder.start()
    const frameMs = 1000 / fps
    const start = performance.now()
    for (let f = 0; f < frames; f++) {
      fr.drawAt(offset + f / fps)
      track.requestFrame()
      const due = start + (f + 1) * frameMs
      await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())))
    }
    recorder.stop()
    track.stop()
    await stopped
    return new Blob(chunks, { type: mimeType.split(';')[0] })
  } finally {
    fr.dispose()
  }
}

/**
 * An animated GIF (256 colours, 1-bit alpha). Rendered as fast as the GPU
 * allows — no real-time wait — so it is the quick share format.
 */
export async function exportGif(config: AvatarConfig | ResolvedAvatarConfig | undefined, options: ClipOptions = {}): Promise<Blob> {
  const { config: resolved, opts } = normalize(config, { size: 256, ...options })
  const fps = Math.min(50, Math.max(1, Math.round(options.fps ?? 15)))
  const seconds = Math.min(10, Math.max(0.5, options.seconds ?? 2))
  const count = Math.round(seconds * fps)
  const offset = Math.max(0, options.offset ?? 0)
  const fr = new FrameRenderer(resolved, opts)
  try {
    const frames: { data: Uint8ClampedArray }[] = []
    for (let f = 0; f < count; f++) {
      fr.drawAt(offset + f / fps)
      frames.push({ data: fr.frame().data })
      // Yield now and then so a long render never freezes the UI.
      if (f % 8 === 7) await new Promise((r) => setTimeout(r, 0))
    }
    const bytes = await encodeGifAsync(frames, {
      width: fr.canvas.width,
      height: fr.canvas.height,
      frameMs: 1000 / fps,
      transparent: opts.transparent,
    })
    return new Blob([bytes as BlobPart], { type: 'image/gif' })
  } finally {
    fr.dispose()
  }
}
