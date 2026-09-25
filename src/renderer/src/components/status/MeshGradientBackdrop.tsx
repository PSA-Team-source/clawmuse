import { lazy, Suspense, useEffect, useRef, useState } from 'react'

// Muse loads the same Paper Design shader on demand (hatchMeshGradientLoader).
const MeshGradient = lazy(() => import('@paper-design/shaders-react').then((module) => ({ default: module.MeshGradient })))

/**
 * Muse HatchMeshGradientBackdrop: the first colour as the static backdrop,
 * then the animated mesh gradient once the card has been on screen. It stops
 * moving when scrolled away and never animates under reduced motion.
 */
export function MeshGradientBackdrop({ colors, distortion = 0.8, swirl = 0.1, speed = 1, rotation }: { colors: string[]; distortion?: number; swirl?: number; speed?: number; rotation?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [seen, setSeen] = useState(false)
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      setInView(Boolean(entry?.isIntersecting))
      if (entry?.isIntersecting) setSeen(true)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden
      className="absolute inset-0"
      style={{ backgroundColor: colors[0], ...(rotation ? { transform: `rotate(${rotation}deg) scale(1.5)` } : null) }}
    >
      {seen && !reducedMotion && (
        <Suspense fallback={null}>
          <div className="size-full motion-safe:animate-[muse-typing-in_700ms_ease-out]">
            <MeshGradient style={{ width: '100%', height: '100%' }} colors={colors} distortion={distortion} swirl={swirl} grainMixer={0.3} grainOverlay={0.15} speed={inView ? speed : 0} />
          </div>
        </Suspense>
      )}
    </div>
  )
}
