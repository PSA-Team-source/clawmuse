import { cn } from '@/lib/cn'

/**
 * Splash shown while the 3D engine initialises. Mobile used a Reanimated
 * `exiting={FadeOut.duration(600)}` + a `withRepeat` pulse; desktop achieves
 * both with plain CSS — a `transition-opacity` on the wrapper for the fade-out,
 * and the existing `.animate-fb-pulse` keyframe (global.css) for the pulse,
 * which already runs the same 1500ms cadence as the mobile `animation.pulse`
 * token. Left permanently mounted (pointer-events-none, opacity-driven)
 * rather than conditionally rendered, so the fade-out transition can actually
 * play instead of being cut by an unmount.
 */
export function RoomLoadingOverlay({ visible }: { visible: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-room-void transition-opacity duration-(--duration-slow)',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <span className="animate-fb-pulse font-display text-body tracking-display-widest text-content-body">
        INITIALIZING
      </span>
    </div>
  )
}
