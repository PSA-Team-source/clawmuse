import { create } from 'zustand'
import type { BotDraft, BotSummary } from '@shared/ipc'

/**
 * The roster.
 *
 * Bots themselves live in the gateway's config and are owned by main — this
 * store mirrors them and adds the part that is nobody's business but this Mac's:
 * which rows are pinned, which are hidden, and which the user has marked back to
 * unread. Those are view state, not agent state, so they stay in `localStorage`
 * rather than being written into a config the gateway reads.
 */

const PREFS_KEY = 'clawmuse.roster.prefs'

interface RosterPrefs {
  pinned: string[]
  hidden: string[]
  /** Manually marked unread — cleared when the thread is opened. */
  unread: string[]
}

const EMPTY_PREFS: RosterPrefs = { pinned: [], hidden: [], unread: [] }

function readPrefs(): RosterPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return EMPTY_PREFS
    const parsed = JSON.parse(raw) as Partial<RosterPrefs>
    return {
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      unread: Array.isArray(parsed.unread) ? parsed.unread : [],
    }
  } catch {
    // A corrupt preference must never cost the user their roster.
    return EMPTY_PREFS
  }
}

function writePrefs(prefs: RosterPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Private browsing / quota. Losing a pin is survivable; throwing is not.
  }
}

interface BotsState extends RosterPrefs {
  bots: BotSummary[]
  /** `null` until the first load resolves — distinct from "no bots". */
  loaded: boolean

  load: () => Promise<void>
  create: (draft: BotDraft) => Promise<{ ok: true; bot: BotSummary } | { ok: false; error: string }>
  update: (id: string, draft: BotDraft) => Promise<{ ok: boolean; error?: string }>
  duplicate: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>

  togglePinned: (id: string) => void
  toggleHidden: (id: string) => void
  markUnread: (id: string) => void
  clearUnread: (id: string) => void
}

/** Toggles membership without mutating the array in place. */
function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]
}

export const useBotsStore = create<BotsState>((set, get) => ({
  bots: [],
  loaded: false,
  ...readPrefs(),

  async load() {
    const bots = await window.clawmuse.runtime.botsList()
    set({ bots, loaded: true })
  },

  async create(draft) {
    const result = await window.clawmuse.runtime.botsCreate(draft)
    if (!result.ok) return result
    // Reload rather than appending the returned row: the CLI is the authority
    // on the id it settled on, and a duplicate name may have suffixed it.
    await get().load()
    return { ok: true, bot: result.bot as BotSummary }
  },

  async update(id, draft) {
    const result = await window.clawmuse.runtime.botsUpdate(id, draft)
    if (!result.ok) return result
    await get().load()
    return { ok: true }
  },

  async duplicate(id, name) {
    const result = await window.clawmuse.runtime.botsDuplicate(id, name)
    if (!result.ok) return result
    await get().load()
    return { ok: true }
  },

  async remove(id) {
    const result = await window.clawmuse.runtime.botsDelete(id)
    if (!result.ok) return result
    // Drop the row's view state with it, or a bot recreated under the same name
    // comes back pinned and hidden by a ghost.
    const { pinned, hidden, unread } = get()
    const next = {
      pinned: pinned.filter((entry) => entry !== id),
      hidden: hidden.filter((entry) => entry !== id),
      unread: unread.filter((entry) => entry !== id),
    }
    writePrefs(next)
    set(next)
    await get().load()
    return { ok: true }
  },

  togglePinned(id) {
    const { pinned, hidden, unread } = get()
    const next = { pinned: toggle(pinned, id), hidden, unread }
    writePrefs(next)
    set({ pinned: next.pinned })
  },

  toggleHidden(id) {
    const { pinned, hidden, unread } = get()
    const next = { pinned, hidden: toggle(hidden, id), unread }
    writePrefs(next)
    set({ hidden: next.hidden })
  },

  markUnread(id) {
    const { pinned, hidden, unread } = get()
    if (unread.includes(id)) return
    const next = { pinned, hidden, unread: [...unread, id] }
    writePrefs(next)
    set({ unread: next.unread })
  },

  clearUnread(id) {
    const { pinned, hidden, unread } = get()
    if (!unread.includes(id)) return
    const next = { pinned, hidden, unread: unread.filter((entry) => entry !== id) }
    writePrefs(next)
    set({ unread: next.unread })
  },
}))

export interface RosterRow {
  bot: BotSummary
  /** The bot's default conversation — what the row opens. */
  sessionId: string
  lastMessage?: string
  lastMessageAt?: string
  unread: boolean
  pinned: boolean
}

/**
 * Orders the roster the way a messages app does: pinned first, then whoever
 * spoke last, then — for bots that have never been used — the order they were
 * created in, so a fresh install is not shuffled arbitrarily on every launch.
 */
export function sortRoster(rows: RosterRow[]): RosterRow[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0
    const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0
    if (at !== bt) return bt - at
    return 0
  })
}
