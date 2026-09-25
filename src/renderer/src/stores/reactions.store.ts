import { create } from 'zustand'

/** Muse's reaction set (REACTION_EMOJIS). */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

const KEY = 'clawmuse.reactions.v1'

function load(): Record<string, string[]> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

/**
 * Your reactions to the agent's messages. Muse keeps them server-side
 * (reactions.toggle); OpenClaw has no reactions API, so they live on this
 * computer, keyed by OpenClaw's stable message id.
 */
export const useReactionsStore = create<{ byMessage: Record<string, string[]>; toggle: (messageId: string, emoji: string) => void }>((set, get) => ({
  byMessage: load(),
  toggle(messageId, emoji) {
    const current = get().byMessage[messageId] ?? []
    const next = current.includes(emoji) ? current.filter((value) => value !== emoji) : [...current, emoji]
    const byMessage = { ...get().byMessage }
    if (next.length) byMessage[messageId] = next
    else delete byMessage[messageId]
    try { localStorage.setItem(KEY, JSON.stringify(byMessage)) } catch { /* keep this window's state */ }
    set({ byMessage })
  },
}))
