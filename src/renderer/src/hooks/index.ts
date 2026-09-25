import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { DroppedFile, MenuCommand } from '@shared/ipc'
import { gatewayWS } from '@/services/gateway-ws.service'
import { isSkillSessionKey, skillBaseKey } from '@/services/session-key'
import { useApprovalsStore } from '@/stores/approvals.store'
import { useQuestionsStore } from '@/stores/questions.store'
import { useChatStore } from '@/stores/chat.store'
import { useGatewayStore } from '@/stores/gateway.store'
import { useSkillsStore } from '@/stores/skills.store'
import { CLAWMUSE_SKILL_ID } from '@/stores/room.store'
import type { Attachment, Message, Session } from '@/types'
import { queryKeys, useTasks } from '@/hooks/queries'

export * from '@/hooks/queries'

/** Shared empty snapshot — see the note in `useSession`. */
const EMPTY_MESSAGES: Message[] = []

/**
 * Everything a chat surface needs for one session. Keeps the selector list in
 * one place so the composer, the message list and the quick panel all agree.
 */
export function useSession(sessionId: string | null) {
  // `?? EMPTY_MESSAGES`, not `?? []`. A fresh literal is a new reference on
  // every read, and `useSyncExternalStore` compares snapshots by identity — so
  // a session with no messages yet re-renders forever and React throws
  // "Maximum update depth exceeded", taking the whole tree down. Only shows up
  // on a thread that has never loaded, which is exactly what "New chat" makes.
  const messages = useChatStore((state) => (sessionId ? (state.messages[sessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES))
  const streamingText = useChatStore((state) => (sessionId ? (state.streamingText[sessionId] ?? '') : ''))
  const streamingThinking = useChatStore((state) =>
    sessionId ? (state.streamingThinking[sessionId] ?? '') : '',
  )
  const isTyping = useChatStore((state) => (sessionId ? (state.isTyping[sessionId] ?? false) : false))
  const loadMessages = useChatStore((state) => state.loadMessages)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const abortSession = useChatStore((state) => state.abortSession)
  const patchSession = useChatStore((state) => state.patchSession)

  useEffect(() => {
    if (sessionId) void loadMessages(sessionId)
  }, [sessionId, loadMessages])

  const send = useCallback(
    (text: string, attachments?: Attachment[], files?: File[]) => {
      if (!sessionId) return Promise.resolve()
      return sendMessage(sessionId, text, attachments, files)
    },
    [sessionId, sendMessage],
  )

  const abort = useCallback(() => {
    if (sessionId) void abortSession(sessionId)
  }, [sessionId, abortSession])

  return { messages, streamingText, streamingThinking, isTyping, send, abort, patchSession }
}

/** The thread list for one agent, always including a "Main" entry. */
export function useSkillThreads(skillId: string | null): Session[] {
  const sessions = useChatStore((state) => state.sessions)
  const currentSessionId = useChatStore((state) => state.currentSessionId)

  return useMemo(() => {
    if (!skillId) return []
    const base = skillBaseKey(skillId)
    const matching = sessions.filter((session) => isSkillSessionKey(session.id, skillId))

    const withBase = matching.some((session) => session.id === base)
      ? matching
      : [{ id: base, name: 'Main' } satisfies Session, ...matching]

    // A conversation created a moment ago has no server-side record yet, so
    // splice it in or the user watches their new thread vanish.
    if (currentSessionId && isSkillSessionKey(currentSessionId, skillId) && !withBase.some((s) => s.id === currentSessionId)) {
      return [...withBase, { id: currentSessionId, name: 'New conversation' }]
    }
    return withBase
  }, [sessions, skillId, currentSessionId])
}

/**
 * Keeps the single gateway socket alive.
 *
 * Desktop apps sit idle for hours and the machine sleeps, which silently kills
 * the socket without an `onclose` in some cases. Reconnect on window focus and
 * on the browser regaining connectivity, but never touch a healthy socket.
 */
export function useGatewayLifecycle(): void {
  const connectionState = useGatewayStore((state) => state.connectionState)
  const reconnect = useGatewayStore((state) => state.reconnect)

  useEffect(() => {
    function maybeReconnect(): void {
      if (!gatewayWS.isConnected && connectionState !== 'connecting' && connectionState !== 'booting') {
        void reconnect()
      }
    }

    window.addEventListener('focus', maybeReconnect)
    window.addEventListener('online', maybeReconnect)
    return () => {
      window.removeEventListener('focus', maybeReconnect)
      window.removeEventListener('online', maybeReconnect)
    }
  }, [connectionState, reconnect])
}

/** Routes `clawmuse://…` deep links (OAuth callbacks, notification clicks). */
export function useDeepLinks(): void {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsubscribe = window.clawmuse.onDeepLink((raw) => {
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        return
      }

      // clawmuse://oauth/facebook → the OAuth dance finished in the browser;
      // the token lives server-side, so just re-read status.
      const path = `${url.hostname}${url.pathname}`.replace(/\/$/, '')
      if (path.startsWith('oauth/facebook')) {
        void queryClient.invalidateQueries({ queryKey: ['facebook'] })
        navigate('/facebook-ads')
        return
      }

      // clawmuse://chat?skill=create-store[&conv=a1] → open that agent.
      // Session keys carry colons, so they cannot be a path segment in a URL
      // the OS hands us; the agent is named in the query instead and the key
      // is rebuilt here.
      if (path === 'chat') {
        const skill = url.searchParams.get('skill')
        if (skill) {
          const conv = url.searchParams.get('conv')
          // Registers the agent thread even when a specific conversation was
          // requested, so the sidebar has something to show immediately.
          const base = useChatStore.getState().createSession({ skillId: skill })
          navigate(`/chat/${encodeURIComponent(conv ? `${base}:conv:${conv}` : base)}`)
          return
        }
      }

      navigate(`/${path}${url.search}`)
    })
    return unsubscribe
  }, [navigate, queryClient])
}

