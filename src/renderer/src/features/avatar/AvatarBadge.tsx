import { useEffect, useMemo, useRef, useState } from 'react'
import { ClawMuseLogo } from '@/components/brand/ClawMuseLogo'
import { cn } from '@/lib/cn'
import type { AvatarState } from './animator'
import type { BadgeHandle } from './badge-hub'
import { avatarConfigKey, resolveAvatarConfig, type AvatarConfig } from './config'
import { hasWebGL } from './webgl-support'
import stillUrl from './avatar-still.png'
import { useLook, withLook } from './look'

/**
 * The default ClawMuse's idle bust, shown until the live badge draws its first
 * frame: three.js loads lazily, and for those first seconds every avatar was
 * an empty circle. Captured from the live badge (104 px, transparent).
 * ponytail: a checked-in frame, so it goes stale if the mascot's look changes;
 * re-capture it then (or render it at build time once there is a WebGL build step).
 */
const DEFAULT_KEY = avatarConfigKey(resolveAvatarConfig(undefined))

export interface AvatarBadgeProps {
  config?: AvatarConfig
  state?: AvatarState
  /** Edge in CSS pixels (24–100 is the intended range). */
  size?: number
  talkLevel?: number
  className?: string
}

// One observer for every badge: a long list must not create one per row.
type VisibilityListener = (visible: boolean) => void
const listeners = new WeakMap<Element, VisibilityListener>()
let sharedObserver: IntersectionObserver | null = null
function observe(el: Element, fn: VisibilityListener): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {}
  sharedObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
  })
  listeners.set(el, fn)
  sharedObserver.observe(el)
  return () => {
    listeners.delete(el)
    sharedObserver?.unobserve(el)
  }
}

/**
 * A small live avatar, head and shoulders, drawn by the shared badge renderer
 * (one WebGL context for every badge on screen) at a low frame rate.
 * Falls back to the ClawMuse logo badge when WebGL is unavailable.
 */
export function AvatarBadge({ config, state = 'idle', size = 40, talkLevel = 0, className }: AvatarBadgeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<BadgeHandle | null>(null)
  const look = useLook()
  const resolved = useMemo(() => resolveAvatarConfig(withLook(config, look)), [config, look])
  const configKey = avatarConfigKey(resolved)
  const [fallback, setFallback] = useState(() => !hasWebGL())
  const latest = useRef({ resolved, state, size, talkLevel })

  useEffect(() => {
    latest.current = { resolved, state, size, talkLevel }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (fallback || !canvas) return
    let disposed = false
    let stopObserving = () => {}
    void import('./badge-hub')
      .then(({ getBadgeHub }) => {
        if (disposed) return
        const cur = latest.current
        const handle = getBadgeHub().subscribe(
          canvas,
          {
            config: cur.resolved,
            state: cur.state,
            cssSize: cur.size,
            dpr: window.devicePixelRatio || 1,
            talkLevel: cur.talkLevel,
          },
          () => setFallback(true),
        )
        if (!handle) {
          setFallback(true)
          return
        }
        handleRef.current = handle
        stopObserving = observe(canvas, (v) => handle.setVisible(v))
      })
      .catch(() => {
        if (!disposed) setFallback(true)
      })
    return () => {
      disposed = true
      stopObserving()
      handleRef.current?.unsubscribe()
      handleRef.current = null
    }
  }, [fallback])

  useEffect(() => {
    handleRef.current?.update({ config: resolved, state, talkLevel })
    // `resolved` is keyed by `configKey`; a new object with the same key is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, state, talkLevel])

  useEffect(() => {
    handleRef.current?.setSize(size, window.devicePixelRatio || 1)
  }, [size])

  if (fallback) {
    return <ClawMuseLogo variant="badge" size={size} className={className} />
  }
  return (
    <canvas
      ref={canvasRef}
      className={cn('avatar-badge block shrink-0', className)}
      style={{ width: size, height: size, ...(configKey === DEFAULT_KEY ? { '--avatar-still': `url(${stillUrl})` } : {}) }}
      role="img"
      aria-label={resolved.name}
      data-avatar-state={state}
    />
  )
}
