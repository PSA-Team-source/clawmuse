import { create } from 'zustand'

/**
 * Group chats — two to six bots in one thread.
 *
 * A group is a **client-side** construct, and deliberately so. The gateway has
 * no notion of "a conversation several agents share"; what it has is a session
 * key per agent, and `sessions_send` for one agent to reach another. A group is
 * therefore a name, a member list, and the agreement that every member's
 * `webchat:group:<id>` session belongs to the same conversation — which is
 * exactly enough for the roster to show one row and the thread to interleave
 * the replies.
 *
 * The cap is Grok Bot's: two to six. It is not arbitrary. Every member gets the
 * user's turn, so a six-bot group is six model calls per message, and the
 * transcript stops being readable long before the cost does.
 */

export const MIN_GROUP_BOTS = 2
export const MAX_GROUP_BOTS = 6

export interface BotGroup {
  id: string
  name: string
  /** Bot ids, in the order they were added. */
  members: string[]
  createdAt: string
}

const STORAGE_KEY = 'clawmuse.groups'

function read(): BotGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is BotGroup =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as BotGroup).id === 'string' &&
        Array.isArray((entry as BotGroup).members),
    )
  } catch {
    return []
  }
}

function write(groups: BotGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups))
  } catch {
    // Quota or private mode. A lost group is recoverable; a thrown write is not.
  }
}

interface GroupsState {
  groups: BotGroup[]
  create: (name: string, members: string[]) => BotGroup
  rename: (id: string, name: string) => void
  setMembers: (id: string, members: string[]) => void
  remove: (id: string) => void
  /** Adds a bot mid-conversation, the way an `@`-mention does. */
  addMember: (id: string, botId: string) => void
}

function persist(groups: BotGroup[]): { groups: BotGroup[] } {
  write(groups)
  return { groups }
}

export const useGroupsStore = create<GroupsState>((set, get) => ({
  groups: read(),

  create(name, members) {
    const group: BotGroup = {
      // Time-based and short: it ends up inside a session key, which is a
      // path-ish string the gateway parses on `:` — so no colons, ever.
      id: `g${Date.now().toString(36)}`,
      name,
      members: members.slice(0, MAX_GROUP_BOTS),
      createdAt: new Date().toISOString(),
    }
    set(persist([group, ...get().groups]))
    return group
  },

  rename(id, name) {
    set(persist(get().groups.map((group) => (group.id === id ? { ...group, name } : group))))
  },

  setMembers(id, members) {
    set(
      persist(
        get().groups.map((group) =>
          group.id === id ? { ...group, members: members.slice(0, MAX_GROUP_BOTS) } : group,
        ),
      ),
    )
  },

  addMember(id, botId) {
    const group = get().groups.find((entry) => entry.id === id)
    if (!group || group.members.includes(botId) || group.members.length >= MAX_GROUP_BOTS) return
    get().setMembers(id, [...group.members, botId])
  },

  remove(id) {
    set(persist(get().groups.filter((group) => group.id !== id)))
  },
}))

/** A default name for a group, from who is in it. */
export function groupNameFor(names: string[]): string {
  if (names.length === 0) return 'Group'
  if (names.length <= 2) return names.join(' & ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}
