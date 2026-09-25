import { ClawMuseLogo } from '@/components/brand'
import { cn } from '@/lib/cn'
import { useAgentAvatar, useAgentIdentity } from '@/lib/identity'

/** The agent's face: its avatar image, else its emoji, else the ClawMuse mark. */
export function AgentAvatar({ size, className }: { size: number; className?: string }) {
  const identity = useAgentIdentity()
  const image = useAgentAvatar(identity.data)
  const emoji = !image ? identity.data?.emoji?.trim() : undefined
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-panel', className)} style={{ width: size, height: size }}>
      {image ? <img src={image} alt="" className="size-full object-cover" /> : emoji ? <span aria-hidden style={{ fontSize: size * 0.55, lineHeight: 1 }}>{emoji}</span> : <ClawMuseLogo size={Math.round(size * 0.77)} variant="badge" />}
    </span>
  )
}
