import { cn } from '@/lib/cn'

/**
 * A bot's face in the roster and at the top of its thread.
 *
 * Three fallbacks, in order: the avatar image the bot was given, its emoji, and
 * its initial. A roster where every row is the same generic mark is a roster
 * you cannot scan, which is the one thing the sidebar exists to do.
 *
 * The tint is derived from the id rather than stored, so a bot looks the same in
 * every window and after every restart without anything having to persist it.
 */

/**
 * A bot's colour, and the only saturated colour in the chrome.
 *
 * Solid rather than a tinted outline: at 24–36px an outlined chip reads as an
 * empty slot, and these have to be identifiable at a glance down a roster.
 */
const TINTS = [
  { face: 'bg-teal-400', text: 'text-teal-300' },
  { face: 'bg-amber-500', text: 'text-amber-300' },
  { face: 'bg-indigo-400', text: 'text-indigo-300' },
  { face: 'bg-violet-500', text: 'text-violet-300' },
  { face: 'bg-blue-500', text: 'text-blue-300' },
  { face: 'bg-orange-500', text: 'text-orange-300' },
  { face: 'bg-emerald-500', text: 'text-emerald-300' },
  { face: 'bg-rose-400', text: 'text-rose-300' },
] as const

function tintIndex(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return hash % TINTS.length
}

export function tintForBot(id: string): string {
  return TINTS[tintIndex(id)]!.face
}

/** The same colour as text, for a name inside a bubble. */
export function textTintForBot(id: string): string {
  return TINTS[tintIndex(id)]!.text
}

export function BotAvatar({
  id,
  name,
  emoji,
  avatar,
  size = 36,
  className,
}: {
  id: string
  name: string
  emoji?: string | null
  avatar?: string | null
  size?: number
  className?: string
}) {
  // Only remote and inline images are rendered. A workspace-relative path has
  // no meaning in the renderer, and turning one into a `file://` URL would give
  // page context a read primitive on the user's disk.
  const src = avatar && /^(https?:|data:)/.test(avatar) ? avatar : null

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        tintForBot(id),
        className,
      )}
      style={{ width: size, height: size }}
      title={name}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : emoji ? (
        <span style={{ fontSize: size * 0.5, lineHeight: 1 }}>{emoji}</span>
      ) : (
        <span
          className="font-semibold text-black/70"
          style={{ fontSize: size * 0.4, lineHeight: 1 }}
        >
          {name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </div>
  )
}
