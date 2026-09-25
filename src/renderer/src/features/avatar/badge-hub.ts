/**
 * Small avatars, many at once, one WebGL context.
 *
 * Browsers cap live WebGL contexts (~16 in Chromium; the oldest is silently
 * killed past that), so a list of 30 avatars cannot each own one. Instead a
 * single offscreen renderer draws every avatar in turn at a low frame rate
 * and copies each result into that badge's plain 2D canvas.
 *
 * Badges that show the same avatar in the same state share one render: ten
 * copies of the ClawMuse badge cost one draw, not ten.
 */
import type { WebGLRenderer } from 'three'
import { isAvatarState, type AvatarState } from './animator'
import { avatarConfigKey, type ResolvedAvatarConfig } from './config'
import { createAvatarRenderer, createAvatarView, type AvatarView } from './scene'

export const BADGE_FPS = 12
const REDUCED_MOTION_FPS = 4
/** Keep the context this long after the last badge leaves (list re-renders). */
const IDLE_RELEASE_MS = 5000
const MAX_RENDERER_FAILURES = 3

export interface BadgeHandle {
  update(next: { config: ResolvedAvatarConfig; state: AvatarState; talkLevel?: number }): void
  setSize(cssSize: number, dpr: number): void
  setVisible(visible: boolean): void
  unsubscribe(): void
}

interface Sub {
  ctx: CanvasRenderingContext2D
  canvas: HTMLCanvasElement
  px: number
  visible: boolean
  entry: Entry
  talkLevel: number
  onFallback: () => void
}

interface Entry {
  key: string
  view: AvatarView
  subs: Set<Sub>
  state: AvatarState
}

class BadgeHub {
  private renderer: WebGLRenderer | null = null
  private glCanvas: HTMLCanvasElement | null = null
  private bufferPx = 0
  private entries = new Map<string, Entry>()
  private subs = new Set<Sub>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private failed = false
  private readonly t0 = performance.now()
  private reducedMotion = false
  private tickCount = 0
  private tickSum = 0

