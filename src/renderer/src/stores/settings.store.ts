import { create } from 'zustand'
import { DEFAULT_MODEL } from '@/constants/models'
import { gatewayWS } from '@/services/gateway-ws.service'
import { createPrefStore } from '@/services/storage.service'
import type { ThinkingLevel } from '@/types'

export interface SettingsState {
  haptics: boolean
  defaultModel: string
  defaultThinkingLevel: ThinkingLevel
  verbose: boolean
  usageFooter: 'off' | 'tokens' | 'full'
  notificationsEnabled: boolean
  notifyMessages: boolean
  notifyTasks: boolean
  notifyChannels: boolean
  /** Settings > Dictation: input device id ('' = system default), send on finish, start/stop sounds. */
  dictationDeviceId: string
  dictationAutoSend: boolean
  dictationAudioCues: boolean
  /** Desktop-only preferences. */
  quickChatShortcut: string
  launchAtLogin: boolean
  roomAutoRotate: boolean
}

type SettingsActions = {
  updateSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void
  /** Pushes the agent-facing subset up to the gateway config document. */
  syncToGateway: () => Promise<void>
}

const DEFAULTS: SettingsState = {
  haptics: true,
  defaultModel: DEFAULT_MODEL,
  defaultThinkingLevel: 'high',
  verbose: false,
  usageFooter: 'off',
  notificationsEnabled: true,
  notifyMessages: true,
  notifyTasks: true,
  notifyChannels: false,
  dictationDeviceId: '',
  dictationAutoSend: false,
  dictationAudioCues: true,
  quickChatShortcut: 'Alt+Space',
  launchAtLogin: false,
  roomAutoRotate: true,
}

const store = createPrefStore<Partial<SettingsState>>('settings', {})

export const useSettingsStore = create<SettingsState & SettingsActions>((set, get) => ({
  ...DEFAULTS,
  ...store.load(),

  updateSetting(key, value) {
    set({ [key]: value } as Pick<SettingsState, typeof key>)
    const { updateSetting: _a, syncToGateway: _b, ...persistable } = get()
    store.save({ ...persistable, [key]: value })
  },

  async syncToGateway() {
    const { defaultModel, defaultThinkingLevel, verbose, usageFooter } = get()
    try {
      // Sequential, not parallel: each `config.patch` is read-modify-write on
      // the whole document with a base hash, so concurrent writes would make
      // all but one fail the hash check.
      await gatewayWS.setConfig('agent.model', defaultModel)
      await gatewayWS.setConfig('agent.thinking_level', defaultThinkingLevel)
      await gatewayWS.setConfig('agent.verbose', verbose)
      await gatewayWS.setConfig('ui.usage_footer', usageFooter)
    } catch {
      // Best-effort — the local preference stands even if the gateway is down.
    }
  },
}))
