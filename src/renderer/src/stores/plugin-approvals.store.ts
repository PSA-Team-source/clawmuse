import { create } from 'zustand'
import { gatewayWS } from '@/services/gateway-ws.service'
import { historyFromResolved, useApprovalHistoryStore, useApprovalsStore, type ApprovalOutcome } from '@/stores/approvals.store'
import type { GatewayEventFrame } from '@/types'

/**
 * OpenClaw plugin approvals (plugin.approval.*) — raised by plugins before a
 * sensitive action, e.g. the 1Password broker behind Settings > Wallet asking
 * to use a payment card. Separate from exec approvals: different methods,
 * and three decisions instead of two.
 */

export type PluginDecision = 'allow-once' | 'allow-always' | 'deny'

export interface PluginApproval {
  id: string
  title: string
  description: string
  severity: 'info' | 'warning' | 'critical'
  pluginId?: string | null
  agentId?: string | null
  allowedDecisions: PluginDecision[]
  expiresAtMs?: number
  /** When the plugin asked — the gateway stamps `createdAtMs` on the event. */
  createdAtMs?: number
}

const ALL: PluginDecision[] = ['allow-once', 'allow-always', 'deny']

export function parsePluginApproval(raw: unknown): PluginApproval | null {
  const event = raw as { id?: unknown; request?: Record<string, unknown>; expiresAtMs?: unknown; createdAtMs?: unknown } | null
  const request = event?.request
  if (!event || typeof event.id !== 'string' || !request || typeof request.title !== 'string') return null
  const allowed = Array.isArray(request.allowedDecisions) ? request.allowedDecisions.filter((d): d is PluginDecision => ALL.includes(d as PluginDecision)) : []
  const severity = request.severity === 'info' || request.severity === 'critical' ? request.severity : 'warning'
  return {
    id: event.id,
    title: request.title,
    description: typeof request.description === 'string' ? request.description : '',
    severity,
    pluginId: typeof request.pluginId === 'string' ? request.pluginId : null,
    agentId: typeof request.agentId === 'string' ? request.agentId : null,
    allowedDecisions: allowed.length ? allowed : ALL,
    expiresAtMs: typeof event.expiresAtMs === 'number' ? event.expiresAtMs : undefined,
    createdAtMs: typeof event.createdAtMs === 'number' ? event.createdAtMs : undefined,
  }
}

function pluginEntry(approval: PluginApproval, outcome: ApprovalOutcome) {
  return { id: approval.id, kind: 'plugin' as const, title: approval.title, detail: approval.description || undefined, agentId: approval.agentId ?? null, outcome, decidedAtMs: Date.now() }
}

/** One timer per pending request that carries a deadline — the gateway expires them without an event. */
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

interface PluginApprovalsState {
  queue: PluginApproval[]
  handleEvent: (frame: GatewayEventFrame) => void
  load: () => Promise<void>
  resolve: (id: string, decision: PluginDecision) => Promise<void>
}

export const usePluginApprovalsStore = create<PluginApprovalsState>((set, get) => {
  function drop(id: string): PluginApproval | undefined {
    const found = get().queue.find((item) => item.id === id)
    set({ queue: get().queue.filter((item) => item.id !== id) })
    clearTimeout(expiryTimers.get(id))
    expiryTimers.delete(id)
    return found
  }

  function add(incoming: PluginApproval[]): void {
    const known = new Set(get().queue.map((item) => item.id))
    const fresh = incoming.filter((item) => !known.has(item.id))
    if (!fresh.length) return
    set({ queue: [...get().queue, ...fresh] })
    for (const approval of fresh) {
      if (approval.expiresAtMs == null) continue
      expiryTimers.set(approval.id, setTimeout(() => {
        const expired = drop(approval.id)
        if (expired) useApprovalHistoryStore.getState().record(pluginEntry(expired, 'timed-out'))
      }, Math.max(0, approval.expiresAtMs - Date.now())))
    }
  }

  return {
    queue: [],
    handleEvent(frame) {
      const payload = frame.payload ?? frame.data
      // This is the store the gateway's event funnel feeds, so exec approvals
      // route through here to reach theirs.
      if (frame.event.startsWith('exec.approval.')) {
        useApprovalsStore.getState().handleEvent(frame)
      } else if (frame.event === 'plugin.approval.requested') {
        const approval = parsePluginApproval(payload)
        if (approval) add([approval])
      } else if (frame.event === 'plugin.approval.resolved') {
        const id = (payload as { id?: unknown } | undefined)?.id
        if (typeof id === 'string') drop(id)
        const entry = historyFromResolved('plugin', payload)
        if (entry) useApprovalHistoryStore.getState().record(entry)
      }
    },
    async load() {
      // Requests raised while the app was closed or reconnecting.
      const raw = await gatewayWS.call<unknown>('plugin.approval.list', {}).catch(() => null)
      const list = Array.isArray(raw) ? raw : Array.isArray((raw as { approvals?: unknown[] } | null)?.approvals) ? (raw as { approvals: unknown[] }).approvals : []
      add(list.map(parsePluginApproval).filter((item): item is PluginApproval => item !== null))
    },
    async resolve(id, decision) {
      const approval = drop(id)
      await gatewayWS.call('plugin.approval.resolve', { id, decision })
      if (approval) useApprovalHistoryStore.getState().record(pluginEntry(approval, decision))
    },
  }
})
