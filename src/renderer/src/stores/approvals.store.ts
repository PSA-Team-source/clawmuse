import { create } from 'zustand'
import { gatewayWS } from '@/services/gateway-ws.service'
import { agentIdFromSessionKey } from '@/services/session-key'
import type { ExecApprovalPayload, GatewayEventFrame } from '@/types'

/** OpenClaw's three answers to an approval (exec and plugin alike). */
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny'
const DECISIONS: ApprovalDecision[] = ['allow-once', 'allow-always', 'deny']

export type PendingApproval = ExecApprovalPayload & {
  receivedAt: number
  /** The command line the agent wants to run, as the gateway sanitised it for display. */
  command?: string
  cwd?: string | null
  warningText?: string | null
  allowedDecisions?: ApprovalDecision[]
  expiresAtMs?: number
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined)

/**
 * An exec approval as the gateway sends it.
 *
 * OpenClaw's `exec.approval.requested` event and `exec.approval.list` rows are
 * `{ id, request: { command, commandPreview, cwd, agentId, sessionKey, … },
 * createdAtMs, expiresAtMs }`. The flat `{ id, tool, args }` shape is the older
 * one and is still accepted. The modal renders `tool` + `args`, so the command
 * lands there too: "It wants to run a command" over the command itself.
 */
export function parseExecApproval(raw: unknown, now = Date.now()): PendingApproval | null {
  const event = raw as Record<string, unknown> | null
  if (!event || typeof event.id !== 'string') return null
  const request = event.request as Record<string, unknown> | undefined
  if (request && typeof request === 'object') {
    const command = str(request.commandPreview) ?? str(request.command)
    if (!command) return null
    const allowed = Array.isArray(request.allowedDecisions) ? request.allowedDecisions.filter((d): d is ApprovalDecision => DECISIONS.includes(d as ApprovalDecision)) : []
    return {
      id: event.id,
      tool: 'a command',
      args: str(request.command) ?? command,
      command,
      sessionKey: str(request.sessionKey),
      agentId: str(request.agentId),
      cwd: str(request.cwd) ?? null,
      warningText: str(request.warningText) ?? null,
      allowedDecisions: allowed.length ? allowed : DECISIONS,
      expiresAtMs: typeof event.expiresAtMs === 'number' ? event.expiresAtMs : undefined,
      receivedAt: typeof event.createdAtMs === 'number' ? event.createdAtMs : now,
    }
  }
  if (typeof event.tool !== 'string') return null
  return { ...(event as ExecApprovalPayload), receivedAt: now }
}

// ── History ────────────────────────────────────────────────────────────────
//
// OpenClaw keeps a resolved approval for a 15s grace window and then forgets
// it; nothing on the gateway lists past decisions. So the app keeps its own
// record of every decision it sees — made here, or broadcast by the gateway as
// `*.approval.resolved` when another client answered — plus requests that ran
// out the clock while waiting.

export type ApprovalOutcome = ApprovalDecision | 'timed-out'

export interface ApprovalHistoryEntry {
  id: string
  kind: 'exec' | 'plugin'
  /** Command line (exec) or the plugin's own title. */
  title: string
  /** Full command, working directory or the plugin's description. */
  detail?: string
  agentId?: string | null
  outcome: ApprovalOutcome
  decidedAtMs: number
}

export const HISTORY_CAP = 200
const HISTORY_KEY = 'clawmuse.approval-history'

/**
 * Adds or replaces (same kind + id) an entry, newest first, capped. A later
 * word on the same approval wins — the gateway's broadcast is authoritative
 * over what this client believed it sent.
 */
export function recordApproval(history: ApprovalHistoryEntry[], entry: ApprovalHistoryEntry, cap = HISTORY_CAP): ApprovalHistoryEntry[] {
  const rest = history.filter((item) => !(item.id === entry.id && item.kind === entry.kind))
  return [entry, ...rest].sort((a, b) => b.decidedAtMs - a.decidedAtMs).slice(0, cap)
}

/** A `*.approval.resolved` payload: `{ id, decision, ts, request }`. */
export function historyFromResolved(kind: 'exec' | 'plugin', raw: unknown, now = Date.now()): ApprovalHistoryEntry | null {
  const event = raw as Record<string, unknown> | null
  if (!event || typeof event.id !== 'string' || !DECISIONS.includes(event.decision as ApprovalDecision)) return null
  const request = (event.request ?? {}) as Record<string, unknown>
  const title = kind === 'exec' ? (str(request.commandPreview) ?? str(request.command)) : str(request.title)
  if (!title) return null
  const detail = kind === 'exec' ? (str(request.command) !== title ? str(request.command) : str(request.cwd)) : str(request.description)
  const sessionKey = str(request.sessionKey)
  return {
    id: event.id,
    kind,
    title,
    detail,
    agentId: (sessionKey ? agentIdFromSessionKey(sessionKey) : null) ?? str(request.agentId) ?? null,
    outcome: event.decision as ApprovalDecision,
    decidedAtMs: typeof event.ts === 'number' ? event.ts : now,
  }
}

function readHistory(): ApprovalHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is ApprovalHistoryEntry =>
      typeof entry === 'object' && entry !== null && typeof entry.id === 'string' && typeof entry.title === 'string' && typeof entry.decidedAtMs === 'number')
  } catch {
    return []
  }
}

