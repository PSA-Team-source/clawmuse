import { useMemo } from 'react'
import { AvatarBadge, type AvatarState } from '@/features/avatar'
import { cn } from '@/lib/cn'
import { useAgentAvatar, useAgentIdentity } from '@/lib/identity'

/**
 * The agent's face: the avatar image the user gave it, else the live ClawMuse
 * avatar. The identity emoji (🦞 by default) is not a face for the main
 * agent — it stays in the identity file, the avatar is what people see.
 * `state` animates the live avatar (idle unless the caller knows better).
 */
export function AgentAvatar({ size, className, state = 'idle', talkLevel = 0 }: { size: number; className?: string; state?: AvatarState; talkLevel?: number }) {
  const identity = useAgentIdentity()
  const image = useAgentAvatar(identity.data)
  const name = identity.data?.name?.trim()
  const config = useMemo(() => ({ name }), [name])
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-panel', className)} style={{ width: size, height: size }}>
      {image ? <img src={image} alt="" className="size-full object-cover" /> : <AvatarBadge config={config} state={state} talkLevel={talkLevel} size={size} />}
    </span>
  )
}
