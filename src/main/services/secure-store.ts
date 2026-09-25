import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import log from 'electron-log/main.js'
import { SECURE_KEYS, type SecureKey } from '@shared/ipc'

/**
 * Credential store backed by the macOS Keychain via Electron's `safeStorage`.
 *
 * `safeStorage` derives a key from the Keychain and hands back ciphertext; it
 * does not persist anything itself. So we own the file layout: one file per
 * key under `userData/secure/`, containing only the ciphertext.
 *
 * This is the desktop counterpart of the mobile app's `expo-secure-store`
 * (`secure-storage.service.ts`) and carries the same rule: tokens live *only*
 * here — never in localStorage, never in a log line.
 */

const DIR = () => join(app.getPath('userData'), 'secure')
const fileFor = (key: SecureKey) => join(DIR(), `${key}.bin`)

function assertKnownKey(key: string): asserts key is SecureKey {
  if (!SECURE_KEYS.includes(key as SecureKey)) {
    throw new Error(`Refusing to touch unknown secure key: ${key}`)
  }
}

export function isSecureStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export async function secureGet(key: string): Promise<string | null> {
  assertKnownKey(key)
  const file = fileFor(key)
  if (!existsSync(file)) return null
  try {
    const ciphertext = await readFile(file)
    if (ciphertext.length === 0) return null
    return safeStorage.decryptString(ciphertext)
  } catch (err) {
    // A Keychain reset or a restore onto a different machine leaves ciphertext
    // we can no longer read. Drop it so the user simply logs in again instead
    // of hitting an undecryptable file on every launch.
    log.warn(`[secure-store] dropping unreadable "${key}":`, (err as Error).message)
    await secureDelete(key).catch(() => {})
    return null
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  assertKnownKey(key)
  if (!isSecureStorageAvailable()) {
    throw new Error('OS secure storage unavailable — refusing to persist token in plaintext')
  }
  await mkdir(DIR(), { recursive: true, mode: 0o700 })
  const ciphertext = safeStorage.encryptString(value)
  await writeFile(fileFor(key), ciphertext, { mode: 0o600 })
}

export async function secureDelete(key: string): Promise<void> {
  assertKnownKey(key)
  await rm(fileFor(key), { force: true })
}

export async function secureClearAll(): Promise<void> {
  await Promise.allSettled(SECURE_KEYS.map((k) => secureDelete(k)))
}
