import { AgentProfile } from '@/components/status/AgentProfile'
import { onComposerPrefill, PENDING_PROMPT_KEY } from '@/lib/composer-prefill'
import { ChatStarter } from '@/components/chat/ChatStarter'
import { StatusPanel } from '@/shell/StatusPanel'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { avatarConfigForAgent } from '@/features/avatar'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  BubbleChatIcon,
  Delete02Icon,
  Edit02Icon,
  File01Icon,
  MoreVerticalIcon,
  ReloadIcon,
} from '@hugeicons/core-free-icons'
import {
  AttachmentChip,
  ChatComposer,
  ChatModelPicker,
  MessageList,
  SlashCommands,
} from '@/components/chat'
import { GhostButton, GradientButton, IconButton } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { EmptyState, TextField, useToast } from '@/components/patterns'
import { Dialog } from '@/components/primitives'
import { Menu, Tooltip } from '@/components/primitives'
import { errorMessage, useSession } from '@/hooks'
import { useChatStore } from '@/stores/chat.store'
import { useGatewayStore } from '@/stores/gateway.store'
import { agentIdFromSessionKey, skillIdFromSessionKey } from '@/services/session-key'
import type { Attachment, AttachmentType, Message } from '@/types'
import { useBotsStore } from '@/stores/bots.store'
import { ChatsButton, ChatsPanel, useChatsPanel } from '@/routes/chat/ChatsButton'
import { PendingQuestions } from '@/components/questions'

const CLAWMUSE_GOALS_KEY = 'clawmuse.goals.v1'

/** Only an assistant-confirmed marker can become a goal; quoted user prompts never do. */
export function confirmedGoalTitle(message: Pick<Message, 'role' | 'content'>): string | null {
  if (message.role !== 'assistant') return null
  return message.content.match(/\[GOAL:\s*([^\]]+)\]/i)?.[1]?.trim() || null
}

function consumeClawMuseDraft(): string {
  const pending = sessionStorage.getItem(PENDING_PROMPT_KEY) ?? ''
  if (pending) sessionStorage.removeItem(PENDING_PROMPT_KEY)
  return pending
}

