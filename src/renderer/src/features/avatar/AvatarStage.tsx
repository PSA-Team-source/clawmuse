import { useEffect, useMemo, useRef, useState } from 'react'
import { ClawMuseLogo } from '@/components/brand/ClawMuseLogo'
import { cn } from '@/lib/cn'
import type { AvatarState } from './animator'
import { avatarConfigKey, resolveAvatarConfig, type AvatarConfig } from './config'
import type { AvatarFraming } from './scene'
import type { AvatarController, StageEngine, StageStats } from './stage-engine'
import { hasWebGL } from './webgl-support'

export interface AvatarStageProps {
  config?: AvatarConfig
  state?: AvatarState
  /** 0..1, drives the mouth while `state` is `talking`. */
  talkLevel?: number
  framing?: AvatarFraming
  /** Poke / double-click dance / drag spin / eyes follow the cursor. Default true. */
  interactive?: boolean
  className?: string
  /** Receives the controller once the engine is up (and `null` when it goes). */
  onReady?: (avatar: AvatarController | null, stats: () => StageStats) => void
}

const DRAG_SPIN_PX = 28
const DOUBLE_CLICK_MS = 320
const MAX_REMOUNTS = 3

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The big, interactive avatar: transparent background, framed on the figure.
 *
 * Owns one WebGL context for its lifetime. The render loop stops whenever the
 * stage is scrolled off-screen or the window is hidden, and the context is
 * released on unmount. Without WebGL it shows the ClawMuse badge instead.
 */
export function AvatarStage({
  config,
  state = 'idle',
  talkLevel = 0,
  framing = 'full',
  interactive = true,
  className,
  onReady,
}: AvatarStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<StageEngine | null>(null)
  const resolved = useMemo(() => resolveAvatarConfig(config), [config])
  const configKey = avatarConfigKey(resolved)
  const [fallback, setFallback] = useState(() => !hasWebGL())
  // Bumped when a context is lost for good: remounting builds a fresh canvas.
  const [generation, setGeneration] = useState(0)
  const latest = useRef({ resolved, state, talkLevel, onReady })
  useEffect(() => {
    latest.current = { resolved, state, talkLevel, onReady }
  })

  useEffect(() => {
    const host = hostRef.current
    if (fallback || !host) return
    let disposed = false
    let engine: StageEngine | null = null
    let resizeObserver: ResizeObserver | null = null
    let intersection: IntersectionObserver | null = null
    let onScreen = true
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    // A fresh canvas per engine: a canvas whose context was released can
    // never produce a working context again.
    const canvas = document.createElement('canvas')
    canvas.className = 'block h-full w-full'
    canvas.setAttribute('aria-hidden', 'true')
    host.appendChild(canvas)

    const syncVisible = () => engine?.setVisible(onScreen && !document.hidden)
    const onMotion = (e: MediaQueryListEvent) => engine?.setReducedMotion(e.matches)

    void import('./stage-engine')
      .then(({ createStageEngine }) => {
        if (disposed) return
        const { resolved: cfg, state: st } = latest.current
        engine = createStageEngine({
          canvas,
          config: cfg,
          framing,
          state: st,
          reducedMotion: prefersReducedMotion(),
          onFatal: () => {
            if (generation + 1 >= MAX_REMOUNTS) setFallback(true)
            else setGeneration((g) => g + 1)
          },
        })
        engineRef.current = engine
        engine.avatar.setTalkLevel(latest.current.talkLevel)
        const rect = host.getBoundingClientRect()
        engine.resize(rect.width, rect.height, window.devicePixelRatio || 1)
        resizeObserver = new ResizeObserver(([entry]) => {
          if (!entry) return
          engine?.resize(entry.contentRect.width, entry.contentRect.height, window.devicePixelRatio || 1)
        })
        resizeObserver.observe(host)
        intersection = new IntersectionObserver(([entry]) => {
          onScreen = !!entry?.isIntersecting
          syncVisible()
        })
        intersection.observe(host)
        document.addEventListener('visibilitychange', syncVisible)
        mq?.addEventListener('change', onMotion)
        syncVisible()
        const e = engine
        latest.current.onReady?.(e.avatar, () => e.stats())
      })
      .catch(() => {
        if (!disposed) setFallback(true)
      })

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      intersection?.disconnect()
      document.removeEventListener('visibilitychange', syncVisible)
      mq?.removeEventListener('change', onMotion)
      if (engine) {
        latest.current.onReady?.(null, () => ({ frameMs: 0, intervalMs: 0, frames: 0 }))
        engine.dispose()
      }
      engineRef.current = null
      canvas.remove()
    }
    // `generation` remounts on a lost context; framing changes the camera rig.
  }, [fallback, generation, framing])

  useEffect(() => {
    engineRef.current?.setConfig(latest.current.resolved)
  }, [configKey])

  useEffect(() => {
    engineRef.current?.avatar.setState(state)
  }, [state])

  useEffect(() => {
    engineRef.current?.avatar.setTalkLevel(talkLevel)
  }, [talkLevel])

  // Eyes follow the cursor anywhere in the window, not just over the stage.
  useEffect(() => {
    if (!interactive || fallback) return
    const onMove = (e: PointerEvent) => {
      const host = hostRef.current
      const avatar = engineRef.current?.avatar
      if (!host || !avatar) return
      const r = host.getBoundingClientRect()
      const cx = r.left + r.width / 2
      // The face sits in the upper third of a full-body frame.
      const cy = r.top + r.height * (framing === 'full' ? 0.32 : 0.45)
      const reach = Math.max(r.width, r.height) * 0.9
      avatar.lookAt((e.clientX - cx) / reach, -(e.clientY - cy) / reach)
    }
    const onLeave = () => engineRef.current?.avatar.clearLook()
    window.addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [interactive, fallback, framing])

  // Click = poke, second click = dance, horizontal drag = spin.
  const gesture = useRef<{ x: number; y: number; spun: boolean; id: number } | null>(null)
  const lastClick = useRef(0)
  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0) return
    gesture.current = { x: e.clientX, y: e.clientY, spun: false, id: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || g.spun || g.id !== e.pointerId) return
    const dx = e.clientX - g.x
    if (Math.abs(dx) > DRAG_SPIN_PX) {
      g.spun = true
      engineRef.current?.avatar.react('spin', Math.sign(dx))
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    if (!g || g.id !== e.pointerId || g.spun) return
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 8) return
    const now = performance.now()
    const avatar = engineRef.current?.avatar
    if (now - lastClick.current < DOUBLE_CLICK_MS) {
      avatar?.react('dance')
      lastClick.current = 0
    } else {
      avatar?.poke()
      lastClick.current = now
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      engineRef.current?.avatar.poke()
    }
  }

  if (fallback) {
    return (
      <div className={cn('flex items-center justify-center', className)} role="img" aria-label={resolved.name}>
        <ClawMuseLogo variant="badge" size={96} />
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      className={cn('relative touch-none select-none', interactive && 'cursor-grab active:cursor-grabbing', className)}
      role={interactive ? 'button' : 'img'}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${resolved.name} — press to poke` : resolved.name}
      data-avatar-state={state}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (gesture.current = null)}
      onKeyDown={interactive ? onKeyDown : undefined}
    />
  )
}
