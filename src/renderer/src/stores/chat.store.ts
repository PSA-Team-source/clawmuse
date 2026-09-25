import { create } from 'zustand'
import { encodeAttachment, gatewayWS, type EncodedAttachment } from '@/services/gateway-ws.service'
import { eventSessionKey, sessionKeyFor } from '@/services/session-key'
import { cache } from '@/services/storage.service'
import {
  agentEventPayloadSchema,
  chatEventPayloadSchema,
  execApprovalPayloadSchema,
  type Attachment,
  type GatewayEventFrame,
  type Message,
  type QueuedMessage,
  type Session,
  type SessionPatch,
  type ToolCall,
} from '@/types'
import {
  applyCumulativeDelta,
  normalizeHistory,
  normalizeSessions,
  textFromContent,
  thinkingFromEvent,
} from '@/utils/gateway-normalize'
import { failureNotice } from '@/lib/failure-notice'

export { failureNotice }

interface ChatState {
  sessions: Session[]
  /** `loading` until the first list (cached or live) arrives; `error` only when there is nothing to show. */
  sessionsStatus: 'loading' | 'ready' | 'error'
  currentSessionId: string | null
  messages: Record<string, Message[]>
  /** Live assistant text per session while a response streams. */
  streamingText: Record<string, string>
  /** Live model reasoning per session, shown above the answer as it streams. */
  streamingThinking: Record<string, string>
  isTyping: Record<string, boolean>
  /**
   * The last tool each session reached for, and when.
   *
   * The bots share one computer, so "who is driving it right now" is a real
   * question with a real answer — and this is the only place that answer passes
   * through. Kept as a small map rather than derived by scanning transcripts:
   * the Computer window would otherwise re-scan every message on every frame.
   */
  activity: Record<string, { tool: string; at: number }>
  offlineQueue: QueuedMessage[]

  loadSessions: () => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>
  setCurrentSession: (sessionId: string | null) => void
  sendMessage: (sessionId: string, text: string, attachments?: Attachment[], files?: File[]) => Promise<void>
  flushOfflineQueue: () => Promise<void>
  createSession: (options?: { channelId?: string; skillId?: string; agentId?: string }) => string
  deleteSession: (sessionId: string) => Promise<void>
  resetSession: (sessionId: string) => Promise<void>
  patchSession: (sessionId: string, patch: SessionPatch) => Promise<void>
  /** Records the thread as read on the gateway — only when it is unread, so opening a thread costs nothing otherwise. */
  markSessionRead: (sessionId: string) => void
  abortSession: (sessionId: string) => Promise<void>
  handleGatewayEvent: (frame: GatewayEventFrame) => void
  /** Drops every thread — for switching to a runtime that has its own. */
  reset: () => void
}

