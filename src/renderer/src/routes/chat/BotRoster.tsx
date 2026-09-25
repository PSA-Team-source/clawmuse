import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  EyeIcon,
  MoreVerticalIcon,
  PinIcon,
  Search01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import type { BotDraft, BotSummary } from '@shared/ipc'
import { GhostButton, GradientButton, IconButton, Skeleton } from '@/components/brand'
import { BotAvatar } from '@/components/chat'
import { EmptyState, TextField, useToast } from '@/components/patterns'
import { Dialog, Icon, Menu } from '@/components/primitives'
import { useDebounced } from '@/hooks'
import { cn } from '@/lib/cn'
import { botMainSessionKey, groupIdFromSessionKey } from '@/services/session-key'
import { StatusPill } from '@/components/gateway'
import { formatTokens } from '@/services/local-usage'
import { useLocalUsage } from '@/hooks'
import { approvalBotId, useApprovalsStore } from '@/stores/approvals.store'
import { type RosterRow, sortRoster, useBotsStore } from '@/stores/bots.store'
import { useChatStore } from '@/stores/chat.store'
import { useGatewayStore } from '@/stores/gateway.store'
import { formatRelativeTime, truncate } from '@/utils/format'
import { BotSheet } from './BotSheet'
import { GroupSheet } from './GroupSheet'
import { GroupRow, useGroups } from './groups'

/**
 * The roster — the left column, and the whole navigation model.
 *
 * Every row is a bot you can message, ordered the way a messages app orders
 * conversations: pinned first, then whoever spoke last. There is no nav rail
 * above it, because the product is not a set of screens with a chat in one of
 * them; it is a team, and everything else is reachable from the menu bar and
 * ⌘K.
 */

