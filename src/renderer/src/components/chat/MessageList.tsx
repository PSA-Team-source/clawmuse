import { memo, useEffect, useMemo, useRef } from 'react'
import type { Message, ToolCall } from '@/types'
import { cn } from '@/lib/cn'
import { AvatarBadge, useTalkLevel, type AvatarConfig, type AvatarState } from '@/features/avatar'
import { ToolGroup } from './ToolGroup'
import { BUBBLE_FACE_CLASS, BUBBLE_FACE_SIZE, MessageBubble, type BubbleGrouping } from './MessageBubble'
import { useReactionsStore } from '@/stores/reactions.store'
import { StreamingText } from './StreamingText'
import { ThinkingBlock } from './ThinkingBlock'
import { TypingIndicator } from './TypingIndicator'

interface MessageListProps {
  messages: Message[]
  streamingText?: string
  streamingThinking?: string
  isTyping?: boolean
  className?: string
  onReply?: (message: Message) => void
  /** The agent's avatar: a face beside its replies that thinks, talks and works live. Pass a stable reference. */
  avatar?: AvatarConfig
}

/**
 * What the agent is doing right now, for the face beside the reply in progress:
 * running a tool (a tool call of this turn has no result yet), talking (answer
 * text is streaming), thinking (waiting, or only reasoning so far), else idle.
 */
export function liveAvatarState(messages: readonly Message[], busy: boolean, streamingText: string): AvatarState {
  if (!busy) return 'idle'
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role === 'user') break
    if (message.role === 'tool' && message.tool_calls?.some((call) => call.status === 'running' || call.status === 'pending')) return 'working'
  }
  return streamingText ? 'talking' : 'thinking'
}

/** The face beside the reply in progress; the talk meter turns streamed characters into mouth movement. */
function LiveFace({ config, state, text }: { config: AvatarConfig; state: AvatarState; text: string }) {
  const talk = useTalkLevel(state, text)
  return <AvatarBadge config={config} state={state} talkLevel={talk} size={BUBBLE_FACE_SIZE} className={BUBBLE_FACE_CLASS} />
}

/** How close to the bottom (px) counts as "still following the conversation". */
const NEAR_BOTTOM_PX = 120

type Row =
  | { kind: 'message'; key: string; message: Message; grouping?: BubbleGrouping; first?: boolean }
  | { kind: 'tools'; key: string; calls: ToolCall[] }
  | { kind: 'time'; key: string; at: string }

/** Muse's TIMESTAMP_GAP_MS: a pause this long, or a new calendar day, starts a new stretch. */
const TIME_BREAK_MS = 30 * 60_000

