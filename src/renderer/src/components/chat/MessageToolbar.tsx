import { useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { ArrowTurnBackwardIcon, Copy01Icon, MoreHorizontalIcon, Share08Icon, SmileIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { Message } from '@/types'
import { cn } from '@/lib/cn'
import { Icon, Menu, Tooltip } from '@/components/primitives'
import { REACTION_EMOJIS, useReactionsStore } from '@/stores/reactions.store'
import { shareCard } from '@/stores/share-card.store'

/** One shared empty list: a fresh [] per selector call would loop zustand's store subscription. */
const NONE: string[] = []
const BUTTON = 'flex size-6 items-center justify-center rounded-full text-content-secondary hover:bg-fill-strong hover:text-content-primary'

/**
 * Muse's message toolbar (IconRailButton size 24, borderless): React (agent
 * messages), Reply, Copy, Share (agent answers), More — beside the bubble,
 * shown on hover or focus.
 */
export function MessageToolbar({ message, isUser, onReply }: { message: Message; isUser: boolean; onReply?: (message: Message) => void }) {
  const [copied, setCopied] = useState(false)
  const [picking, setPicking] = useState(false)
  const reactions = useReactionsStore((state) => state.byMessage[message.id] ?? NONE)
  const toggle = useReactionsStore((state) => state.toggle)
  const canReact = !isUser && message.status !== 'failed'
  const canShare = canReact && message.status !== 'streaming' && Boolean(message.content.trim())
  const share = (): void => shareCard({ kind: 'answer', body: message.content })

  function copy(): void {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      data-copy-exclude
      className={cn(
        'absolute inset-y-0 my-auto flex h-fit scale-95 items-center opacity-0 transition-[opacity,scale] group-hover:scale-100 group-hover:opacity-100 focus-within:scale-100 focus-within:opacity-100 has-[[data-popup-open]]:scale-100 has-[[data-popup-open]]:opacity-100',
        isUser ? 'right-full mr-1' : 'left-full ml-1',
      )}
    >
      {canReact && (
        <Popover.Root open={picking} onOpenChange={setPicking}>
          <Tooltip content="React"><Popover.Trigger aria-label="React" className={BUTTON}><Icon icon={SmileIcon} size={16} /></Popover.Trigger></Tooltip>
          <Popover.Portal>
            <Popover.Positioner side="top" sideOffset={4} className="z-50">
              <Popover.Popup className="flex items-center gap-0.5 rounded-full bg-bg-panel px-2.5 py-1.5 shadow-popup">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-pressed={reactions.includes(emoji)}
                    aria-label={`React ${emoji}`}
                    onClick={() => { toggle(message.id, emoji); setPicking(false) }}
                    className={cn('flex size-7 items-center justify-center rounded-full text-title-3 transition-transform', reactions.includes(emoji) ? 'bg-fill-strong' : 'hover:scale-125')}
                  >
                    {emoji}
                  </button>
                ))}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
      {onReply && <Tooltip content="Reply"><button type="button" aria-label="Reply" onClick={() => onReply(message)} className={BUTTON}><Icon icon={ArrowTurnBackwardIcon} size={16} /></button></Tooltip>}
      <Tooltip content={copied ? 'Copied' : 'Copy'}><button type="button" aria-label="Copy" onClick={copy} className={BUTTON}><Icon icon={copied ? Tick02Icon : Copy01Icon} size={16} /></button></Tooltip>
      {canShare && <Tooltip content="Share as image"><button type="button" aria-label="Share" onClick={share} className={BUTTON}><Icon icon={Share08Icon} size={16} /></button></Tooltip>}
      <Menu align="end" trigger={<button type="button" aria-label="More options" className={BUTTON}><Icon icon={MoreHorizontalIcon} size={16} /></button>}>
        <p className="px-3 py-1.5 text-caption text-content-secondary">{new Date(message.created_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>
        {onReply && <Menu.Item onClick={() => onReply(message)}>Reply</Menu.Item>}
        <Menu.Item onClick={copy}>Copy</Menu.Item>
        {canShare && <Menu.Item onClick={share}>Share</Menu.Item>}
      </Menu>
    </div>
  )
}

/** Muse's reaction badge on the bubble's corner. */
export function ReactionBadge({ messageId, isUser }: { messageId: string; isUser: boolean }) {
  const reactions = useReactionsStore((state) => state.byMessage[messageId] ?? NONE)
  if (!reactions.length) return null
  return (
    <span aria-label={`Your reaction: ${reactions.join(' ')}`} className={cn('absolute -bottom-3 flex items-center gap-0.5 rounded-full bg-bg-panel px-1.5 py-0.5 text-caption shadow-composer', isUser ? 'left-2' : 'right-2')}>
      {reactions.join('')}
    </span>
  )
}
