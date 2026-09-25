import { create } from 'zustand'
import type { LocalRuntimeStatus, OpenclawResolution } from '@shared/ipc'

/**
 * Mirror of the main process's runtime state machine.
 *
 * Main owns the truth — this store only reflects it and forwards user intent,
 * so a second window never gets a divergent view of whether the agent is up.
 *
 * There is no mode here. The agent runs on this machine; that is the product,
 * not a setting, and a store that could represent "somewhere else" would be the
 * first step towards building it.
 */

interface RuntimeState {
  status: LocalRuntimeStatus
  resolution: OpenclawResolution | null
  /**
   * The user chose to continue without picking a model.
   *
   * Without this the setup gate bounces them straight back and "Skip for now"
   * is a dead button. They will hit a model error on the first message, which
   * is the trade they explicitly made — but they can reach the rest of the app.
   * Deliberately not persisted: a relaunch with still no model should offer
   * setup again rather than silently drop them into a broken chat.
   */
  providerSkipped: boolean

  init: () => () => void
  skipProviderSetup: () => void
  ensure: () => Promise<LocalRuntimeStatus>
  restart: () => Promise<void>
  stop: () => Promise<void>
  openLogs: () => Promise<void>
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  status: { state: 'idle' },
  resolution: null,
  providerSkipped: false,

  skipProviderSetup() {
    set({ providerSkipped: true })
  },

  /** Subscribes to main's progress broadcasts. Returns the unsubscribe. */
  init() {
    const unsubscribe = window.clawmuse.runtime.onStatus((status) => {
      set({ status })
      if (status.state === 'ready' && !get().resolution) {
        void window.clawmuse.runtime.resolution().then((resolution) => set({ resolution }))
      }
    })
    void window.clawmuse.runtime.status().then((status) => set({ status }))
    return unsubscribe
  },

  async ensure() {
    const status = await window.clawmuse.runtime.ensure()
    set({ status })
    if (status.state === 'ready') {
      set({ resolution: await window.clawmuse.runtime.resolution() })
    }
    return status
  },

  async restart() {
    set({ status: await window.clawmuse.runtime.restart() })
  },

  async stop() {
    await window.clawmuse.runtime.stop()
    set({ status: { state: 'idle' } })
  },

  async openLogs() {
    await window.clawmuse.runtime.openLogs()
  },
}))

/** True once the local agent is reachable — the gate for entering the app. */
export function isRuntimeReady(status: LocalRuntimeStatus): boolean {
  return status.state === 'ready'
}