  constructor() {
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)')
      this.reducedMotion = mq.matches
      mq.addEventListener?.('change', (e) => {
        this.reducedMotion = e.matches
        for (const entry of this.entries.values()) entry.view.animator.setReducedMotion(e.matches)
      })
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.schedule(0)
    })
  }

  get hasFailed(): boolean {
    return this.failed
  }

  /** Mean ms per hub tick (all badges), for the dev lab. */
  stats(): { tickMs: number; ticks: number; entries: number; badges: number } {
    return {
      tickMs: this.tickCount ? this.tickSum / this.tickCount : 0,
      ticks: this.tickCount,
      entries: this.entries.size,
      badges: this.subs.size,
    }
  }

  resetStats(): void {
    this.tickCount = 0
    this.tickSum = 0
  }

  subscribe(
    canvas: HTMLCanvasElement,
    init: { config: ResolvedAvatarConfig; state: AvatarState; cssSize: number; dpr: number; talkLevel?: number },
    onFallback: () => void,
  ): BadgeHandle | null {
    if (this.failed) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer)
      this.releaseTimer = null
    }
    const sub: Sub = {
      ctx,
      canvas,
      px: 0,
      visible: true,
      entry: this.acquire(init.config, init.state),
      talkLevel: init.talkLevel ?? 0,
      onFallback,
    }
    this.subs.add(sub)
    sub.entry.subs.add(sub)
    const setSize = (cssSize: number, dpr: number) => {
      const px = Math.max(1, Math.round(cssSize * Math.min(Math.max(dpr, 1), 2)))
      if (px === sub.px) return
      sub.px = px
      canvas.width = px
      canvas.height = px
    }
    setSize(init.cssSize, init.dpr)
    this.schedule(0)

    return {
      update: ({ config, state, talkLevel }) => {
        const key = entryKey(config, state)
        if (key !== sub.entry.key) {
          const prev = sub.entry
          sub.entry = this.acquire(config, state)
          prev.subs.delete(sub)
          sub.entry.subs.add(sub)
          this.releaseEntry(prev)
        }
        sub.talkLevel = talkLevel ?? 0
        this.schedule(0)
      },
      setSize: (cssSize, dpr) => {
        setSize(cssSize, dpr)
        this.schedule(0)
      },
      setVisible: (v) => {
        sub.visible = v
        if (v) this.schedule(0)
      },
      unsubscribe: () => {
        this.subs.delete(sub)
        sub.entry.subs.delete(sub)
        this.releaseEntry(sub.entry)
        if (this.subs.size === 0) this.scheduleRelease()
      },
    }
  }

  private acquire(config: ResolvedAvatarConfig, state: AvatarState): Entry {
    const key = entryKey(config, state)
    let entry = this.entries.get(key)
    if (!entry) {
      const view = createAvatarView(config, { framing: 'bust', state, reducedMotion: this.reducedMotion })
      entry = { key, view, subs: new Set(), state }
      this.entries.set(key, entry)
    }
    return entry
  }

  private releaseEntry(entry: Entry): void {
    if (entry.subs.size > 0) return
    entry.view.dispose()
    this.entries.delete(entry.key)
  }

  private ensureRenderer(): WebGLRenderer | null {
    if (this.renderer) return this.renderer
    try {
      const canvas = document.createElement('canvas')
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault()
        this.dropRenderer()
        this.failures++
        this.schedule(250 * this.failures)
      })
      this.glCanvas = canvas
      this.renderer = createAvatarRenderer({ canvas, preserveDrawingBuffer: true })
      this.renderer.setPixelRatio(1)
      this.bufferPx = 0
      return this.renderer
    } catch {
      this.dropRenderer()
      this.failures++
      return null
    }
  }

  private dropRenderer(): void {
    try {
      this.renderer?.dispose()
    } catch {}
    this.renderer = null
    this.glCanvas = null
    this.bufferPx = 0
  }

  private giveUp(): void {
    this.failed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const s of [...this.subs]) s.onFallback()
    for (const e of this.entries.values()) e.view.dispose()
    this.entries.clear()
    this.subs.clear()
    this.dropRenderer()
  }

  private schedule(delayMs: number): void {
    if (this.failed || this.subs.size === 0) return
    if (this.timer && delayMs > 0) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.tick()
    }, delayMs)
  }

  private scheduleRelease(): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null
      if (this.subs.size > 0) return
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      const renderer = this.renderer
      this.dropRenderer()
      renderer?.forceContextLoss()
    }, IDLE_RELEASE_MS)
  }

  private tick(): void {
    if (this.failed || this.subs.size === 0) return
    const fps = this.reducedMotion ? REDUCED_MOTION_FPS : BADGE_FPS
    if (document.hidden) return // resumes on visibilitychange
    const started = performance.now()
    if (this.failures >= MAX_RENDERER_FAILURES) {
      this.giveUp()
      return
    }
    const renderer = this.ensureRenderer()
    if (!renderer || !this.glCanvas) {
      this.schedule(500)
      return
    }

    const t = (started - this.t0) / 1000
    let drew = false
    for (const entry of this.entries.values()) {
      // Group this entry's visible badges by pixel size: one render per size.
      const bySize = new Map<number, Sub[]>()
      let talk = 0
      for (const s of entry.subs) {
        if (!s.visible || s.px <= 0) continue
        talk = Math.max(talk, s.talkLevel)
        const list = bySize.get(s.px)
        if (list) list.push(s)
        else bySize.set(s.px, [s])
      }
      if (bySize.size === 0) continue
      entry.view.animator.setTalkLevel(talk)
      entry.view.update(t)
      for (const [px, list] of bySize) {
        if (px > this.bufferPx) {
          this.bufferPx = Math.max(px, Math.ceil(this.bufferPx * 1.5), 64)
          renderer.setSize(this.bufferPx, this.bufferPx, false)
        }
        renderer.setViewport(0, 0, px, px)
        renderer.setScissor(0, 0, px, px)
        renderer.setScissorTest(true)
        renderer.render(entry.view.scene, entry.view.camera)
        // GL's origin is bottom-left; the viewport sits in the bottom rows.
        const sy = this.bufferPx - px
        for (const s of list) {
          s.ctx.clearRect(0, 0, px, px)
          s.ctx.drawImage(this.glCanvas, 0, sy, px, px, 0, 0, px, px)
        }
        drew = true
      }
    }
    if (drew) {
      this.failures = 0
      this.tickSum += performance.now() - started
      this.tickCount++
    }
    // Fixed cadence from the tick start, so slow ticks do not drift the rate.
    this.schedule(Math.max(1, 1000 / fps - (performance.now() - started)))
  }
}

function entryKey(config: ResolvedAvatarConfig, state: AvatarState): string {
  return `${avatarConfigKey(config)}#${isAvatarState(state) ? state : 'idle'}`
}

let hub: BadgeHub | null = null
export function getBadgeHub(): BadgeHub {
  hub ??= new BadgeHub()
  return hub
}
