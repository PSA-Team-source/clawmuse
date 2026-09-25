import { useEffect, useRef, useState } from 'react'
import type { AvatarState } from './animator'
import { AvatarStage } from './AvatarStage'
import type { AvatarConfig } from './config'
import { cn } from '@/lib/cn'

/** How long the hello wave lasts before the companion settles. */
const WAVE_MS = 2600

/**
 * The agent in person on an empty screen: waves hello when it appears,
 * celebrates on cue, and a click pokes it (AvatarStage's own gestures).
 *
 * Sized by the viewport height, so a short window shrinks the figure instead
 * of pushing the content below it off-screen.
 */
export function AvatarCompanion({ config, celebrate = false, className }: { config?: AvatarConfig; celebrate?: boolean; className?: string }) {
  const [settled, setSettled] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const state: AvatarState = celebrate ? 'celebrating' : settled ? 'idle' : 'waving'
  return (
    <AvatarStage
      config={config}
      state={state}
      className={cn('aspect-[4/5] h-[clamp(88px,22vh,200px)] shrink-0', className)}
      // The wave is timed from when the figure is on screen — three.js loads
      // lazily, and a wave that ended while it loaded would never be seen.
      onReady={(avatar) => {
        if (!avatar || timer.current) return
        timer.current = setTimeout(() => setSettled(true), WAVE_MS)
      }}
    />
  )
}