/** Files dropped on the floating button open a new chat with them attached. */
export function useFloatingButtonDrops(): void {
  const navigate = useNavigate()
  useEffect(() => {
    const open = (dropped: DroppedFile[]) => {
      const files = dropped.map((file) => new File([new Uint8Array(file.data)], file.name, { type: file.type }))
      if (files.length === 0) return
      const id = useChatStore.getState().createSession()
      navigate(`/chat/${encodeURIComponent(id)}`, { state: { pendingFiles: files } })
    }
    void window.clawmuse.takeDroppedFiles().then(open)
    return window.clawmuse.onAttachFiles(open)
  }, [navigate])
}

/** Wires the native macOS menu bar and its accelerators to app actions. */
export function useMenuCommands(handlers: Partial<Record<MenuCommand, () => void>>): void {
  // Kept in a ref so the IPC subscription is created once, yet always calls the
  // latest closures. Written in an effect, not during render — mutating a ref
  // while rendering is unsafe under concurrent rendering, where a render can be
  // thrown away before it ever commits.
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    return window.clawmuse.onMenuCommand((command) => {
      handlersRef.current[command]?.()
    })
  }, [])
}


/** Skills list, refreshed whenever the gateway comes up. */
export function useSkills() {
  const skills = useSkillsStore((state) => state.skills)
  const isLoading = useSkillsStore((state) => state.isLoading)
  const loadSkills = useSkillsStore((state) => state.loadSkills)
  const toggleSkill = useSkillsStore((state) => state.toggleSkill)
  const connectionState = useGatewayStore((state) => state.connectionState)

  useEffect(() => {
    if (connectionState === 'connected') void loadSkills()
  }, [connectionState, loadSkills])

  return { skills, isLoading, reload: loadSkills, toggleSkill }
}

/**
 * Feeds the 3D room live task counts, and surfaces a dock badge for work that
 * needs the user: pending approvals plus tasks that failed on their last run.
 */
export function useRoomRealtime(setTaskCounts: (counts: Record<string, number>) => void): void {
  const { data: tasks } = useTasks()
  const pendingApprovals = useApprovalsStore((state) => state.queue.length)
  // A blocked ask_user waits on the user exactly like an approval does.
  const pendingQuestions = useQuestionsStore((state) => state.pending.length)

  useEffect(() => {
    if (!tasks) return
    const counts: Record<string, number> = {}
    for (const task of tasks) {
      if (!task.enabled) continue
      const key = task.skill_id ?? CLAWMUSE_SKILL_ID
      counts[key] = (counts[key] ?? 0) + 1
    }
    setTaskCounts(counts)
  }, [tasks, setTaskCounts])

  useEffect(() => {
    void window.clawmuse.app.setBadge(pendingApprovals + pendingQuestions)
  }, [pendingApprovals, pendingQuestions])
}

/** `queryKeys` re-exported for screens that need to invalidate manually. */
export { queryKeys }

/** Small helper: debounced value, used by search fields. */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
