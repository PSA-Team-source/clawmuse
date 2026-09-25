import { existsSync } from 'node:fs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, globalShortcut } from 'electron'
import log from 'electron-log/main.js'
import { toggleQuickChat } from '../windows/quick-chat.js'
import { setDoubleOptionShortcut } from './key-monitor.js'

/** Muse's "Tap Option twice": a modifier-only gesture, served by the native key monitor. */
export const DOUBLE_OPTION = 'DoubleOption'

/**
 * The global Quick Chat hotkey.
 *
 * ⌥Space is the convention for launcher panels on macOS (Raycast, Alfred) and,
 * unlike ⌘Space, is not already taken by Spotlight. It is user-overridable
 * because a conflicting app may already own it.
 */
export const DEFAULT_SHORTCUT = 'Alt+Space'

const settingsFile = () => join(app.getPath('userData'), 'shortcuts.json')

let current = DEFAULT_SHORTCUT

function readPersisted(): string {
  try {
    const file = settingsFile()
    if (!existsSync(file)) return DEFAULT_SHORTCUT
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const value = (parsed as { quickChat?: unknown } | null)?.quickChat
    // '' is a deliberate "No shortcut", distinct from never having chosen.
    return typeof value === 'string' ? value : DEFAULT_SHORTCUT
  } catch {
    return DEFAULT_SHORTCUT
  }
}

function persist(accelerator: string): void {
  try {
    writeFileSync(settingsFile(), JSON.stringify({ quickChat: accelerator }, null, 2))
  } catch (err) {
    log.warn('[shortcuts] could not persist:', (err as Error).message)
  }
}

export function getShortcut(): string {
  return current
}

/**
 * Registers the hotkey. Returns false when the OS refuses it — usually because
 * another app already holds the combination. The caller surfaces that to the
 * user rather than leaving a silently dead shortcut.
 */
export function registerShortcut(accelerator: string = readPersisted()): boolean {
  globalShortcut.unregisterAll()
  setDoubleOptionShortcut(accelerator === DOUBLE_OPTION)
  if (accelerator === '' || accelerator === DOUBLE_OPTION) {
    current = accelerator
    return true
  }

  let ok: boolean
  try {
    ok = globalShortcut.register(accelerator, () => toggleQuickChat())
  } catch (err) {
    log.warn('[shortcuts] invalid accelerator', accelerator, (err as Error).message)
    ok = false
  }

  if (ok) {
    current = accelerator
    return true
  }

  log.warn(`[shortcuts] "${accelerator}" unavailable`)
  // Never leave the user with no hotkey at all: fall back to the default,
  // unless the default is what just failed.
  if (accelerator !== DEFAULT_SHORTCUT && globalShortcut.register(DEFAULT_SHORTCUT, toggleQuickChat)) {
    current = DEFAULT_SHORTCUT
  }
  return false
}

export function setShortcut(accelerator: string): boolean {
  const ok = registerShortcut(accelerator)
  if (ok) persist(accelerator)
  return ok
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
