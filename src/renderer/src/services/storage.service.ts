import type { Message, QueuedMessage, Session } from '@/types'

/**
 * Non-secret cache, the desktop stand-in for mobile's MMKV `localfang-cache`.
 *
 * localStorage is synchronous and plain text — fine for what goes here
 * (sessions, recent messages, UI prefs) and forbidden for anything the mobile
 * app keeps in SecureStore. Tokens and the sandbox record go through
 * `secure-storage.service.ts` instead.
 */

const PREFIX = 'clawmuse:'
const MAX_CACHED_MESSAGES = 100

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Quota exceeded — the cache is an optimisation, never a correctness
    // requirement, so a failed write is silently acceptable.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* ignore */
  }
}

export const cache = {
  getSessions: (): Session[] | null => read<Session[]>('sessions'),
  setSessions: (sessions: Session[]): void => write('sessions', sessions),

  getMessages: (sessionId: string): Message[] | null => read<Message[]>(`messages:${sessionId}`),
  /** Mirrors mobile: only the last 100 messages per session are kept. */
  setMessages: (sessionId: string, messages: Message[]): void =>
    write(`messages:${sessionId}`, messages.slice(-MAX_CACHED_MESSAGES)),
  deleteMessages: (sessionId: string): void => remove(`messages:${sessionId}`),

  /**
   * Offline send queue. Mobile declares this API but never calls it, so a
   * force-quit loses queued messages; persisting it here is a genuine desktop
   * improvement — closing the app must not silently drop what you typed.
   */
  getQueue: (): QueuedMessage[] => read<QueuedMessage[]>('message_queue') ?? [],
  setQueue: (queue: QueuedMessage[]): void => write('message_queue', queue),
  clearQueue: (): void => remove('message_queue'),

  /**
   * Drops everything belonging to the runtime we were just talking to —
   * sessions, their messages, and anything still queued to send.
   *
   * Used when switching between Offline and Online. Those two have entirely
   * separate session stores, so carrying the cache across would show the
   * previous runtime's conversations under the new one and, worse, flush
   * queued messages to a gateway that never saw the thread they belong to.
   *
   * Unlike `clearAll` this leaves preferences alone: the user's choice of
   * mode, room and model is about the app, not about either runtime.
   */
  clearRuntimeData: (): void => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (
          key === `${PREFIX}sessions` ||
          key === `${PREFIX}message_queue` ||
          key.startsWith(`${PREFIX}messages:`)
        ) {
          localStorage.removeItem(key)
        }
      }
    } catch {
      /* ignore */
    }
  },

  clearAll: (): void => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(PREFIX)) localStorage.removeItem(key)
      }
    } catch {
      /* ignore */
    }
  },
}

/** Small typed helper for the standalone preference stores (mode, rooms). */
export function createPrefStore<T>(key: string, fallback: T) {
  return {
    load: (): T => read<T>(key) ?? fallback,
    save: (value: T): void => write(key, value),
  }
}