/** Reads either the `payload` or `data` slot; gateway versions differ. */
function eventPayload(frame: GatewayEventFrame): unknown {
  return frame.payload ?? frame.data ?? frame
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  sessionsStatus: 'loading',
  currentSessionId: null,
  messages: {},
  streamingText: {},
  streamingThinking: {},
  isTyping: {},
  activity: {},
  offlineQueue: cache.getQueue(),

  async loadSessions() {
    const cached = cache.getSessions()
    if (cached?.length) set({ sessions: cached, sessionsStatus: 'ready' })

    try {
      const raw = await gatewayWS.getSessions()
      const sessions = normalizeSessions(raw)
      // A well-formed empty list is an answer (the last chat was archived or
      // deleted); only an unrecognisable reply leaves the cache in place.
      if (sessions.length > 0 || Array.isArray((raw as { sessions?: unknown } | null)?.sessions)) {
        cache.setSessions(sessions)
        set((state) => ({ sessions: keepLocalDrafts(sessions, state.sessions), sessionsStatus: 'ready' }))
      }
    } catch {
      // Offline or gateway down — the cached list stays on screen.
      if (!get().sessions.length) set({ sessionsStatus: 'error' })
    }
  },

  async loadMessages(sessionId) {
    // The cache only seeds a thread that has nothing on screen. It is the last
    // server snapshot, so over a live thread it would roll back whatever landed
    // since — the message just sent, the reply just received.
    const cached = cache.getMessages(sessionId)
    if (cached?.length && !get().messages[sessionId]?.length) {
      set((state) => ({ messages: { ...state.messages, [sessionId]: cached } }))
    }

    try {
      const history = normalizeHistory(await gatewayWS.getSessionHistory(sessionId), sessionId)
      // The stored notice is generic ("failed before producing a reply"); the
      // session record holds the actual cause. Show that one.
      const last = history.at(-1)
      if (last?.role === 'assistant' && last.status === 'failed') {
        const described = (await gatewayWS.describeSession(sessionId).catch(() => null)) as { session?: { lastRunError?: unknown } } | null
        const reason = described?.session?.lastRunError
        if (typeof reason === 'string' && reason.trim()) history[history.length - 1] = { ...last, content: failureNotice(reason) }
      }
      cache.setMessages(sessionId, history)
      set((state) => ({
        messages: { ...state.messages, [sessionId]: withUnconfirmedSends(history, state.messages[sessionId] ?? []) },
      }))
    } catch {
      /* keep cache */
    }
  },

  setCurrentSession(sessionId) {
    set({ currentSessionId: sessionId })
    if (sessionId) get().markSessionRead(sessionId)
  },

  markSessionRead(sessionId) {
    if (!get().sessions.find((s) => s.id === sessionId)?.unread) return
    setSessionFields(set, sessionId, { unread: undefined })
    // Best effort: a failure only means the dot comes back on the next refresh.
    void gatewayWS.patchSession(sessionId, { unread: false }).catch(() => undefined)
  },

  async sendMessage(sessionId, text, attachments, files) {
    const optimistic: Message = {
      id: `opt_${Date.now()}`,
      session_id: sessionId,
      role: 'user',
      content: text,
      status: 'sending',
      attachments,
      created_at: new Date().toISOString(),
    }

    set((state) => ({
      messages: { ...state.messages, [sessionId]: [...(state.messages[sessionId] ?? []), optimistic] },
    }))

    // Offline: park it and leave the bubble in `sending`, so the UI reads as
    // "will send" rather than "failed".
    if (!gatewayWS.isConnected) {
      const queued: QueuedMessage = { sessionId, text, attachments, timestamp: Date.now() }
      const queue = [...get().offlineQueue, queued]
      cache.setQueue(queue)
      set({ offlineQueue: queue })
      return
    }

    // Muse shows its typing indicator as soon as a reply is expected
    // (useChatIsExpectingBotResponse), not at the first streamed token: a model
    // that reasons first streams nothing for tens of seconds and the thread
    // looked dead. Set before the send so a fast reply's final event, which
    // can beat the send's own response, is what clears it.
    set((state) => ({ isTyping: { ...state.isTyping, [sessionId]: true } }))
    try {
      const encoded = await encodeAttachments(attachments, files)
      await gatewayWS.sendMessage(sessionId, text, encoded)
      updateMessageStatus(set, sessionId, optimistic.id, 'sent')
    } catch {
      updateMessageStatus(set, sessionId, optimistic.id, 'failed')
      set((state) => ({ isTyping: { ...state.isTyping, [sessionId]: false } }))
    }
  },

  async flushOfflineQueue() {
    const queue = get().offlineQueue
    if (queue.length === 0) return

    const remaining: QueuedMessage[] = []
    for (const item of queue) {
      try {
        const encoded = await encodeAttachments(item.attachments)
        await gatewayWS.sendMessage(item.sessionId, item.text, encoded)
      } catch {
        // Preserve order: this item and everything after it stays queued.
        remaining.push(item)
      }
    }

    cache.setQueue(remaining)
    set({ offlineQueue: remaining })
  },

  createSession(options) {
    // Local-only and optimistic: OpenClaw materialises the session on the first
    // `chat.send`, so there is nothing to call here.
    const local = options?.skillId
      ? `webchat:skill:${options.skillId}`
      : options?.channelId
        ? `webchat:channel:${options.channelId}`
        : `webchat:main:conv:${Date.now().toString(36)}`
    const id = sessionKeyFor(options?.agentId, local)

    const session: Session = { id, name: options?.skillId ?? 'New conversation' }

    set((state) =>
      state.sessions.some((s) => s.id === id)
        ? { currentSessionId: id }
        : { sessions: [session, ...state.sessions], currentSessionId: id },
    )

    return id
  },

  async deleteSession(sessionId) {
    // Thrown, not swallowed: clearing the row while the conversation survives
    // on the gateway brings it back on the next refresh, after telling the
    // user it was gone. (A key the gateway never saw answers `ok`, so a
    // never-sent draft still deletes cleanly.)
    await gatewayWS.deleteSession(sessionId)
    cache.deleteMessages(sessionId)
    set((state) => {
      const { [sessionId]: _removed, ...messages } = state.messages
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        messages,
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
      }
    })
  },

  async resetSession(sessionId) {
    try {
      await gatewayWS.resetSession(sessionId)
    } catch {
      /* ignore */
    }
    cache.deleteMessages(sessionId)
    set((state) => ({ messages: { ...state.messages, [sessionId]: [] } }))
  },

  async patchSession(sessionId, patch) {
    // Deliberately unguarded: the caller shows the error, unlike the
    // best-effort delete/reset paths.
    await gatewayWS.patchSession(sessionId, patch)
    set((state) => ({
      // The live list holds active sessions only, so an archived one leaves it.
      sessions: state.sessions.flatMap((s) => {
        if (s.id !== sessionId) return [s]
        if (patch.archived === true) return []
        const { expectedSessionId: _expected, ...fields } = patch
        const merged = { ...s, ...fields, pinned: patch.pinned ?? s.pinned, unread: patch.unread ?? s.unread, archived: undefined }
        if (patch.model === 'default') {
          return [{ ...merged, model: undefined, model_override_source: 'default' as const }]
        }
        return [
          {
            ...merged,
            ...(patch.model ? { model_override_source: 'user' as const } : {}),
          },
        ]
      }),
    }))
    if (patch.archived === false) void get().loadSessions()
  },

  async abortSession(sessionId) {
    try {
      await gatewayWS.abort(sessionId)
    } catch {
      /* ignore */
    }
    set((state) => ({ isTyping: { ...state.isTyping, [sessionId]: false } }))
  },

  reset() {
    // The queue goes too. A message typed against the Offline agent must not be
    // delivered to the cloud one on the next flush — different runtime,
    // different session, and possibly a very different set of permissions.
    cache.clearRuntimeData()
    set({
      sessions: [],
      sessionsStatus: 'loading',
      currentSessionId: null,
      messages: {},
      streamingText: {},
      streamingThinking: {},
      isTyping: {},
      activity: {},
      offlineQueue: [],
    })
  },

  handleGatewayEvent(frame) {
    const payload = eventPayload(frame)

    switch (frame.event) {
      case 'chat': {
        const parsed = chatEventPayloadSchema.safeParse(payload)
        if (!parsed.success) return
        const { state: streamState, sessionKey } = parsed.data
        const key = eventSessionKey(sessionKey, parsed.data.agentId)
        const text = parsed.data.text ?? textFromContent(parsed.data.message?.content)
        const thinking = thinkingFromEvent(parsed.data)

        if (streamState === 'delta') {
          set((state) => ({
            // Cumulative: each delta is the full text so far — replace, never append.
            streamingText: {
              ...state.streamingText,
              [key]: applyCumulativeDelta(state.streamingText[key] ?? '', text),
            },
            // Reasoning is cumulative on exactly the same terms, and a delta
            // that carries only text must not wipe reasoning already shown.
            streamingThinking: {
              ...state.streamingThinking,
              [key]: applyCumulativeDelta(state.streamingThinking[key] ?? '', thinking),
            },
            isTyping: { ...state.isTyping, [key]: true },
          }))
          return
        }

        if (streamState === 'final') {
          const finalText = text || (get().streamingText[key] ?? '')
          // The final frame often omits reasoning it already streamed, so fall
          // back to what was accumulated rather than dropping it on landing.
          const finalThinking = thinking || (get().streamingThinking[key] ?? '')
          const message: Message = {
            id: `asst_${Date.now()}`,
            session_id: key,
            role: 'assistant',
            content: finalText,
            thinking: finalThinking || undefined,
            status: 'sent',
            created_at: new Date().toISOString(),
          }
          set((state) => {
            const { [key]: _streaming, ...streamingText } = state.streamingText
            const { [key]: _thinking, ...streamingThinking } = state.streamingThinking
            return {
              messages: { ...state.messages, [key]: [...(state.messages[key] ?? []), message] },
              streamingText,
              streamingThinking,
              isTyping: { ...state.isTyping, [key]: false },
            }
          })
          // Reconcile against the server's own record of the exchange.
          void get().loadMessages(key)
          // The gateway counts a finished reply as unread until a client
          // acknowledges it. A reply landing in the thread on screen is read;
          // one landing anywhere else earns the dot now, not on next refresh.
          if (key === get().currentSessionId && document.visibilityState === 'visible') {
            void gatewayWS.patchSession(key, { unread: false }).catch(() => undefined)
          } else if (key !== get().currentSessionId) {
            setSessionFields(set, key, { unread: true })
          }
          return
        }

        // A failed turn has to leave a mark.
        //
        // This used to drop the partial text and add nothing, which made "the
        // model rejected your API key" look exactly like "the bot ignored you":
        // the typing indicator stopped and the thread sat there. Silence is the
        // one response a person cannot debug.
        //
        // An abort is different — the user did that on purpose and already
        // knows why, so it stays quiet.
        set((state) => {
          const { [key]: _streaming, ...streamingText } = state.streamingText
          const { [key]: _thinking, ...streamingThinking } = state.streamingThinking
          const failed = streamState === 'error'
          const notice: Message = {
            id: `err_${Date.now()}`,
            session_id: key,
            role: 'assistant',
            content: failureNotice(parsed.data.errorMessage ?? parsed.data.error ?? text),
            status: 'failed',
            created_at: new Date().toISOString(),
          }
          return {
            messages: failed
              ? { ...state.messages, [key]: [...(state.messages[key] ?? []), notice] }
              : state.messages,
            streamingText,
            streamingThinking,
            isTyping: { ...state.isTyping, [key]: false },
          }
        })
        return
      }

      case 'agent': {
        const parsed = agentEventPayloadSchema.safeParse(payload)
        if (!parsed.success) return
        const { type, sessionKey, tool, id, args, result, isError } = parsed.data
        if (!sessionKey) return
        const key = eventSessionKey(sessionKey, parsed.data.agentId)

        if (type === 'tool_call') {
          const call: ToolCall = {
            id: id ?? `tool_${Date.now()}`,
            tool: tool ?? 'unknown',
            input: args,
            status: 'running',
          }
          const message: Message = {
            id: `toolmsg_${call.id}`,
            session_id: key,
            role: 'tool',
            content: '',
            status: 'streaming',
            tool_calls: [call],
            created_at: new Date().toISOString(),
          }
          set((state) => ({
            messages: { ...state.messages, [key]: [...(state.messages[key] ?? []), message] },
            activity: { ...state.activity, [key]: { tool: call.tool, at: Date.now() } },
          }))
          return
        }

        // tool_result: fold the outcome into the matching pending call.
        set((state) => ({
          messages: {
            ...state.messages,
            [key]: (state.messages[key] ?? []).map((message) =>
              message.tool_calls?.some((call) => call.id === id)
                ? {
                    ...message,
                    status: 'sent' as const,
                    tool_calls: message.tool_calls.map((call) =>
                      call.id === id
                        ? { ...call, result, isError, status: isError ? ('error' as const) : ('done' as const) }
                        : call,
                    ),
                  }
                : message,
            ),
          },
        }))
        return
      }

      case 'exec.approval.requested': {
        const parsed = execApprovalPayloadSchema.safeParse(payload)
        if (!parsed.success) return
        // Lazy import breaks the store↔store cycle.
        void import('@/stores/approvals.store').then(({ useApprovalsStore }) => {
          useApprovalsStore.getState().enqueue(parsed.data)
        })
        return
      }

      default:
        // cron.* and friends are handled by TanStack Query invalidation
        // in `useTasks`, not here.
        break
    }
  },
}))

