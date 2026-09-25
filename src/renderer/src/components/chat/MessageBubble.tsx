import { memo } from 'react'
import type { BotSummary } from '@shared/ipc'
import type { Message } from '@/types'
import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/primitives'
import { cn } from '@/lib/cn'
import { AvatarBadge, type AvatarConfig } from '@/features/avatar'
import { textTintForBot } from './BotAvatar'
import { MarkdownMessage } from './MarkdownMessage'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCard } from './ToolCard'
import { AttachmentChip } from './AttachmentChip'
import { MessageToolbar, ReactionBadge } from './MessageToolbar'

/** Muse's grouping: whether this bubble joins the one before / after it. */
export interface BubbleGrouping {
  prev: boolean
  next: boolean
}

/** Muse radiusFor: 22px, tucked to 6px on the speaker's side where grouped bubbles meet. */
export function bubbleRadius(isUser: boolean, grouping: BubbleGrouping | undefined): string | undefined {
  if (!grouping || (!grouping.prev && !grouping.next)) return undefined
  const tuck = (on: boolean) => (on ? '6px' : '22px')
  // top-left top-right bottom-right bottom-left
  return isUser
    ? `22px ${tuck(grouping.prev)} ${tuck(grouping.next)} 22px`
    : `${tuck(grouping.prev)} 22px 22px ${tuck(grouping.next)}`
}

interface MessageBubbleProps {
  grouping?: BubbleGrouping
  message: Message
  /**
   * Who said it, when that is not obvious.
   *
   * A one-to-one thread has exactly one possible speaker, so naming it every
   * turn is noise. A group has up to six, and an unlabelled reply in a group is
   * unreadable — so the face and the name appear only when there is a question
   * to answer.
   */
  author?: BotSummary | null
  className?: string
  onReply?: (message: Message) => void
  /**
   * The agent's live avatar beside its replies. Given, an assistant row keeps a
   * face column; `showFace` puts the face on the last bubble of a group and
   * leaves the column empty on the others, so grouped bubbles stay aligned.
   * Pass a stable reference — this component is memoised.
   */
  avatar?: AvatarConfig
  showFace?: boolean
}

/** Edge of the face beside assistant bubbles, px. */
export const BUBBLE_FACE_SIZE = 32
/** A disc behind the face, so a figure with a transparent background reads as an avatar, not a sticker. */
export const BUBBLE_FACE_CLASS = 'mb-0.5 rounded-full bg-bg-card'

/** Renders one turn: user (right, primary), assistant (left, card), or tool (left, ToolCard list). */
export const MessageBubble = memo(function MessageBubble({ message, author, className, onReply, grouping, avatar, showFace }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  // An assistant turn that was only a tool call has no text, and a bubble
  // around nothing renders as a small empty capsule — the visual equivalent of
  // a message that failed to load. The tool cards next to it already say what
  // happened.
  if (
    !isUser &&
    !isTool &&
    !message.content.trim() &&
    !message.thinking?.trim() &&
    !message.attachments?.length
  ) {
    return null
  }

  if (isTool) {
    // A tool message without structured calls is raw reconciled I/O — showing it
    // would dump unstructured JSON into the thread, so it renders nothing.
    if (!message.tool_calls?.length) return null
    return (
      <div className={cn('my-1 flex flex-col gap-1 px-6', className)}>
        {message.tool_calls.map((call) => (
          <ToolCard key={call.id} call={call} />
        ))}
      </div>
    )
  }

  // A face only where the thread asks for one (the agent's live avatar in a
  // one-to-one chat, once per group of bubbles); in a group chat the name goes
  // inside the bubble, in that bot's own colour, which is both smaller and
  // easier to follow.
  const face = !isUser && avatar
  return (
    // `data-message-id` is the gateway's transcript id — the anchor a search hit jumps to.
    <div data-message-role={message.role} data-message-id={message.id} className={cn('group relative my-1.5 flex px-6', isUser ? 'flex-col items-end' : face ? 'flex-row items-end gap-2' : 'flex-col items-start', className)}>
      {face && (showFace ? <AvatarBadge config={avatar} size={BUBBLE_FACE_SIZE} className={BUBBLE_FACE_CLASS} /> : <span aria-hidden className="shrink-0" style={{ width: BUBBLE_FACE_SIZE }} />)}
      {/* Two bubbles, no borders, no brand colour: the bot speaks in grey and
          the user answers in cream. Colour in a transcript should mean "this
          is a different voice", and a bordered card in an accent hue means
          neither. */}
      <div className={cn('muse-bubble-slot relative', face && 'min-w-0')}>
      <div
        className={cn(
          'muse-chat-bubble flex max-w-[84%] flex-col gap-1 rounded-bubble px-3 py-2',
          isUser ? 'bg-bg-mine text-content-mine' : 'bg-bg-card',
        )}
        style={{ borderRadius: bubbleRadius(isUser, grouping) }}
      >
        {!!message.attachments?.length && (
          <div className="flex flex-wrap gap-1.5">
            {message.attachments.map((att) => (
              <AttachmentChip key={att.id} attachment={att} />
            ))}
          </div>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap text-caption text-content-mine">{message.content}</p>
        ) : (
          <>
            {author && (
              <span className={cn('text-caption font-semibold', textTintForBot(author.id))}>
                {author.name}
              </span>
            )}
            {message.thinking && <ThinkingBlock text={message.thinking} />}
            {message.status === 'failed' ? (
              // Muse HatchChatMessageErrorBubble: the ordinary bubble, a muted
              // alert glyph and italic subheadline text — a failure reads as
              // one without turning the thread red.
              <p role="alert" className="flex items-start gap-2 whitespace-pre-wrap text-body-sm italic text-content-primary">
                <Icon icon={AlertCircleIcon} size={16} className="mt-0.5 shrink-0 text-content-primary/60" />
                <span>{message.content}</span>
              </p>
            ) : (
              <MarkdownMessage content={message.content} />
            )}
          </>
        )}
        {/* No per-bubble clock. A messages app stamps a *break* in the
            conversation, not every line — see `TimeSeparator`. */}
      </div>
      <ReactionBadge messageId={message.id} isUser={isUser} />
      <MessageToolbar message={message} isUser={isUser} onReply={onReply} />
      </div>
    </div>
  )
})