function attachmentTypeFromMime(mime: string): AttachmentType {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

function attachmentFromFile(file: File): Attachment {
  return {
    id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type: attachmentTypeFromMime(file.type),
    uri: URL.createObjectURL(file),
    name: file.name,
    size: file.size,
    mimeType: file.type,
  }
}

/**
 * One conversation with one bot.
 *
 * The Muse-style rail lives in `AppShell`, so this screen owns the complete
 * conversation surface: compact Chats control, model choice, messages and the
 * floating composer.
 */
/** Routed at /chat/:sessionId, or embedded (Muse's side-by-side chat) with an explicit session. */
export default function ChatThreadScreen({ sessionId: embeddedSessionId }: { sessionId?: string } = {}) {
  const params = useParams<{ sessionId: string }>()
  const sessionId = embeddedSessionId ?? params.sessionId
  const navigate = useNavigate()
  const location = useLocation()
  const { show } = useToast()

  const { messages, streamingText, streamingThinking, isTyping, send, abort } = useSession(
    sessionId ?? null,
  )
  const session = useChatStore((state) => state.sessions.find((s) => s.id === sessionId))
  const setCurrentSession = useChatStore((state) => state.setCurrentSession)
  const patchSession = useChatStore((state) => state.patchSession)
  const resetSession = useChatStore((state) => state.resetSession)
  const deleteSession = useChatStore((state) => state.deleteSession)
  const connectionState = useGatewayStore((state) => state.connectionState)

  const [text, setText] = useState(consumeClawMuseDraft)
  const pendingFiles = embeddedSessionId ? [] : ((location.state as { pendingFiles?: File[] } | null)?.pendingFiles ?? [])
  const [attachments, setAttachments] = useState<Attachment[]>(() => pendingFiles.map(attachmentFromFile))
  const [files, setFiles] = useState<File[]>(() => pendingFiles)
  const attachmentsRef = useRef<Attachment[]>([])
  const [openedAt] = useState(() => Date.now())

  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSavingArtifact, setIsSavingArtifact] = useState(false)
  const chats = useChatsPanel()

  const skillId = sessionId ? skillIdFromSessionKey(sessionId) : null
  const botId = sessionId ? agentIdFromSessionKey(sessionId) : null
  const bots = useBotsStore((state) => state.bots)
  // An unprefixed `webchat:*` key belongs to the default bot — that is what the
  // gateway resolves it to. Without this the thread header and the composer
  // call it by the default name while the roster row next to it shows the name the bot
  // actually goes by.
  const bot = botId
    ? bots.find((entry) => entry.id === botId)
    : skillId
      ? undefined
      : bots.find((entry) => entry.isDefault)
  // Stable per agent: MessageBubble is memoised on it.
  const agentId = bot?.id ?? skillId
  const agentName = bot?.name
  const agentIsDefault = bot?.isDefault ?? false
  const avatar = useMemo(
    () => avatarConfigForAgent(agentId ? { id: agentId, name: agentName, isDefault: agentIsDefault } : null),
    [agentId, agentName, agentIsDefault],
  )
  // Registers this as the "current" session so the ⌘. abort menu command (and
  // any other global chrome) targets the thread actually on screen.
  useEffect(() => {
    setCurrentSession(sessionId ?? null)
    if (!embeddedSessionId && location.state) navigate(location.pathname, { replace: true, state: null })
  }, [embeddedSessionId, location.pathname, location.state, navigate, sessionId, setCurrentSession])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  // Goal refinement happens in chat, like Muse. Once the assistant emits the
  // confirmed marker requested by GoalsScreen, persist it back to Goals. The
  // message id is the stable dedupe key, so reconnects cannot create copies.
  useEffect(() => {
    // Only a goal confirmed in this sitting is captured — reloading an old
    // thread must not resurrect goals the user already removed.
    const latest = [...messages].reverse().find((message) => confirmedGoalTitle(message) && Date.parse(message.created_at) >= openedAt)
    if (!latest) return
    const title = confirmedGoalTitle(latest)
    if (!title) return
    queueMicrotask(() => {
      try {
        const current = JSON.parse(localStorage.getItem(CLAWMUSE_GOALS_KEY) ?? '[]') as Array<{ id: string; title: string; completed: boolean; createdAt: string }>
        const id = `goal-${latest.id}`
        if (current.some((goal) => goal.id === id)) return
        localStorage.setItem(CLAWMUSE_GOALS_KEY, JSON.stringify([{ id, title, completed: false, createdAt: latest.created_at }, ...current]))
        window.dispatchEvent(new Event('clawmuse-goals-changed'))
        show({ title: 'Goal added', description: title, variant: 'success' })
      } catch {
        // A corrupt local value must not interrupt the conversation.
      }
    })
  }, [messages, openedAt, show])

  const quoteReply = useCallback((message: Message) => setText(`> ${message.content.replace(/\n/g, '\n> ')}\n\n`), [])

  // Muse's composer prefill (task Edit, "Change your name to"): replace the
  // draft and put the caret at its end.
  useEffect(() => onComposerPrefill((value) => {
    setText(value)
    requestAnimationFrame(() => {
      const composer = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Message"]')
      composer?.focus()
      composer?.setSelectionRange(value.length, value.length)
    })
  }), [])

  // Leaving the screen must not leak blob: URLs from attachments that were
  // staged but never sent.
  //
  // Note there is no "reset composer when sessionId changes" effect here: the
  // route mounts this component with `key={sessionId}` (see App.tsx), so React
  // gives each thread a fresh instance. That is the sanctioned way to reset
  // state on a prop change, and it also makes this cleanup fire per session
  // rather than only on final unmount.
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.uri))
    }
  }, [])

  if (!sessionId) {
    return (
      <div className="flex h-full min-w-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<Icon icon={BubbleChatIcon} size={44} className="text-content-disabled" />}
          title="Conversation not found"
        />
      </div>
    )
  }

  // Re-bind so every closure below sees the type narrowed above — a `const`
  // captured in a nested function declaration does not retain the outer
  // guard's narrowing, so `sessionId` alone would still read as optional.
  const currentSessionId = sessionId

  function handleAttach(newFiles: File[]) {
    const newAttachments = newFiles.map(attachmentFromFile)
    setAttachments((prev) => [...prev, ...newAttachments])
    setFiles((prev) => [...prev, ...newFiles])
  }

  function handleRemoveAttachment(index: number) {
    setAttachments((prev) => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.uri)
      return prev.filter((_, i) => i !== index)
    })
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSend() {
    const messageText = text.trim()
    if (!messageText && attachments.length === 0) return

    const pendingAttachments = attachments
    const pendingFiles = files
    setText('')
    setAttachments([])
    setFiles([])
    void send(messageText, pendingAttachments.length ? pendingAttachments : undefined, pendingFiles.length ? pendingFiles : undefined)
  }

  function openRename() {
    setRenameValue(session?.name ?? '')
    setIsRenameOpen(true)
  }

  async function handleRenameConfirm() {
    if (!renameValue.trim()) return
    setIsRenaming(true)
    try {
      await patchSession(currentSessionId, { name: renameValue.trim() })
      setIsRenameOpen(false)
    } catch (error) {
      show({ title: 'Could not rename chat', description: errorMessage(error), variant: 'error' })
    } finally {
      setIsRenaming(false)
    }
  }

  async function handleReset() {
    try {
      await resetSession(currentSessionId)
      show({ title: 'Conversation cleared', variant: 'success' })
    } catch (error) {
      show({ title: 'Could not reset chat', description: errorMessage(error), variant: 'error' })
    }
  }

  async function handleDeleteConfirm() {
    setIsDeleting(true)
    try {
      await deleteSession(currentSessionId)
      navigate('/chat')
    } catch (error) {
      show({ title: 'Could not delete chat', description: errorMessage(error), variant: 'error' })
    } finally {
      setIsDeleting(false)
    }
  }

  async function showInLibrary() {
    if (!messages.length || isSavingArtifact) return
    setIsSavingArtifact(true)
    try {
      const roots = await window.clawmuse.fs.roots()
      const root = roots.find((entry) => entry.id === 'workspace') ?? roots[0]
      if (!root) throw new Error('No local Library folder is available')
      const title = (session?.name || 'Conversation').trim()
      const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'conversation'
      const body = messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => `## ${message.role === 'user' ? 'You' : bot?.name ?? 'ClawMuse'}\n\n${message.content.trim()}`)
        .join('\n\n')
      await window.clawmuse.fs.mkdir(root.id, 'artifacts')
      await window.clawmuse.fs.write(root.id, `artifacts/${safeName}-${Date.now()}.md`, `# ${title}\n\n${body}\n`)
      show({ title: 'Saved to Library', variant: 'success' })
      navigate('/library')
    } catch (error) {
      show({ title: 'Could not save to Library', description: errorMessage(error), variant: 'error' })
    } finally {
      setIsSavingArtifact(false)
    }
  }

  const isConnected = connectionState === 'connected'
  const showSlashCommands = text.startsWith('/')

  return (
    <div className="flex h-full">
      {chats.open && <ChatsPanel currentSessionId={currentSessionId} pinned={chats.pinned} onPinnedChange={chats.setPinned} onClose={chats.close} />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Muse's chat nav fade (hatch-chat-nav-fade): the thread scrolls
            away under the nav instead of showing through the agent pill. */}
        <div aria-hidden className="muse-chat-nav-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-28" />
        {/* Muse's chat nav: the agent sits centred above the thread. */}
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">
          <div className="pointer-events-auto"><AgentProfile sessionId={currentSessionId} /></div>
        </div>
        <header className="drag absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-2.5 px-3">
          <ChatsButton currentSessionId={currentSessionId} open={chats.open} onToggle={chats.toggle} />

          <div className="flex-1" />

          <Tooltip content="Show in Library">
            <span data-testid="show-in-library">
              <IconButton
                icon={File01Icon}
                label="Show in Library"
                shape="circle"
                onClick={() => void showInLibrary()}
                disabled={isSavingArtifact}
              />
            </span>
          </Tooltip>

          <ChatModelPicker
            sessionId={currentSessionId}
            sessionModel={session?.model}
            modelOverrideSource={session?.model_override_source}
          />

          {isTyping && (
            <GhostButton size="sm" onClick={abort} className="border-error/40 text-error">
              Stop generating
            </GhostButton>
          )}

          <Tooltip content="Chat actions">
            <Menu
              trigger={
                <IconButton
                  icon={MoreVerticalIcon}
                  label="Chat actions"
                  shape="circle"
                />
              }
            >
              <Menu.Item onClick={openRename}>
                <Icon icon={Edit02Icon} size={15} className="text-current" />
                Rename
              </Menu.Item>
              <Menu.Item onClick={() => void handleReset()}>
                <Icon icon={ReloadIcon} size={15} className="text-current" />
                Reset
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item tone="danger" onClick={() => setIsDeleteOpen(true)}>
                <Icon icon={Delete02Icon} size={15} className="text-current" />
                Delete
              </Menu.Item>
            </Menu>
          </Tooltip>
        </header>


        <>
            {messages.length === 0 && !isTyping && !streamingText ? (
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto pt-18">
                <ChatStarter avatar={avatar} />
              </div>
            ) : (
              <MessageList
                messages={messages}
                streamingText={streamingText}
                streamingThinking={streamingThinking}
                isTyping={isTyping}
                onReply={quoteReply}
                avatar={avatar}
                className="min-h-0 pt-18 [&>*]:mx-auto [&>*]:max-w-3xl"
              />
            )}

            <div className="mx-auto w-full max-w-[800px] shrink-0 px-4 pb-4 pt-2">
              <PendingQuestions sessionKeys={[currentSessionId]} />
              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachments.map((attachment, index) => (
                    <AttachmentChip
                      key={attachment.id}
                      attachment={attachment}
                      onRemove={() => handleRemoveAttachment(index)}
                    />
                  ))}
                </div>
              )}
              <SlashCommands query={text} open={showSlashCommands} onSelect={(cmd) => setText(`${cmd} `)} />
              <ChatComposer
                value={text}
                onChange={setText}
                onSend={handleSend}
                onAttach={handleAttach}
                onStop={isTyping ? abort : undefined}
                isStreaming={isTyping}
                disabled={!isConnected}
                placeholder={
                  isConnected ? 'Message' : 'Reconnecting…'
                }
                autoFocus
              />
            </div>
          </>
      </div>

      {!embeddedSessionId && <StatusPanel sessionId={currentSessionId} />}

      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen} title="Rename chat">
        <div className="flex flex-col gap-4">
          <TextField
            label="Name"
            value={renameValue}
            onChange={setRenameValue}
            placeholder="Conversation name"
            autoFocus
            onSubmit={() => void handleRenameConfirm()}
          />
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setIsRenameOpen(false)}>Cancel</GhostButton>
            <GradientButton onClick={() => void handleRenameConfirm()} disabled={!renameValue.trim()} loading={isRenaming}>
              Save
            </GradientButton>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete chat"
        description={`Delete "${session?.name || 'this conversation'}"? This cannot be undone.`}
      >
        <div className="flex justify-end gap-2">
          <GhostButton onClick={() => setIsDeleteOpen(false)}>Cancel</GhostButton>
          <GhostButton
            onClick={() => void handleDeleteConfirm()}
            disabled={isDeleting}
            className="border-error/40 bg-error/10 text-error"
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </GhostButton>
        </div>
      </Dialog>
    </div>
  )
}
