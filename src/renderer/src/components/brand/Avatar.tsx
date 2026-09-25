import { cn } from '@/lib/cn'
import { ClawMuseLogo } from './ClawMuseLogo'

interface AvatarProps {
  name?: string
  kind?: 'user' | 'bot'
  size?: number
  className?: string
}

function initial(name?: string): string {
  return name?.trim().charAt(0).toUpperCase() || '?'
}

/** Circular identity chip — indigo/fang for the bot, orange/initial for the user. */
export function Avatar({ name, kind = 'user', size = 36, className }: AvatarProps) {
  const isBot = kind === 'bot'

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border',
        isBot ? 'border-primary/40 bg-primary/20' : 'border-seam-orange/40 bg-seam-orange/20',
        className,
      )}
      style={{ width: size, height: size }}
      title={isBot ? 'ClawMuse' : (name ?? 'You')}
    >
      {isBot ? (
        <ClawMuseLogo size={size * 0.44} className="text-primary-light" />
      ) : (
        <span className="font-semibold text-content-primary" style={{ fontSize: size * 0.4 }}>
          {initial(name)}
        </span>
      )}
    </div>
  )
}
