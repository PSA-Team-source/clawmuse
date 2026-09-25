import type { Message, Session, ToolCall } from '@/types'
import { eventSessionKey, normalizeSessionKey } from '@/services/session-key'
import { failureNotice } from '@/lib/failure-notice'

/** OpenClaw's transcript note for a run that failed before any reply (session-run-error). */
const RUN_FAILED_PREFIX = 'This turn ended before a reply: '

/**
 * Joins the block-array form of assistant content into plain text.
 * The gateway sends either `payload.text` or `payload.message.content[]`.
 */
export function textFromContent(
  content?: { type: string; text?: string }[] | undefined,
): string {
  if (!content?.length) return ''
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/**
 * Pulls model reasoning out of a chat event.
 *
 * OpenClaw sends it either as a top-level `thinking` string (logs-chat schema)
 * or as `{type:'thinking', thinking}` blocks inside `message.content` — which
 * one depends on the gateway build, so both are read and the top-level form
 * wins when present.
 */
export function thinkingFromEvent(payload: {
  thinking?: string
  // Blocks carry `text` too — this reads one field off a shape it does not own,
  // so it stays open rather than re-declaring the gateway's content model.
  message?: { content?: ({ type: string; thinking?: string } & Record<string, unknown>)[] }
}): string {
  if (payload.thinking) return payload.thinking
  const content = payload.message?.content
  // `content` is a string on most stored history rows and only an array on the
  // block form — a truthy `.length` check alone would send a string into
  // `.filter` and throw, taking the whole thread load down with it.
  if (!Array.isArray(content) || content.length === 0) return ''
  return content
    .filter((block) => block.type === 'thinking' && typeof block.thinking === 'string')
    .map((block) => block.thinking)
    .join('')
}

/**
 * THE most bug-prone rule in the whole protocol.
 *
 * Every `chat` delta carries the **entire** text accumulated so far, not the
 * newly added fragment. So the correct operation is replace, never append.
 * Keeping the longer of the two also makes out-of-order or duplicated frames
 * harmless — a late short frame cannot truncate what we already rendered.
 */
export function applyCumulativeDelta(current: string, incoming: string): string {
  return incoming.length >= current.length ? incoming : current
}

/** Derives a readable title from a session key when the server sends none. */
export function prettySessionName(key: string): string {
  const normalized = normalizeSessionKey(key)

  if (normalized === 'webchat:main') return 'Main'

  const skillConv = /^webchat:skill:([^:]+):conv:(.+)$/.exec(normalized)
  if (skillConv) return `${titleCase(skillConv[1]!)} · conversation`

  const skill = /^webchat:skill:([^:]+)$/.exec(normalized)
  if (skill) return titleCase(skill[1]!)

  const channel = /^webchat:channel:(.+)$/.exec(normalized)
  if (channel) return titleCase(channel[1]!)

  const mainConv = /^webchat:main:conv:(.+)$/.exec(normalized)
  if (mainConv) return 'New conversation'

  return normalized
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/** Tolerant parser for `sessions.list`, whose shape varies by gateway version. */
/**
 * Joins the gateway's split model fields into the `provider/id` ref the rest of
 * the app speaks. An id already prefixed with its provider passes through, so
 * a gateway that sends a full ref does not produce `zai/zai/glm-5.2`.
 */
export function modelRef(provider: unknown, model: unknown): string | undefined {
  if (typeof model !== 'string' || model.length === 0) return undefined
  if (typeof provider !== 'string' || provider.length === 0) return model
  // "Already qualified" means it starts with *this* provider — a slash alone is
  // not enough: OpenRouter's `anthropic/claude-sonnet-4` belongs to `openrouter`.
  if (model.startsWith(`${provider}/`)) return model
  return `${provider}/${model}`
}

export function normalizeSessions(raw: unknown): Session[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { sessions?: unknown })?.sessions)
      ? ((raw as { sessions: unknown[] }).sessions)
      : []

  return list
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => {
      const key = String(entry.key ?? entry.id ?? entry.sessionKey ?? '')
      // Agent-scoped: two bots each have a `webchat:main`, and collapsing them
      // to the bare key would make one roster row own the other's transcript.
      const id = eventSessionKey(key, typeof entry.agentId === 'string' ? entry.agentId : undefined)
      // OpenClaw names a session with an explicit `label` (a user rename) or a
      // `displayName` it derives from the first message; `name` is the older
      // field. Reading only `name` titled every live thread "New conversation".
      const name = firstText(entry.label, entry.displayName, entry.derivedTitle, entry.name) ?? prettySessionName(id)
      const lastMessage = entry.lastMessagePreview ?? entry.lastMessage ?? entry.last_message
      return {
        id,
        name,
        last_message:
          typeof lastMessage === 'string'
            ? lastMessage
            : typeof (lastMessage as { text?: string })?.text === 'string'
              ? (lastMessage as { text: string }).text
              : undefined,
        last_run_failed: entry.status === 'failed' || undefined,
        last_message_at: lastActivityAt(entry),
        unread: entry.unread === true || undefined,
        pinned: entry.pinned === true || undefined,
        archived: entry.archived === true || undefined,
        gateway_session_id: typeof entry.sessionId === 'string' && entry.sessionId ? entry.sessionId : undefined,
        // `sessions.list` reports the provider and the bare id in separate
        // fields (`zai` + `glm-5.2`), but everywhere else — config defaults,
        // `models.list`, `sessions.patch` — a model is the `provider/id` ref.
        // Keeping the bare id here made every comparison against the configured
        // default look like a mismatch.
        model: modelRef(entry.modelProvider, entry.model),
        model_override_source:
          entry.modelOverrideSource === 'auto' ||
          entry.modelOverrideSource === 'user' ||
          entry.modelOverrideSource === 'default'
            ? entry.modelOverrideSource
            : undefined,
      } satisfies Session
    })
    .filter((session) => session.id.length > 0)
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

