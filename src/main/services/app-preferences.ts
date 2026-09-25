import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import log from 'electron-log/main.js'
import type { AppPreferences, PushToTalkKey } from '@shared/ipc'

/**
 * Settings > General > App behavior toggles that the main process must honour
 * before any renderer exists (the tray and the floating button are created at
 * launch), so they live in userData rather than renderer localStorage.
 */
export const DEFAULT_APP_PREFERENCES: AppPreferences = { showMenuBar: true, showFloatingButton: true, pushToTalk: 'off' }

const PTT_KEYS: readonly PushToTalkKey[] = ['off', 'fn', 'option', 'control']
export function isPushToTalkKey(value: unknown): value is PushToTalkKey {
  return typeof value === 'string' && (PTT_KEYS as readonly string[]).includes(value)
}

const file = () => join(app.getPath('userData'), 'app-preferences.json')

export function parseAppPreferences(value: unknown): AppPreferences {
  const raw = (value ?? {}) as Partial<Record<keyof AppPreferences, unknown>>
  return {
    pushToTalk: isPushToTalkKey(raw.pushToTalk) ? raw.pushToTalk : DEFAULT_APP_PREFERENCES.pushToTalk,
    showMenuBar: typeof raw.showMenuBar === 'boolean' ? raw.showMenuBar : DEFAULT_APP_PREFERENCES.showMenuBar,
    showFloatingButton: typeof raw.showFloatingButton === 'boolean' ? raw.showFloatingButton : DEFAULT_APP_PREFERENCES.showFloatingButton,
  }
}

let current: AppPreferences | null = null

export function getAppPreferences(): AppPreferences {
  if (current) return current
  try {
    current = parseAppPreferences(existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : null)
  } catch {
    current = { ...DEFAULT_APP_PREFERENCES }
  }
  return current
}

export function setAppPreference<K extends keyof AppPreferences>(key: K, value: AppPreferences[K]): AppPreferences {
  current = { ...getAppPreferences(), [key]: value }
  try {
    writeFileSync(file(), JSON.stringify(current, null, 2))
  } catch (err) {
    log.warn('[app-preferences] could not persist:', (err as Error).message)
  }
  return current
}
