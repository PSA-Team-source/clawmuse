import { create } from 'zustand'

/** Muse's status panel tabs, in its order (Mail is Meta-only). */
export type StatusTab = 'activity' | 'approvals' | 'upcoming' | 'identity'

interface StatusPanelState {
  open: boolean
  tab: StatusTab
  toggle: () => void
  close: () => void
  setTab: (tab: StatusTab) => void
  /** Opens the panel on a tab — what the "Needs approval" chip does. */
  show: (tab: StatusTab) => void
}

export const useStatusPanel = create<StatusPanelState>((set) => ({
  open: false,
  tab: 'activity',
  toggle: () => set((state) => ({ open: !state.open })),
  close: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
  show: (tab) => set({ open: true, tab }),
}))
