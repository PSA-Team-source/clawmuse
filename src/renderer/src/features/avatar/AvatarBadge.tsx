import { useEffect, useMemo, useRef, useState } from 'react'
import { ClawMuseLogo } from '@/components/brand/ClawMuseLogo'
import { cn } from '@/lib/cn'
import type { AvatarState } from './animator'
import type { BadgeHandle } from './badge-hub'
import { avatarConfigKey, resolveAvatarConfig, type AvatarConfig } from './config'
import { hasWebGL } from './webgl-support'

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
  const resolved = useMemo(() => resolveAvatarConfig(config), [config])
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
      className={cn('block shrink-0', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={resolved.name}
    />
  )
}
