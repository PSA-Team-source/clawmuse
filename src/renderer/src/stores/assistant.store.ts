import { useEffect } from 'react'
import { create } from 'zustand'
import { isUserChat, type AssistantState } from '@shared/assistant'
import { readGoals } from '@/lib/goals'
import { useChatStore } from '@/stores/chat.store'
import { useSettingsStore } from '@/stores/settings.store'
import type { Message } from '@/types'

/**
 * Mirror of the main process's built-in assistant (Feed, Ideas, check-ins).
 * Main owns the truth and runs the jobs; this store only reflects it, so a run
 * keeps going — and its progress stays visible — across pages and windows.
 */
interface AssistantStore {
  state: AssistantState | null
  set: (state: AssistantState) => void
}

export const useAssistantStore = create<AssistantStore>((set) => ({
  state: null,
  set: (state) => set({ state }),
}))

/** Feed/Ideas runs used to be chats; their prompts must never read as the user's own asks. */
const APP_PROMPT = /^(\[ClawMuse feed\]|Suggest 6 to 9 concrete things)/

/** The user's own recent requests (never background automation runs), newest first. */
export function recentUserAsks(sessions: readonly { id: string }[], messages: Record<string, Message[] | undefined>): string[] {
  return sessions
    .filter((session) => isUserChat(session.id))
    .flatMap((session) => {
      const ask = [...(messages[session.id] ?? [])].reverse().find((message) => message.role === 'user' && message.content.trim() && !APP_PROMPT.test(message.content.trim()))
      return ask ? [ask.content.trim()] : []
    })
    .slice(0, 8)
}

function lastUserMessageAt(messages: Record<string, Message[] | undefined>): number | null {
  let latest = 0
  for (const [sessionId, thread] of Object.entries(messages)) {
    if (!isUserChat(sessionId)) continue
    for (const message of thread ?? []) {
      if (message.role !== 'user' || APP_PROMPT.test(message.content.trim())) continue
      const at = Date.parse(message.created_at)
      if (at > latest) latest = at
    }
  }
  return latest || null
}

const LEGACY_KEYS = {
  feed: 'clawmuse.feedEditions.v1',
  hiddenFeed: 'clawmuse.feedHidden.v1',
  likedFeed: 'clawmuse.feedLikes.v1',
  ideas: 'clawmuse.ideas.v2',
  hiddenIdeas: 'clawmuse.hiddenIdeas.v1',
  feedPrompt: 'clawmuse.feedPrompt.v1',
} as const
const LEGACY_RUN_KEYS = ['clawmuse.feed.generating', 'clawmuse.feed.phase', 'clawmuse.ideas.generating']

/** Hands what localStorage held before main owned it over once, then forgets it. */
async function importLegacy(): Promise<void> {
  const legacy: Record<string, unknown> = {}
  let found = false
  for (const [field, key] of Object.entries(LEGACY_KEYS)) {
    const raw = localStorage.getItem(key)
    if (raw === null) continue
    found = true
    try { legacy[field] = field === 'feedPrompt' ? raw : JSON.parse(raw) } catch { /* unreadable: nothing to carry over */ }
  }
  if (!found) return
  useAssistantStore.getState().set(await window.clawmuse.assistant.importLegacy(legacy))
  for (const key of [...Object.values(LEGACY_KEYS), ...LEGACY_RUN_KEYS]) localStorage.removeItem(key)
}

/**
 * Mounted once in the shell: subscribes to main's state and keeps main's copy
 * of the context it runs on (goals, recent asks, when the user last wrote)
 * current, debounced so typing and streaming never flood IPC.
 */
export function useAssistantSync(): void {
  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.clawmuse.assistant.onState((state) => useAssistantStore.getState().set(state))
    void window.clawmuse.assistant.state().then((state) => {
      if (!cancelled) useAssistantStore.getState().set(state)
    })
    void importLegacy().catch(() => undefined)

    let timer: ReturnType<typeof setTimeout> | null = null
    let last = ''
    const push = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const { sessions, messages } = useChatStore.getState()
        const context = {
          goals: readGoals(),
          recentAsks: recentUserAsks(sessions, messages),
          lastUserMessageAt: lastUserMessageAt(messages),
          notificationsEnabled: useSettingsStore.getState().notificationsEnabled,
        }
        const serialized = JSON.stringify(context)
        if (serialized === last) return
        last = serialized
        window.clawmuse.assistant.syncContext(context)
      }, 2000)
    }
    push()
    const stopChat = useChatStore.subscribe((state, previous) => {
      if (state.messages !== previous.messages || state.sessions !== previous.sessions) push()
    })
    const stopSettings = useSettingsStore.subscribe(push)
    window.addEventListener('clawmuse-goals-changed', push)
    window.addEventListener('storage', push)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsubscribe()
      stopChat()
      stopSettings()
      window.removeEventListener('clawmuse-goals-changed', push)
      window.removeEventListener('storage', push)
    }
  }, [])
}
