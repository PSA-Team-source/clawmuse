import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Add01Icon, Delete02Icon, MoreVerticalIcon, UserGroupIcon } from '@hugeicons/core-free-icons'
import type { BotSummary } from '@shared/ipc'
import { GhostButton, IconButton } from '@/components/brand'
import { BotAvatar, ChatComposer, MessageBubble } from '@/components/chat'
import { EmptyState } from '@/components/patterns'
import { Dialog, Icon, Menu } from '@/components/primitives'
import { groupSessionKey } from '@/services/session-key'
import { PendingQuestions } from '@/components/questions'
import { useBotsStore } from '@/stores/bots.store'
import { useChatStore } from '@/stores/chat.store'
import { useGatewayStore } from '@/stores/gateway.store'
import { MAX_GROUP_BOTS, useGroupsStore } from '@/stores/groups.store'
import type { Message } from '@/types'
import { MentionAutocomplete, addressedBots, stripMentions } from './mentions'

/**
 * A group chat — two to six bots in one thread.
 *
 * There is no group primitive in the gateway, and there does not need to be:
 * each member has its own session under the same conversation id, so this
 * screen fans a turn out and interleaves the replies. What that buys is real —
 * every bot keeps its own memory of the conversation, which is what makes a
 * six-bot thread useful rather than six copies of the same context.
 *
 * Addressing follows Grok Bot's: `@name` sends to those bots only, no mention
 * sends to everyone. The prompt tells each bot who else is in the room and to
 * stay quiet when the question is not theirs — a group where all six answer
 * every message is a group nobody reads.
 */

/** Assistant turns that are only a silent token never belong in the transcript. */
function isSilent(message: Message): boolean {
  return message.role === 'assistant' && /^(no_reply|reply_skip)$/i.test(message.content.trim())
}

