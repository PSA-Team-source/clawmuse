import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/main.js'

/**
 * Adopts the OpenCode key already on this Mac, so OpenCode's models show up without asking the user for a key they already
 * gave OpenCode.
 *
 * Additive, unlike `adopt-host`: it never changes the default model, it only
 * makes the `opencode` (Zen) and `opencode-go` providers usable. One OpenCode
 * key serves both catalogues (OpenClaw's catalog: "Shared API key for Zen + Go
 * catalogs").
 *
 * Same rules as `key-scan.ts`: read the file, never write it, never log a value,
 * and never consult `process.env` (a Dock launch has no shell).
 */

/** OpenCode's auth store (XDG data dir default). */
export const OPENCODE_AUTH_FILE = join(homedir(), '.local', 'share', 'opencode', 'auth.json')

/** Provider ids a single OpenCode key unlocks in OpenClaw. */
export const OPENCODE_PROVIDER_IDS = ['opencode', 'opencode-go'] as const

/** The env var OpenClaw's OpenCode providers read. */
export const OPENCODE_ENV_VAR = 'OPENCODE_API_KEY'

/**
 * The API key in OpenCode's `auth.json`: `{ "<provider>": { "type": "api", "key": "…" } }`.
 * Only API-key entries count — an OAuth entry is not a key OpenClaw can use.
 */
export function opencodeKeyFrom(auth: unknown): string | null {
  if (!auth || typeof auth !== 'object') return null
  for (const id of OPENCODE_PROVIDER_IDS) {
    const entry = (auth as Record<string, unknown>)[id] as { type?: unknown; key?: unknown } | undefined
    if (entry?.type === 'api' && typeof entry.key === 'string' && entry.key.trim()) return entry.key.trim()
  }
  return null
}

export async function readOpencodeKey(path = OPENCODE_AUTH_FILE): Promise<string | null> {
  if (!existsSync(path)) return null
  try {
    return opencodeKeyFrom(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    log.warn('[opencode-adopt] OpenCode auth.json is unreadable:', (error as Error).message)
    return null
  }
}