function RosterRowView({
  row,
  waiting,
  active,
  menuOpen,
  onSelect,
  onToggleMenu,
  onCloseMenu,
  onEdit,
  onDuplicate,
  onDelete,
  onCopyId,
}: {
  row: RosterRow
  /** This bot has stopped and is waiting on an approval. */
  waiting: boolean
  active: boolean
  menuOpen: boolean
  onSelect: () => void
  onToggleMenu: () => void
  onCloseMenu: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onCopyId: () => void
}) {
  const togglePinned = useBotsStore((state) => state.togglePinned)
  const toggleHidden = useBotsStore((state) => state.toggleHidden)
  const markUnread = useBotsStore((state) => state.markUnread)

  return (
    <div className={cn('group relative rounded-field', active && 'bg-fill-accent')}>
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={(event) => {
          event.preventDefault()
          onToggleMenu()
        }}
        className="flex w-full items-start gap-2.5 rounded-field py-2.5 pl-2.5 pr-9 text-left transition-colors hover:bg-fill-raised"
      >
        <BotAvatar
          id={row.bot.id}
          name={row.bot.name}
          emoji={row.bot.emoji}
          avatar={row.bot.avatar}
          size={34}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {row.pinned && <Icon icon={PinIcon} size={11} className="shrink-0 text-content-faint" />}
            <span className="truncate text-body-sm font-semibold text-content-primary">
              {row.bot.name}
            </span>
            <span className="ml-auto shrink-0 text-micro text-content-faint">
              {row.lastMessageAt ? formatRelativeTime(row.lastMessageAt) : ''}
            </span>
          </div>
          {/* Waiting outranks everything: the bot has stopped, and the row is
              where the user finds out. The job stands in until there is a
              conversation to preview — a row that says nothing about what the
              bot does is not scannable. */}
          {/* No filler: a row with nothing to say says nothing and closes up.
              "No messages yet" is a label for absent data, which reads as
              something that failed rather than something that has not happened
              yet. */}
          {(waiting || row.lastMessage || row.bot.job) && (
            <p
              className={cn(
                'truncate text-caption',
                waiting ? 'font-medium text-seam-orange' : 'text-content-tertiary',
              )}
            >
              {waiting
                ? 'Waiting for your approval'
                : row.lastMessage
                  ? truncate(row.lastMessage, 64)
                  : row.bot.job}
            </p>
          )}
        </div>
        {row.unread && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
      </button>

      <Menu
        open={menuOpen}
        onOpenChange={(next) => {
          if (!next) onCloseMenu()
        }}
        trigger={
          <IconButton
            icon={MoreVerticalIcon}
            label={`Actions for ${row.bot.name}`}
            size="xs"
            shape="circle"
            onClick={onToggleMenu}
            className="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100"
          />
        }
      >
        <Menu.Item
          onClick={() => {
            togglePinned(row.bot.id)
            onCloseMenu()
          }}
        >
          <Icon icon={PinIcon} size={15} className="text-current" />
          {row.pinned ? 'Unpin' : 'Pin'}
        </Menu.Item>
        <Menu.Item
          onClick={() => {
            markUnread(row.bot.id)
            onCloseMenu()
          }}
        >
          <Icon icon={EyeIcon} size={15} className="text-current" />
          Mark unread
        </Menu.Item>
        <Menu.Item onClick={onEdit}>
          <Icon icon={Edit02Icon} size={15} className="text-current" />
          Edit profile
        </Menu.Item>
        <Menu.Item onClick={onDuplicate}>
          <Icon icon={Copy01Icon} size={15} className="text-current" />
          Duplicate
        </Menu.Item>
        <Menu.Item onClick={onCopyId}>
          <Icon icon={Copy01Icon} size={15} className="text-current" />
          Copy conversation ID
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item
          onClick={() => {
            toggleHidden(row.bot.id)
            onCloseMenu()
          }}
        >
          <Icon icon={EyeIcon} size={15} className="text-current" />
          Hide
        </Menu.Item>
        {/* The built-in bot has no delete: OpenClaw reserves `main`, and a menu
            item that always fails is worse than one that is not there. */}
        {!row.bot.isDefault && (
          <Menu.Item tone="danger" onClick={onDelete}>
            <Icon icon={Delete02Icon} size={15} className="text-current" />
            Delete
          </Menu.Item>
        )}
      </Menu>
    </div>
  )
}

export function BotRoster() {
  const navigate = useNavigate()
  const { sessionId: activeSessionId } = useParams()
  const { show } = useToast()

  const bots = useBotsStore((state) => state.bots)
  const loaded = useBotsStore((state) => state.loaded)
  const pinned = useBotsStore((state) => state.pinned)
  const hidden = useBotsStore((state) => state.hidden)
  const unread = useBotsStore((state) => state.unread)
  const load = useBotsStore((state) => state.load)
  const create = useBotsStore((state) => state.create)
  const update = useBotsStore((state) => state.update)
  const duplicate = useBotsStore((state) => state.duplicate)
  const remove = useBotsStore((state) => state.remove)
  const clearUnread = useBotsStore((state) => state.clearUnread)

  const approvals = useApprovalsStore((state) => state.queue)
  const sessions = useChatStore((state) => state.sessions)
  const loadSessions = useChatStore((state) => state.loadSessions)
  const connectionState = useGatewayStore((state) => state.connectionState)
  const groups = useGroups()
  const { data: localUsage } = useLocalUsage(connectionState === 'connected')

  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 150)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [sheetFor, setSheetFor] = useState<BotSummary | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BotSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [groupSheetOpen, setGroupSheetOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadSessions()
    // Refresh once on mount and again whenever the gateway (re)connects: a bot
    // seeded during boot appears in the roster without a relaunch.
  }, [loadSessions, connectionState])

  // The roster refreshes on reconnect too — `seedRoster` runs in main right
  // after the gateway is ready, which is usually *after* the first render.
  useEffect(() => {
    if (connectionState === 'connected') void load()
  }, [connectionState, load])

  const rows = useMemo(() => {
    const byId = new Map(sessions.map((session) => [session.id, session]))
    const built: RosterRow[] = bots.map((bot) => {
      const sessionId = botMainSessionKey(bot.id)
      const session = byId.get(sessionId)
      return {
        bot,
        sessionId,
        ...(session?.last_message ? { lastMessage: session.last_message } : {}),
        ...(session?.last_message_at ? { lastMessageAt: session.last_message_at } : {}),
        unread: unread.includes(bot.id) || Boolean(session?.unread || session?.unread_count),
        pinned: pinned.includes(bot.id),
      }
    })
    return sortRoster(built)
  }, [bots, sessions, pinned, unread])

  /**
   * Conversations that are not a bot's own thread — a Telegram chat, a skill
   * session, an older conversation. The roster is about bots, but dropping
   * these would strand them: nothing else in the app lists them.
   */
  const otherThreads = useMemo(() => {
    const botKeys = new Set(bots.map((bot) => botMainSessionKey(bot.id)))
    return sessions.filter(
      (session) => !botKeys.has(session.id) && !groupIdFromSessionKey(session.id),
    )
  }, [sessions, bots])

  const visible = useMemo(() => {
    const query = debounced.trim().toLowerCase()
    return rows.filter((row) => {
      if (!showHidden && hidden.includes(row.bot.id)) return false
      if (!query) return true
      return (
        row.bot.name.toLowerCase().includes(query) ||
        row.bot.job.toLowerCase().includes(query) ||
        (row.lastMessage?.toLowerCase().includes(query) ?? false)
      )
    })
  }, [rows, hidden, showHidden, debounced])

  function openBot(row: RosterRow): void {
    clearUnread(row.bot.id)
    navigate(`/chat/${encodeURIComponent(row.sessionId)}`)
  }

  async function submitSheet(draft: BotDraft): Promise<{ ok: boolean; error?: string }> {
    const result = sheetFor ? await update(sheetFor.id, draft) : await create(draft)
    if (result.ok && !sheetFor && 'bot' in result && result.bot) {
      navigate(`/chat/${encodeURIComponent(botMainSessionKey(result.bot.id))}`)
    }
    return result
  }

  async function handleDuplicate(bot: BotSummary): Promise<void> {
    setOpenMenuId(null)
    const result = await duplicate(bot.id, `${bot.name} copy`)
    if (!result.ok) {
      show({ title: 'Could not duplicate', description: result.error, variant: 'error' })
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await remove(deleteTarget.id)
    setDeleting(false)
    if (!result.ok) {
      show({ title: 'Could not delete', description: result.error, variant: 'error' })
      return
    }
    if (activeSessionId === botMainSessionKey(deleteTarget.id)) navigate('/chat')
    setDeleteTarget(null)
  }

  const waitingOn = useMemo(
    () => new Set(approvals.map((approval) => approvalBotId(approval) ?? 'main')),
    [approvals],
  )
  const hiddenCount = rows.length - rows.filter((row) => !hidden.includes(row.bot.id)).length
  const activeGroupId = activeSessionId ? groupIdFromSessionKey(activeSessionId) : null

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-line-hairline bg-bg-surface/40">
      {/* The traffic lights live here (`hiddenInset`), so the strip is empty
          apart from the one control that belongs at the top of a roster. No
          title: the window is the roster. */}
      <div className="drag flex h-13 shrink-0 items-center justify-end px-3">
        <Menu
          trigger={
            <IconButton
              icon={Add01Icon}
              label="New bot or group"
              shape="circle"
              className="no-drag"
            />
          }
        >
          <Menu.Item
            onClick={() => {
              setSheetFor(null)
              setSheetOpen(true)
            }}
          >
            <Icon icon={Add01Icon} size={15} className="text-current" />
            New bot
          </Menu.Item>
          <Menu.Item disabled={bots.length < 2} onClick={() => setGroupSheetOpen(true)}>
            <Icon icon={UserGroupIcon} size={15} className="text-current" />
            New group
          </Menu.Item>
        </Menu>
      </div>

      <div className="px-3 pb-2">
        <TextField value={search} onChange={setSearch} placeholder="Search" icon={Search01Icon} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!loaded ? (
          <div className="flex flex-col gap-1 p-1">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex items-center gap-2.5 p-2.5">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 && groups.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Icon icon={UserGroupIcon} size={36} className="text-content-disabled" />}
              title={search ? 'No matches' : 'No bots yet'}
              description={
                search ? 'Try a different search.' : 'Create one and give it a job to own.'
              }
              action={
                !search && (
                  <GradientButton
                    size="sm"
                    onClick={() => {
                      setSheetFor(null)
                      setSheetOpen(true)
                    }}
                  >
                    New bot
                  </GradientButton>
                )
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {groups.length > 0 && (
              <>
                {groups.map((group) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    bots={bots}
                    active={group.id === activeGroupId}
                    onSelect={() => navigate(`/chat/group/${encodeURIComponent(group.id)}`)}
                  />
                ))}
              </>
            )}

            {visible.map((row) => (
              <RosterRowView
                key={row.bot.id}
                row={row}
                waiting={waitingOn.has(row.bot.id)}
                active={row.sessionId === activeSessionId}
                menuOpen={openMenuId === row.bot.id}
                onSelect={() => openBot(row)}
                onToggleMenu={() =>
                  setOpenMenuId((current) => (current === row.bot.id ? null : row.bot.id))
                }
                onCloseMenu={() => setOpenMenuId(null)}
                onEdit={() => {
                  setOpenMenuId(null)
                  setSheetFor(row.bot)
                  setSheetOpen(true)
                }}
                onDuplicate={() => void handleDuplicate(row.bot)}
                onDelete={() => {
                  setOpenMenuId(null)
                  setDeleteTarget(row.bot)
                }}
                onCopyId={() => {
                  setOpenMenuId(null)
                  void navigator.clipboard.writeText(row.sessionId)
                  show({ title: 'Conversation ID copied', variant: 'success' })
                }}
              />
            ))}

            {otherThreads.length > 0 && (
              <>
                {otherThreads.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => navigate(`/chat/${encodeURIComponent(session.id)}`)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-field py-2.5 pl-2.5 pr-3 text-left transition-colors',
                      session.id === activeSessionId ? 'bg-fill-accent' : 'hover:bg-fill-raised',
                    )}
                  >
                    {/* Same rhythm as a bot row — a list where some rows have a
                        face and others are bare text reads as two lists. */}
                    <BotAvatar id={session.id} name={session.name} size={34} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-body-sm font-semibold text-content-primary">
                          {session.name}
                        </span>
                        <span className="ml-auto shrink-0 text-micro text-content-faint">
                          {session.last_message_at ? formatRelativeTime(session.last_message_at) : ''}
                        </span>
                      </span>
                      {session.last_message && (
                        <span className="block truncate text-caption text-content-tertiary">
                          {truncate(session.last_message, 60)}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </>
            )}

            {hiddenCount > 0 && (
              <GhostButton
                size="sm"
                className="mt-2 self-start"
                onClick={() => setShowHidden((current) => !current)}
              >
                {showHidden ? 'Hide hidden' : `Show ${hiddenCount} hidden`}
              </GhostButton>
            )}
          </div>
        )}
      </div>

      {/* Out of the conversation, never more than a glance away. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line-hairline px-3 py-2">
        {localUsage && localUsage.periodTokens > 0 && (
          <span
            className="truncate text-micro text-content-faint"
            title={`${localUsage.periodTokens.toLocaleString()} tokens in the last ${localUsage.days} days${
              localUsage.periodCost > 0
                ? ` · $${localUsage.periodCost.toFixed(2)}`
                : ' · no cost, runs locally'
            }`}
          >
            {formatTokens(localUsage.todayTokens)} today
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <StatusPill state={connectionState} />
        </div>
      </div>

      {/* Mounted only while open, so each appearance starts clean without a
          reset effect. */}
      {groupSheetOpen && (
        <GroupSheet
          open
          bots={bots}
          onClose={() => setGroupSheetOpen(false)}
          onCreated={(groupId) => navigate(`/chat/group/${encodeURIComponent(groupId)}`)}
        />
      )}

      {sheetOpen && (
        <BotSheet open bot={sheetFor} onClose={() => setSheetOpen(false)} onSubmit={submitSheet} />
      )}

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete bot'}
        description="Its workspace, memory and transcripts move to the Trash — they are not erased. Shared files stay where they are."
      >
        <div className="flex justify-end gap-2">
          <GhostButton onClick={() => setDeleteTarget(null)}>Cancel</GhostButton>
          <GhostButton
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="border-error/40 bg-error/10 text-error"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </GhostButton>
        </div>
      </Dialog>
    </aside>
  )
}