interface ApprovalHistoryState {
  entries: ApprovalHistoryEntry[]
  record: (entry: ApprovalHistoryEntry) => void
}

export const useApprovalHistoryStore = create<ApprovalHistoryState>((set, get) => ({
  entries: readHistory(),
  record(entry) {
    const entries = recordApproval(get().entries, entry)
    set({ entries })
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
    } catch {
      /* storage full or blocked — the in-memory list still shows this session */
    }
  },
}))

function execEntry(approval: PendingApproval, outcome: ApprovalOutcome): ApprovalHistoryEntry {
  const title = approval.command ?? approval.tool
  const full = typeof approval.args === 'string' ? approval.args : undefined
  return {
    id: approval.id,
    kind: 'exec',
    title,
    detail: full && full !== title ? full : (approval.cwd ?? undefined),
    agentId: approvalBotId(approval),
    outcome,
    decidedAtMs: Date.now(),
  }
}

// ── Pending queue ──────────────────────────────────────────────────────────

interface ApprovalsState {
  queue: PendingApproval[]
  /** Always the head of the queue — what the modal renders. */
  current: PendingApproval | null

  enqueue: (request: ExecApprovalPayload | PendingApproval) => void
  /** `true`/`false` from the modal mean allow once / deny. */
  resolve: (id: string, decision: boolean | ApprovalDecision) => Promise<void>
  hydrate: () => Promise<void>
  handleEvent: (frame: GatewayEventFrame) => void
}

/**
 * The bot an approval belongs to.
 *
 * With a roster, "something wants permission" is not enough — the user has to
 * know *who*, and the row is where they look. The prefix on the session key is
 * the reliable half; `agentId` is there when the gateway sends it separately.
 */
export function approvalBotId(approval: { sessionKey?: string; agentId?: string }): string | null {
  const fromKey = approval.sessionKey ? agentIdFromSessionKey(approval.sessionKey) : null
  return fromKey ?? approval.agentId ?? null
}

/** One timer per pending approval that carries a deadline. */
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useApprovalsStore = create<ApprovalsState>((set, get) => {
  function drop(id: string): PendingApproval | undefined {
    const found = get().queue.find((item) => item.id === id)
    const queue = get().queue.filter((item) => item.id !== id)
    set({ queue, current: queue[0] ?? null })
    clearTimeout(expiryTimers.get(id))
    expiryTimers.delete(id)
    return found
  }

  function watchExpiry(approval: PendingApproval): void {
    if (approval.expiresAtMs == null || expiryTimers.has(approval.id)) return
    // The gateway expires it silently (no event), so the queue has to as well.
    const timer = setTimeout(() => {
      const expired = drop(approval.id)
      if (expired) useApprovalHistoryStore.getState().record(execEntry(expired, 'timed-out'))
    }, Math.max(0, approval.expiresAtMs - Date.now()))
    expiryTimers.set(approval.id, timer)
  }

  return {
    queue: [],
    current: null,

    enqueue(request) {
      // The agent is blocked until this is answered, so never drop one — but
      // never show the same id twice either (a reconnect replays pending ones).
      if (get().queue.some((item) => item.id === request.id)) return
      const item: PendingApproval = typeof request.receivedAt === 'number' ? (request as PendingApproval) : { ...request, receivedAt: Date.now() }
      const queue = [...get().queue, item]
      set({ queue, current: queue[0] ?? null })
      watchExpiry(item)

      // A blocked agent is exactly the case where a background app must speak up.
      void window.clawmuse?.notifications.show({
        title: 'Approval required',
        body: item.command ? `ClawMuse wants to run: ${item.command}` : `ClawMuse wants to run "${item.tool}"`,
        route: 'chat',
      })
    },

    async resolve(id, choice) {
      const decision: ApprovalDecision = choice === true ? 'allow-once' : choice === false ? 'deny' : choice
      // Optimistic: drop it from the queue first so the modal closes instantly.
      const approval = drop(id)

      try {
        await gatewayWS.call('exec.approval.resolve', { id, decision })
        if (approval) useApprovalHistoryStore.getState().record(execEntry(approval, decision))
      } catch {
        // The agent stays blocked, but the gateway re-sends
        // `exec.approval.requested` on reconnect, so it will come back.
      }
    },

    async hydrate() {
      try {
        // `exec.approval.list` is the pending queue; `exec.approvals.get` is the
        // allowlist policy file, which is a different thing entirely.
        const raw = await gatewayWS.call<unknown>('exec.approval.list', {})
        const list = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { approvals?: unknown })?.approvals)
            ? (raw as { approvals: unknown[] }).approvals
            : []
        for (const approval of list.map((entry) => parseExecApproval(entry)).filter((item): item is PendingApproval => item !== null)) {
          get().enqueue(approval)
        }
      } catch {
        /* gateway not ready */
      }
    },

    handleEvent(frame) {
      const payload = frame.payload ?? frame.data
      if (frame.event === 'exec.approval.requested') {
        const approval = parseExecApproval(payload)
        if (approval) get().enqueue(approval)
      } else if (frame.event === 'exec.approval.resolved') {
        // Answered here, in the Control UI, on a phone or in a channel — either
        // way it is no longer waiting on this user.
        const id = (payload as { id?: unknown } | undefined)?.id
        if (typeof id === 'string') drop(id)
        const entry = historyFromResolved('exec', payload)
        if (entry) useApprovalHistoryStore.getState().record(entry)
      }
    },
  }
})