function setSessionFields(
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  sessionId: string,
  fields: Partial<Session>,
): void {
  set((state) => ({ sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...fields } : s)) }))
}

/**
 * The live list plus any thread created here that the gateway has not seen yet.
 *
 * `createSession` is local until the first `chat.send`, so a refresh in between
 * used to drop the row for the chat the user was about to start.
 */
function keepLocalDrafts(live: Session[], previous: Session[]): Session[] {
  const known = new Set(live.map((s) => s.id))
  const drafts = previous.filter((s) => !known.has(s.id) && !s.last_message && !s.last_message_at)
  return drafts.length ? [...drafts, ...live] : live
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Server history plus the user's own sends it does not hold yet.
 *
 * `chat.send` is acknowledged before the message is in the transcript: the
 * gateway keeps it in pending-input custody (a queued follow-up, a busy
 * session) until the run commits it. Any reload in that window — the final of
 * another run on the same session, a remount, search — used to replace the
 * thread with a history that lacks it, so the user's message vanished until
 * the reply landed.
 *
 * A send is confirmed by a user row that is new to this thread (its id was not
 * on screen before) and carries the same words; each row confirms one send, in
 * order, so sending the same text twice still shows twice. Everything else of
 * the thread stays exactly as the server has it.
 */
function withUnconfirmedSends(history: Message[], local: Message[]): Message[] {
  const pending = local.filter((m) => m.role === 'user' && m.id.startsWith('opt_'))
  if (!pending.length) return history
  const seen = new Set(local.map((m) => m.id))
  const fresh = history.filter((m) => m.role === 'user' && !seen.has(m.id))
  const unconfirmed = pending.filter((send) => {
    const text = squash(send.content)
    const match = fresh.findIndex((row) => {
      const stored = squash(row.content)
      return stored === text || (text !== '' && stored.includes(text))
    })
    if (match === -1) return true
    fresh.splice(match, 1)
    return false
  })
  return unconfirmed.length ? [...history, ...unconfirmed] : history
}

function updateMessageStatus(
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  sessionId: string,
  messageId: string,
  status: Message['status'],
): void {
  set((state) => ({
    messages: {
      ...state.messages,
      [sessionId]: (state.messages[sessionId] ?? []).map((message) =>
        message.id === messageId ? { ...message, status } : message,
      ),
    },
  }))
}

async function encodeAttachments(
  attachments?: Attachment[],
  files?: File[],
): Promise<EncodedAttachment[] | undefined> {
  if (!attachments?.length) return undefined
  const settled = await Promise.allSettled(
    attachments.map((attachment, index) => encodeAttachment(attachment, files?.[index])),
  )
  // A file that fails to read is skipped rather than blocking the message.
  const encoded = settled
    .filter((result): result is PromiseFulfilledResult<EncodedAttachment | null> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((value): value is EncodedAttachment => value !== null)
  return encoded.length > 0 ? encoded : undefined
}

/**
 * Tells main whether this window has a reply generating, so the floating
 * button can read "Thinking". Returns the unsubscribe for tests and HMR.
 */
export function reportChatBusy(): () => void {
  let last = false
  const report = () => {
    const busy = Object.values(useChatStore.getState().isTyping).some(Boolean)
    if (busy === last) return
    last = busy
    window.clawmuse?.app.reportBusy?.(busy)
  }
  report()
  return useChatStore.subscribe(report)
}