/**
 * When the conversation last moved, as ISO.
 *
 * Not `updatedAt`: every `sessions.patch` bumps that — marking a thread read or
 * pinning it would reorder the list. The gateway's own unread rule compares
 * `lastInteractionAt`/`lastActivityAt`; `endedAt` adds the end of the latest
 * agent run, so a reply moves its thread up too.
 */
function lastActivityAt(entry: Record<string, unknown>): string | undefined {
  const moments = [entry.lastInteractionAt, entry.lastActivityAt, entry.endedAt].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  )
  if (moments.length) return new Date(Math.max(...moments)).toISOString()
  if (typeof entry.lastMessageAt === 'string') return entry.lastMessageAt
  if (typeof entry.updatedAt === 'number' && entry.updatedAt > 0) return new Date(entry.updatedAt).toISOString()
  return typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined
}

/** Tolerant parser for `chat.history`. */
export function normalizeHistory(raw: unknown, sessionId: string): Message[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { messages?: unknown })?.messages)
      ? ((raw as { messages: unknown[] }).messages)
      : []

  const entries = list.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)

  // OpenClaw stores a tool step as an assistant entry with `toolCall` blocks
  // and one `toolResult` entry per call. Results are joined to their call so a
  // step renders as one compact tool row — never as raw output in a bubble
  // (web search results arrived as pages of JSON "said" by the agent).
  const results = new Map<string, Record<string, unknown>>()
  for (const entry of entries) {
    if (entry.role === 'toolResult' && typeof entry.toolCallId === 'string') results.set(entry.toolCallId, entry)
  }
  const joined = new Set<string>()

  return dropTurnRecaps(entries
    .flatMap((entry, index): Message[] => {
      const stamp = typeof entry.timestamp === 'number' ? new Date(entry.timestamp).toISOString() : new Date().toISOString()
      const meta = (entry.__openclaw ?? {}) as { id?: unknown }
      const toolBlocks = Array.isArray(entry.content)
        ? (entry.content as { type?: string; id?: string; name?: string; arguments?: unknown }[]).filter((block) => block?.type === 'toolCall' && typeof block.id === 'string')
        : []
      const toolMessage = (calls: ToolCall[]): Message => ({ id: `${String(meta.id ?? `hist_${sessionId}_${index}`)}:tools`, session_id: sessionId, role: 'tool', content: '', tool_calls: calls, status: 'sent', created_at: stamp })
      const callFrom = (id: string, tool: string, input: unknown): ToolCall => {
        const result = results.get(id)
        if (result) joined.add(id)
        const isError = result?.isError === true
        return { id, tool, input, result: result ? textFromContent(result.content as { type: string; text?: string }[] | undefined) : undefined, isError, status: result ? (isError ? 'error' : 'done') : 'running' }
      }
      if (entry.role === 'toolResult') {
        // A result whose call was not in this page still shows as a tool row.
        if (typeof entry.toolCallId !== 'string' || joined.has(entry.toolCallId)) return []
        return [toolMessage([callFrom(entry.toolCallId, typeof entry.toolName === 'string' ? entry.toolName : 'tool', undefined)])]
      }
      const tools = toolBlocks.length ? [toolMessage(toolBlocks.map((block) => callFrom(block.id!, block.name ?? 'tool', block.arguments)))] : []
      const text = typeof entry.content === 'string' ? entry.content : textFromContent(entry.content as { type: string; text?: string }[] | undefined)
      // A tool step with no words of its own is only its tool row.
      if (toolBlocks.length && entry.role === 'assistant' && !text.trim()) return tools
      return [...normalizeEntry(entry, index), ...tools]
    }))

  function normalizeEntry(entry: Record<string, unknown>, index: number): Message[] {
    return [entry].map(() => {
      const role = entry.role === 'user' || entry.role === 'assistant' || entry.role === 'tool' ? entry.role : 'assistant'
      let content =
        typeof entry.content === 'string'
          ? entry.content
          : typeof entry.text === 'string'
            ? entry.text
            : textFromContent(entry.content as { type: string; text?: string }[] | undefined)
      // The gateway's own failure note carries the raw provider text; show the
      // same readable notice a live failure gets, and mark it failed.
      const runFailed = entry.customType === 'run-failed-before-reply' || content.startsWith(RUN_FAILED_PREFIX)
      if (runFailed) {
        const details = entry.details as { error?: unknown } | undefined
        content = failureNotice(typeof details?.error === 'string' ? details.error : content.slice(RUN_FAILED_PREFIX.length))
      }

      // Stored history keeps reasoning in the same two shapes the live event
      // uses, so a reloaded thread keeps the thought process it showed live.
      const thinking = thinkingFromEvent({
        thinking: typeof entry.thinking === 'string' ? entry.thinking : undefined,
        message: { content: entry.content as { type: string; thinking?: string }[] | undefined },
      })

      // OpenClaw keeps the stable id and send time in `__openclaw.id` and a
      // millisecond `timestamp`; without them every reload re-keyed messages and
      // stamped the whole thread with the current time.
      const meta = (entry.__openclaw ?? {}) as { id?: unknown }
      const stamp = typeof entry.timestamp === 'number' ? new Date(entry.timestamp).toISOString() : undefined
      return {
        id: String(meta.id ?? entry.id ?? `hist_${sessionId}_${index}`),
        session_id: sessionId,
        role,
        content,
        thinking: thinking || undefined,
        // A turn the runtime ended in error is stored as an assistant message
        // with stopReason "error" — it is a failure notice, not an answer.
        status: entry.stopReason === 'error' || runFailed ? 'failed' : 'sent',
        created_at:
          stamp ??
          (typeof entry.createdAt === 'string'
            ? entry.createdAt
            : typeof entry.created_at === 'string'
              ? entry.created_at
              : new Date().toISOString()),
      } satisfies Message
    })
  }
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * A tool-using turn under the Claude Code runtime ends with one more assistant
 * message that repeats every step's text, joined — so the reply showed twice
 * (steps as bubbles, then all of it again). Drop a message that is exactly the
 * earlier steps of the same turn, in order; anything with new words stays.
 */
export function dropTurnRecaps(messages: Message[]): Message[] {
  const out: Message[] = []
  let steps: string[] = []
  for (const message of messages) {
    if (message.role === 'user') steps = []
    if (message.role === 'assistant' && message.content.trim()) {
      const text = squash(message.content)
      if (steps.length >= 2 && text === squash(steps.join(' '))) continue
      steps.push(message.content)
    }
    out.push(message)
  }
  return out
}
