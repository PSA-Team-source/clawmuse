import { Icon } from '@/components/primitives'
import { cn } from '@/lib/cn'
import { AGENT_STATUS, type AgentStatus } from '@/lib/agent-status'

const TONE = {
  success: 'text-success',
  neutral: 'text-content-secondary',
  warning: 'text-warning',
  danger: 'text-error',
} as const

/**
 * Muse's HatchAgentStateLabel. Inline (under the name in the chat nav) it only
 * appears when something is happening; in the status panel it always shows.
 */
export function AgentStateLabel({ status, variant, className }: { status: AgentStatus; variant: 'inline' | 'panel'; className?: string }) {
  if (variant === 'inline' && status === 'connected') return null
  const { label, icon, tone } = AGENT_STATUS[status]
  return (
    <span role="status" className={cn('flex min-w-0 items-center gap-1', variant === 'panel' ? 'text-footnote text-content-secondary' : TONE[tone], className)}>
      <Icon icon={icon} size={variant === 'panel' ? 16 : 12} className={cn('shrink-0', TONE[tone])} />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}
