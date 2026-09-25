import { create } from 'zustand'
import { createPrefStore } from '@/services/storage.service'

export type RoomMode = '3d' | 'basic'

const store = createPrefStore<RoomMode>('mode', '3d')

interface ModeState {
  mode: RoomMode
  setMode: (mode: RoomMode) => void
  toggleMode: () => void
}

export const useModeStore = create<ModeState>((set, get) => ({
  // Anything other than an exact 'basic' falls back to 3D, mirroring the web
  // client's `lib/mode-storage.ts`.
  mode: store.load() === 'basic' ? 'basic' : '3d',

  setMode(mode) {
    store.save(mode)
    set({ mode })
  },

  toggleMode() {
    const next: RoomMode = get().mode === '3d' ? 'basic' : '3d'
    store.save(next)
    set({ mode: next })
  },
}))
