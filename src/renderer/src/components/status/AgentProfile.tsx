import { useEffect, useState } from 'react'
import { liveAvatarState } from '@/components/chat/MessageList'
import { useTalkLevel } from '@/features/avatar'
import { useAgentIdentity } from '@/lib/identity'
import { useChatStore } from '@/stores/chat.store'
import type { Message } from '@/types'

const NO_MESSAGES: Message[] = []
/** How long the face waves when a chat opens. */
const GREETING_MS = 2600
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
  // The face above the thread lives the reply: waves when the chat opens,
  // then thinks, works and talks with it (the same state as the reply's face).
  const messages = useChatStore((state) => (sessionId ? state.messages[sessionId] : undefined) ?? NO_MESSAGES)
  const streamingText = useChatStore((state) => (sessionId ? state.streamingText[sessionId] : undefined) ?? '')
  const busy = useChatStore((state) => Boolean(sessionId && (state.isTyping[sessionId] || state.streamingThinking[sessionId])))
  const [greeted, setGreeted] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setGreeted(true), GREETING_MS)
    return () => clearTimeout(timer)
  }, [])
  const live = liveAvatarState(messages, busy || !!streamingText, streamingText)
  const face = live === 'idle' && !greeted ? 'waving' : live
  const talk = useTalkLevel(face, streamingText)
  return (
    <button
      type="button"
      data-testid="agent-profile"
      onClick={toggle}
      aria-expanded={open}
      aria-label={name ? `${name} status` : 'Agent status'}
      className="no-drag flex w-28 max-w-full flex-col items-center"
    >
      <AgentAvatar size={52} state={face} talkLevel={talk} className="relative z-10 shadow-composer" />
      <span className="muse-status-pill muse-status-pill-compact">
        {name && <span className="block max-w-full truncate text-muse-artifact-name font-medium text-content-primary">{name}</span>}
        <AgentStateLabel status={status} variant="inline" className="text-micro" />
      </span>
    </button>
  )
}
