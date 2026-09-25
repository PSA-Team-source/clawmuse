import {
  AlertCircleIcon,
  FlashIcon,
  FlashOffIcon,
  InformationCircleIcon,
  LeftToRightListBulletIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import type { ConnectionState, Message } from '@/types'
import { useApprovalsStore } from '@/stores/approvals.store'
import { useChatStore } from '@/stores/chat.store'
import { useGatewayStore } from '@/stores/gateway.store'
import { usePluginApprovalsStore } from '@/stores/plugin-approvals.store'
import { useQuestionsStore } from '@/stores/questions.store'

/**
 * Muse's status chrome (useHatchStatusChromeState): one word for what the
 * agent is doing, shown under its name in the chat nav and the status panel.
 * Connection problems win, then out-of-usage, then a pending approval, then
 * the run phase. An agent question waiting on the user counts as a pending
 * approval: Muse has one "pending user confirmation" state and calls it
 * "Needs approval".
 */
export type AgentStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'connection_error'
  | 'out_of_credits'
  | 'awaiting_approval'
  | 'working'
  | 'responding'

export interface AgentStatusInput {
  connection: ConnectionState
  pendingApprovals: number
  busy: boolean
  streamingText: boolean
  lastMessage?: Pick<Message, 'role' | 'status' | 'content'>
}

/** The notice chat.store writes for a billing failure (failureNotice). */
const OUT_OF_CREDITS = /^Your model provider has no credits left/

export function agentStatusFor(input: AgentStatusInput): AgentStatus {
  if (input.connection === 'error') return 'connection_error'
  if (input.connection === 'disconnected') return 'disconnected'
  if (input.connection !== 'connected') return 'connecting'
  if (input.pendingApprovals > 0) return 'awaiting_approval'
  if (input.busy) return input.streamingText ? 'responding' : 'working'
  const last = input.lastMessage
  if (last?.role === 'assistant' && last.status === 'failed' && OUT_OF_CREDITS.test(last.content)) return 'out_of_credits'
  return 'connected'
}

/** Muse getHatchStatusChromeLabel / Icon / inline text colour, per state. */
export const AGENT_STATUS: Record<AgentStatus, { label: string; icon: unknown; tone: 'success' | 'neutral' | 'warning' | 'danger' }> = {
  connected: { label: 'Connected', icon: FlashIcon, tone: 'success' },
  connecting: { label: 'Connecting...', icon: FlashIcon, tone: 'neutral' },
  disconnected: { label: 'Disconnected', icon: FlashOffIcon, tone: 'neutral' },
  connection_error: { label: 'Connection error', icon: AlertCircleIcon, tone: 'danger' },
  out_of_credits: { label: 'Out of usage', icon: AlertCircleIcon, tone: 'danger' },
  awaiting_approval: { label: 'Needs approval', icon: InformationCircleIcon, tone: 'warning' },
  working: { label: 'Working', icon: Wrench01Icon, tone: 'neutral' },
  responding: { label: 'Responding', icon: LeftToRightListBulletIcon, tone: 'neutral' },
}

export function useAgentStatus(sessionId: string | null | undefined): AgentStatus {
  const connection = useGatewayStore((state) => state.connectionState)
  const execPending = useApprovalsStore((state) => state.queue.length)
  const pluginPending = usePluginApprovalsStore((state) => state.queue.length)
  const questionsPending = useQuestionsStore((state) => state.pending.length)
  const busy = useChatStore((state) => (sessionId ? Boolean(state.isTyping[sessionId]) : false))
  const streamingText = useChatStore((state) => (sessionId ? Boolean(state.streamingText[sessionId]) : false))
  const lastMessage = useChatStore((state) => (sessionId ? state.messages[sessionId]?.at(-1) : undefined))
  return agentStatusFor({ connection, pendingApprovals: execPending + pluginPending + questionsPending, busy, streamingText, lastMessage })
}
