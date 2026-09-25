import { usePluginApprovalsStore } from '@/stores/plugin-approvals.store'
import { useQuestionsStore } from '@/stores/questions.store'
import { create } from 'zustand'
import { queryKeys } from '@/hooks/queries'
import { queryClient } from '@/lib/query-client'
import { type GatewayFailure, gatewayWS } from '@/services/gateway-ws.service'
import { useChatStore } from '@/stores/chat.store'
import type { ConnectionState } from '@/types'

interface GatewayState {
  connectionState: ConnectionState
  errorMessage: string | null
  /** What the user can do about `errorMessage`, when there is something. */
  errorHint: string | null
  /** 1–5, drives the onboarding progress list. */
  bootStep: number

  /** Ensure the machine's gateway is up, then connect to it. */
  bootLocal: () => Promise<void>
  reconnect: () => Promise<void>
  disconnect: () => void
}

const PAIRING_HINT =
  'ClawMuse is asking this machine’s agent for permission. Retry — if it keeps asking, open Settings → Advanced → Control UI and approve the device.'

/**
 * Turns a socket failure into something worth putting on screen.
 *
 * The gateway's own wording for a refused pairing is `pairing required: device
 * is not approved yet (requestId: …)`, which is accurate and means nothing to
 * the person reading it.
 */
function describeFailure(failure: GatewayFailure): string {
  if (failure.kind === 'pairing-required') return 'This machine’s agent has not approved ClawMuse yet'
  return failure.message
}

/** Human-readable label mirrored into the macOS tray menu. */
const TRAY_LABEL: Record<ConnectionState, string> = {
  idle: 'Idle',
  booting: 'Starting sandbox…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
}

/**
 * One automatic pairing repair per connect attempt.
 *
 * The repair approves a device request and reconnects. If the gateway refuses
 * again for the same reason, repeating it would be an infinite loop between two
 * processes on the same machine, so the second refusal is shown to the user.
 */
let pairingRepairAttempted = false

export const useGatewayStore = create<GatewayState>((set, get) => {
  /**
   * Reports a failed handshake to the main process and, if main could repair
   * it, retries at once.
   *
   * Returns whether the failure was handled, i.e. whether a retry is running
   * and the error must therefore *not* be shown.
   */
  async function tryRepair(failure: GatewayFailure): Promise<boolean> {
    // Always reported, repairable or not: a renderer-side socket failure is
    // invisible in `main.log` otherwise, which is precisely why the original
    // pairing bug had to be diagnosed from OpenClaw's own log file.
    const outcome = await window.clawmuse.runtime.handshakeFailed(failure).catch(() => null)
    if (!outcome?.repaired) {
      if (outcome?.detail) set({ errorHint: outcome.detail })
      return false
    }
    set({ connectionState: 'connecting', errorMessage: null, errorHint: null })
    gatewayWS.reconnectNow()
    return true
  }

  /**
   * (Re)binds socket listeners. Called before every connect attempt, and
   * clears first — otherwise a reconnect would stack duplicate handlers and
   * every gateway event would be processed N times.
   */
  function setupListeners(): void {
    gatewayWS.removeAllListeners()

    gatewayWS.on('connected', () => {
      pairingRepairAttempted = false
      set({ connectionState: 'connected', errorMessage: null, errorHint: null })
      void useChatStore.getState().loadSessions()
      void useChatStore.getState().flushOfflineQueue()
      void import('@/stores/approvals.store').then(({ useApprovalsStore }) => {
        void useApprovalsStore.getState().hydrate()
      })
      // Agent questions asked while the socket was down, and the ones answered
      // or expired meanwhile (question.list is the pending set).
      void useQuestionsStore.getState().load()
    })

    gatewayWS.on('disconnected', (code) => {
      // Never over an error. The close that *follows* a refused handshake used
      // to land here and overwrite `error` with `disconnected`, which the boot
      // screen renders as "still working" — so a gateway that had explicitly
      // rejected the app showed an indefinite spinner and no message at all.
      if (code !== 1000 && get().connectionState !== 'error') set({ connectionState: 'disconnected' })
    })

    gatewayWS.on('error', (failure) => {
      set({
        connectionState: 'error',
        errorMessage: describeFailure(failure),
        errorHint: failure.kind === 'pairing-required' ? PAIRING_HINT : null,
      })

      if (failure.kind !== 'pairing-required' || pairingRepairAttempted) return
      pairingRepairAttempted = true
      void tryRepair(failure)
    })

    // Single funnel for every gateway push.
    gatewayWS.on('event', (frame) => {
      // The agent creates and removes cron jobs on its own during a chat, so the
      // Tasks screen has to follow the gateway rather than a timer. It polls on
      // a 15s interval, but React Query pauses intervals while the window is
      // unfocused — which is most of the time for a desktop agent working in the
      // background, and exactly when the agent is scheduling things.
      if (frame.event === 'cron') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
      }
      useChatStore.getState().handleGatewayEvent(frame)
      usePluginApprovalsStore.getState().handleEvent(frame)
      if (frame.event.startsWith('question.')) useQuestionsStore.getState().handleEvent(frame)
    })
  }

  return {
    sandbox: null,
    connectionState: 'idle',
    errorMessage: null,
    errorHint: null,
    bootStep: 0,

    /**
     * Local path: bring up the machine's own gateway, then connect to it.
     *
     * Deliberately has no cloud fallback. If the local runtime cannot start,
     * the user sees a local error with a retry and a log link — silently
     * reaching for EC2 would make "local-first" a lie and move their data off
     * the machine without asking.
     */
    async bootLocal() {
      // An explicit Retry gets a fresh repair budget: the user may have fixed
      // whatever made the first attempt fail.
      pairingRepairAttempted = false
      set({ connectionState: 'booting', errorMessage: null, errorHint: null, bootStep: 1 })
      try {
        const { useRuntimeStore } = await import('@/stores/runtime.store')
        set({ bootStep: 2 })
        const status = await useRuntimeStore.getState().ensure()
        if (status.state !== 'ready') {
          const message = status.state === 'error' ? status.message : 'Local agent is not ready'
          set({ connectionState: 'error', errorMessage: message, errorHint: null })
          return
        }

        set({ bootStep: 3 })
        const credentials = await window.clawmuse.runtime.credentials()
        if (!credentials) throw new Error('Local runtime credentials are missing')

        set({ bootStep: 4, connectionState: 'connecting' })
        setupListeners()
        gatewayWS.connectLocal(credentials.port, credentials.token)
        set({ bootStep: 5 })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start the local agent'
        set({ connectionState: 'error', errorMessage: message, errorHint: null })
      }
    },


    async reconnect() {
      // One way back, because there is one runtime.
      await get().bootLocal()
    },

    disconnect() {
      gatewayWS.disconnect()
      set({ connectionState: 'idle' })
    },
  }
})

// Mirror connection state into the macOS tray menu. Subscribed after the store
// exists, and de-duplicated so an unrelated state change does not rebuild the
// native menu on every keystroke.
let lastReportedState: ConnectionState | null = null
useGatewayStore.subscribe((state) => {
  if (state.connectionState === lastReportedState) return
  lastReportedState = state.connectionState
  window.clawmuse?.reportConnectionState(TRAY_LABEL[state.connectionState])
})