export default function GroupThreadScreen() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()

  const group = useGroupsStore((state) => state.groups.find((entry) => entry.id === groupId))
  const addMember = useGroupsStore((state) => state.addMember)
  const removeGroup = useGroupsStore((state) => state.remove)
  const bots = useBotsStore((state) => state.bots)

  const messagesBySession = useChatStore((state) => state.messages)
  const streamingText = useChatStore((state) => state.streamingText)
  const isTypingMap = useChatStore((state) => state.isTyping)
  const loadMessages = useChatStore((state) => state.loadMessages)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const connectionState = useGatewayStore((state) => state.connectionState)

  const location = useLocation()
  const [text, setText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const seedSent = useRef(false)

  const members = useMemo(
    () =>
      (group?.members ?? [])
        .map((id) => bots.find((bot) => bot.id === id))
        .filter((bot): bot is BotSummary => Boolean(bot)),
    [group, bots],
  )

  // One transcript per member, loaded once each. Deliberately keyed on the id
  // list rather than the objects: a roster refresh must not refetch six
  // transcripts.
  const memberIds = members.map((bot) => bot.id).join(',')
  useEffect(() => {
    if (!groupId) return
    for (const id of memberIds.split(',').filter(Boolean)) {
      void loadMessages(groupSessionKey(id, groupId))
    }
  }, [memberIds, groupId, loadMessages])

  /**
   * The merged transcript.
   *
   * Every member sees the user's turn, so the same user message exists in six
   * sessions. Showing it six times would be absurd — it is de-duplicated by
   * content and minute, and only assistant turns are attributed.
   */
  const timeline = useMemo(() => {
    if (!groupId) return []
    const rows: { message: Message; author: BotSummary | null }[] = []
    const seenUserTurns = new Set<string>()

    for (const bot of members) {
      const key = groupSessionKey(bot.id, groupId)
      for (const message of messagesBySession[key] ?? []) {
        if (isSilent(message)) continue
        if (message.role === 'user') {
          const stamp = `${message.content}@${message.created_at.slice(0, 16)}`
          if (seenUserTurns.has(stamp)) continue
          seenUserTurns.add(stamp)
          rows.push({ message, author: null })
          continue
        }
        rows.push({ message, author: bot })
      }
    }

    return rows.sort((a, b) => a.message.created_at.localeCompare(b.message.created_at))
  }, [members, messagesBySession, groupId])

  const working = members.filter(
    (bot) => groupId && isTypingMap[groupSessionKey(bot.id, groupId)],
  )

  /**
   * Fans one turn out to the addressed members, or to the room.
   *
   * Defined here rather than inside the render body because the seed effect
   * below needs it, and effects cannot sit after the not-found return.
   */
  const dispatch = useCallback(
    (body: string) => {
      if (!group || !groupId || !body.trim()) return
      const targets = addressedBots(body, members)
      const recipients = targets.length > 0 ? targets : members

      for (const bot of recipients) {
        // Each bot is told who else is here and that silence is allowed.
        // Without it, an unaddressed question gets the same answer from
        // everyone.
        const others = members.filter((member) => member.id !== bot.id).map((member) => member.name)
        const preamble =
          others.length > 0
            ? `[Group chat "${group.name}" — also here: ${others.join(', ')}. Answer only if this is yours to answer; reply with exactly NO_REPLY if it is not. Use sessions_send to hand work to another member, and say in the thread when you do.]\n\n`
            : ''
        void sendMessage(
          groupSessionKey(bot.id, groupId),
          `${preamble}${stripMentions(body, members)}`,
        )
      }
    },
    [group, groupId, members, sendMessage],
  )

  /**
   * The message that created this group.
   *
   * An `@` in a one-to-one thread promotes the conversation to a group, and the
   * turn the user actually typed has to arrive here rather than being lost in
   * the navigation.
   */
  useEffect(() => {
    const seed = (location.state as { seed?: string } | null)?.seed
    if (!seed || seedSent.current || members.length === 0) return
    seedSent.current = true
    dispatch(seed)
    // Replace the history entry so a back-and-forward does not send it twice.
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, members.length, dispatch, navigate])

  if (!group || !groupId) {
    return (
      <div className="flex h-full min-w-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<Icon icon={UserGroupIcon} size={44} className="text-content-disabled" />}
          title="Group not found"
        />
      </div>
    )
  }

  function send(): void {
    const body = text.trim()
    if (!body) return
    setText('')
    dispatch(body)
  }

  const candidates = bots.filter((bot) => !group.members.includes(bot.id))
  const isConnected = connectionState === 'connected'

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line-hairline px-5 py-3">
        <div className="flex shrink-0 -space-x-2">
          {members.slice(0, 4).map((bot) => (
            <BotAvatar
              key={bot.id}
              id={bot.id}
              name={bot.name}
              emoji={bot.emoji}
              avatar={bot.avatar}
              size={30}
              className="ring-2 ring-bg-base"
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-headline font-bold text-content-primary">{group.name}</h1>
          <p className="truncate text-caption text-content-tertiary">
            {working.length > 0
              ? `${working.map((bot) => bot.name).join(', ')} working…`
              : members.map((bot) => bot.name).join(', ')}
          </p>
        </div>

        <Menu
          trigger={<IconButton icon={MoreVerticalIcon} label="Group actions" shape="circle" />}
        >
          {candidates.length > 0 && members.length < MAX_GROUP_BOTS && (
            <>
              {candidates.slice(0, 8).map((bot) => (
                <Menu.Item key={bot.id} onClick={() => addMember(group.id, bot.id)}>
                  <Icon icon={Add01Icon} size={15} className="text-current" />
                  Add {bot.name}
                </Menu.Item>
              ))}
              <Menu.Separator />
            </>
          )}
          <Menu.Item tone="danger" onClick={() => setConfirmDelete(true)}>
            <Icon icon={Delete02Icon} size={15} className="text-current" />
            Delete group
          </Menu.Item>
        </Menu>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        {timeline.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Icon icon={UserGroupIcon} size={40} className="text-content-disabled" />}
              title={`${members.length} bots, one thread`}
              description="Ask the room. Address one with @ if the work is theirs; they can hand it to each other from here."
            />
          </div>
        ) : (
          <>
            {timeline.map((row, index) => (
              <MessageBubble
                key={`${row.message.id}-${index}`}
                message={row.message}
                author={row.author}
              />
            ))}
            {/* Live text, one block per bot still writing. */}
            {members.map((bot) => {
              const streaming = streamingText[groupSessionKey(bot.id, groupId)]
              if (!streaming) return null
              return (
                <MessageBubble
                  key={`streaming-${bot.id}`}
                  author={bot}
                  message={{
                    id: `streaming-${bot.id}`,
                    session_id: groupSessionKey(bot.id, groupId),
                    role: 'assistant',
                    content: streaming,
                    status: 'streaming',
                    created_at: new Date().toISOString(),
                  }}
                />
              )
            })}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-line-hairline px-4 py-3">
        {groupId && <PendingQuestions sessionKeys={members.map((bot) => groupSessionKey(bot.id, groupId))} />}
        <MentionAutocomplete
          text={text}
          bots={members}
          onPick={(bot) => setText((current) => current.replace(/@(\w*)$/, `@${bot.name} `))}
        />
        <ChatComposer
          value={text}
          onChange={setText}
          onSend={send}
          disabled={!isConnected}
          placeholder={isConnected ? 'Message the group — @ to address one' : 'Reconnecting…'}
          autoFocus
        />
      </div>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${group.name}?`}
        description="The group disappears from the roster. Each bot keeps its own memory of what was said."
      >
        <div className="flex justify-end gap-2">
          <GhostButton onClick={() => setConfirmDelete(false)}>Cancel</GhostButton>
          <GhostButton
            className="border-error/40 bg-error/10 text-error"
            onClick={() => {
              removeGroup(group.id)
              navigate('/chat')
            }}
          >
            Delete
          </GhostButton>
        </div>
      </Dialog>
    </div>
  )
}
