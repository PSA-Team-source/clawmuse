import { useAgentIdentity } from '@/lib/identity'
import { useAgentStatus } from '@/lib/agent-status'
import { useStatusPanel } from '@/stores/status-panel.store'
import { AgentAvatar } from './AgentAvatar'
import { AgentStateLabel } from './AgentStateLabel'

/**
 * Muse's HatchAgentProfile: the agent at the top of the chat — a 52pt avatar (measured)
 * with its name in a white pill, and what it is doing underneath whenever it
 * is doing something. Clicking it toggles the status panel.
 */
export function AgentProfile({ sessionId }: { sessionId: string | null }) {
  const identity = useAgentIdentity()
  const status = useAgentStatus(sessionId)
  const toggle = useStatusPanel((state) => state.toggle)
  const open = useStatusPanel((state) => state.open)
  const name = identity.data?.name?.trim() ?? ''
  return (
    <button
      type="button"
      data-testid="agent-profile"
      onClick={toggle}
      aria-expanded={open}
      aria-label={name ? `${name} status` : 'Agent status'}
      className="no-drag flex w-28 max-w-full flex-col items-center"
    >
      <AgentAvatar size={52} className="relative z-10 shadow-composer" />
      <span className="muse-status-pill muse-status-pill-compact">
        {name && <span className="block max-w-full truncate text-muse-artifact-name font-medium text-content-primary">{name}</span>}
        <AgentStateLabel status={status} variant="inline" className="text-micro" />
      </span>
    </button>
  )
}