/** Muse's formatTimestampLabel: "3:45 PM" today, "Sep 21, 3:45 PM" otherwise, with the year only when it differs. */
export function timeLabel(iso: string, now = new Date(), locale?: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = date.toDateString() === now.toDateString()
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    ...(sameDay ? {} : { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/** Muse HATCH_CHAT_GROUP_WINDOW: bubbles this close in time can group. */
const GROUP_WINDOW_MS = 120_000

/**
 * Muse buildHatchChatMessageLayouts/canGroup: consecutive bubbles from the same
 * side, under two minutes apart, with no time marker (or tool row) between and
 * no reaction on the earlier one, form a group — 4px apart with tucked
 * corners; everything else sits 16px apart.
 */
export function groupRows(rows: Row[], hasReaction: (id: string) => boolean): Row[] {
  const canGroup = (a: Row | undefined, b: Row): boolean => {
    if (a?.kind !== 'message' || b.kind !== 'message') return false
    if (a.message.role !== b.message.role || hasReaction(a.message.id)) return false
    const gap = Date.parse(b.message.created_at) - Date.parse(a.message.created_at)
    return Number.isFinite(gap) && gap >= 0 && gap < GROUP_WINDOW_MS
  }
  let seenMessage = false
  return rows.map((row, index) => {
    if (row.kind !== 'message') return row
    const first = !seenMessage
    seenMessage = true
    return { ...row, first, grouping: { prev: canGroup(rows[index - 1], row), next: index + 1 < rows.length && canGroup(row, rows[index + 1]!) } }
  })
}

/**
 * Folds consecutive tool messages into one row.
 *
 * The store records one message per tool call, which is the right shape for
 * state but the wrong one for reading: a turn that reads four files and runs a
 * command becomes five stacked cards between the question and the answer.
 * Grouping happens here, at render time, so the store stays a faithful log.
 */
function toRows(messages: Message[]): Row[] {
  const rows: Row[] = []
  let previous: Date | null = null

  for (const message of messages) {
    // Muse's buildTimestampMarkers: one stamp per stretch of conversation, not
    // one per line — before the first message, on a new day, or after a pause.
    const at = new Date(message.created_at)
    if (!Number.isNaN(at.getTime())) {
      if (!previous || at.toDateString() !== previous.toDateString() || at.getTime() - previous.getTime() > TIME_BREAK_MS) {
        rows.push({ kind: 'time', key: `time_${message.id}`, at: message.created_at })
      }
      previous = at
    }

    if (message.role === 'tool') {
      // Tool messages with no structured calls carry raw reconciled I/O; the
      // bubble already declines to render those, so they are dropped here too.
      const calls = message.tool_calls
      if (!calls?.length) continue

      const previous = rows.at(-1)
      if (previous?.kind === 'tools') {
        previous.calls.push(...calls)
        continue
      }
      rows.push({ kind: 'tools', key: `tools_${message.id}`, calls: [...calls] })
      continue
    }

    rows.push({ kind: 'message', key: message.id, message })
  }

  return rows
}

/** Scrolling thread view. Auto-follows new content only while the user is already near the bottom. */
/**
 * Memoised: the composer lives in the same screen, so without this every
 * keystroke re-rendered the whole thread (measured 180–450ms per character in
 * the dev build on a long chat).
 */
export const MessageList = memo(function MessageList({
  messages,
  streamingText,
  streamingThinking,
  isTyping,
  className,
  onReply,
  avatar,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)
  const reactions = useReactionsStore((state) => state.byMessage)
  const rows = useMemo(() => groupRows(toRows(messages), (id) => Boolean(reactions[id]?.length)), [messages, reactions])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !wasNearBottom.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamingText, streamingThinking, isTyping])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }

  // Reasoning usually starts before the first token of the answer, so the
  // bubble has to appear for thinking alone — otherwise a long planning phase
  // looks like the agent is doing nothing.
  const showStreaming = !!streamingText || !!streamingThinking
  const liveState = liveAvatarState(messages, showStreaming || !!isTyping, streamingText ?? '')
  const liveFace = avatar && <LiveFace config={avatar} state={liveState} text={streamingText ?? ''} />

  return (
    <div ref={scrollRef} onScroll={handleScroll} className={cn('flex-1 overflow-y-auto px-2 pb-4 pt-3', className)}>
      {rows.map((row, index) =>
        row.kind === 'time' ? (
          <p key={row.key} className={cn('text-center text-muse-artifact-meta text-content-secondary', index === 0 ? 'pb-4 pt-10' : 'py-4')}>
            {timeLabel(row.at)}
          </p>
        ) : row.kind === 'tools' ? (
          <div key={row.key} className="my-1 flex min-w-0 flex-col gap-1 px-6">
            <ToolGroup calls={row.calls} />
          </div>
        ) : (
          <MessageBubble
            key={row.key}
            message={row.message}
            onReply={onReply}
            grouping={row.grouping}
            avatar={avatar}
            showFace={!row.grouping?.next}
            className={row.grouping?.prev ? 'mb-0 mt-1' : row.first ? 'mb-0 mt-0' : 'mb-0 mt-4'}
          />
        ),
      )}

      {showStreaming && (
        <div className={cn('my-1.5 flex px-6', liveFace && 'items-end gap-2')}>
          {liveFace}
          <div className="muse-chat-bubble flex max-w-[84%] flex-col gap-1 rounded-bubble bg-bg-card px-3 py-2">
            {streamingThinking && <ThinkingBlock text={streamingThinking} streaming />}
            {streamingText && <StreamingText text={streamingText} />}
          </div>
        </div>
      )}

      {!showStreaming && isTyping && (liveFace ? (
        <div className="my-1 flex items-center gap-2 px-6">
          {liveFace}
          <TypingIndicator className="my-0 px-0" />
        </div>
      ) : <TypingIndicator />)}
    </div>
  )
})
