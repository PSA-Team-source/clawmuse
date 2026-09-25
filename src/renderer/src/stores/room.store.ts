import { create } from 'zustand'
import { createPrefStore } from '@/services/storage.service'
import type { GameCharacter, RoomCharacterConfig, RoomData } from '@/types'

/** ClawMuse itself is always present and cannot be removed from a room. */
/**
 * The id of the built-in assistant in rooms and tasks. Its value predates the
 * ClawMuse name and is stored in saved rooms and gateway tasks, so it stays
 * `localfang` — changing it would orphan every existing room seat and task.
 */
export const CLAWMUSE_SKILL_ID = 'localfang'

const CLAWMUSE_CONFIG: RoomCharacterConfig = {
  skillId: CLAWMUSE_SKILL_ID,
  skillName: 'ClawMuse',
  description: 'Your main agent',
  appearanceSeed: 99,
  emoji: '🦞',
}

const DEFAULT_ROOMS: RoomData[] = [
  { id: 'main', name: 'Main Office', characterConfigs: [CLAWMUSE_CONFIG] },
]

/** Round-robin appearance assignment, matching the 3D engine's palettes. */
const BODY_STYLES = ['mage', 'striker', 'sentinel', 'healer'] as const
const ACCENT_COLORS = [
  '#00f0ff',
  '#ff2d78',
  '#a855f7',
  '#34d399',
  '#ffaa44',
  '#ff9500',
  '#00c2ff',
  '#e040fb',
] as const

const roomsStore = createPrefStore<RoomData[]>('rooms', DEFAULT_ROOMS)

/** Guarantees ClawMuse is the first character in every room. */
function ensureClawMuse(rooms: RoomData[]): RoomData[] {
  return rooms.map((room) =>
    room.characterConfigs.some((config) => config.skillId === CLAWMUSE_SKILL_ID)
      ? room
      : { ...room, characterConfigs: [CLAWMUSE_CONFIG, ...room.characterConfigs] },
  )
}

function loadRooms(): RoomData[] {
  const loaded = roomsStore.load()
  if (!Array.isArray(loaded) || loaded.length === 0) return structuredClone(DEFAULT_ROOMS)
  return ensureClawMuse(loaded)
}

export function roomToCharacters(room: RoomData, taskCounts: Record<string, number>): GameCharacter[] {
  return room.characterConfigs.map((config, index) => ({
    id: index,
    skillId: config.skillId,
    name: config.skillName,
    description: config.description,
    color: ACCENT_COLORS[index % ACCENT_COLORS.length]!,
    bodyStyle: BODY_STYLES[index % BODY_STYLES.length]!,
    appearanceSeed: config.appearanceSeed,
    emoji: config.emoji,
    taskCount: taskCounts[config.skillId] ?? 0,
  }))
}

interface RoomState {
  rooms: RoomData[]
  activeRoomId: string
  selectedSkillId: string | null
  taskCounts: Record<string, number>

  setActiveRoom: (roomId: string) => void
  addRoom: (name: string) => void
  deleteRoom: (roomId: string) => void
  addCharacterToRoom: (config: RoomCharacterConfig) => void
  removeCharacterFromRoom: (skillId: string) => void
  selectSkill: (skillId: string | null) => void
  setTaskCounts: (counts: Record<string, number>) => void
  characters: () => GameCharacter[]
}

export const useRoomStore = create<RoomState>((set, get) => {
  const rooms = loadRooms()

  function persist(next: RoomData[]): void {
    roomsStore.save(next)
    set({ rooms: next })
  }

  return {
    rooms,
    activeRoomId: rooms[0]?.id ?? 'main',
    selectedSkillId: null,
    taskCounts: {},

    setActiveRoom(roomId) {
      set({ activeRoomId: roomId, selectedSkillId: null })
    },

    addRoom(name) {
      const room: RoomData = {
        id: `room_${Date.now().toString(36)}`,
        name,
        characterConfigs: [CLAWMUSE_CONFIG],
      }
      persist([...get().rooms, room])
      set({ activeRoomId: room.id })
    },

    deleteRoom(roomId) {
      const next = get().rooms.filter((room) => room.id !== roomId)
      // Never leave the user with zero rooms.
      const resolved = next.length > 0 ? next : structuredClone(DEFAULT_ROOMS)
      persist(resolved)
      if (get().activeRoomId === roomId) set({ activeRoomId: resolved[0]!.id })
    },

    addCharacterToRoom(config) {
      const { rooms: current, activeRoomId } = get()
      persist(
        current.map((room) =>
          room.id === activeRoomId && !room.characterConfigs.some((c) => c.skillId === config.skillId)
            ? { ...room, characterConfigs: [...room.characterConfigs, config] }
            : room,
        ),
      )
    },

    removeCharacterFromRoom(skillId) {
      if (skillId === CLAWMUSE_SKILL_ID) return
      const { rooms: current, activeRoomId } = get()
      persist(
        current.map((room) =>
          room.id === activeRoomId
            ? { ...room, characterConfigs: room.characterConfigs.filter((c) => c.skillId !== skillId) }
            : room,
        ),
      )
    },

    selectSkill(skillId) {
      set({ selectedSkillId: skillId })
    },

    setTaskCounts(counts) {
      set({ taskCounts: counts })
    },

    characters() {
      const { rooms: current, activeRoomId, taskCounts } = get()
      const room = current.find((r) => r.id === activeRoomId) ?? current[0]
      return room ? roomToCharacters(room, taskCounts) : []
    },
  }
})
