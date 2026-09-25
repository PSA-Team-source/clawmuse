import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { paths } from './paths.js'

/**
 * Owns `~/.openclaw-clawmuse/.env` — where BYOK provider keys live.
 *
 * Why a dotfile and not the config document: OpenClaw's precedence is
 * `process env → ./.env → <stateDir>/.env → openclaw.json 'env'`, and the
 * service installer treats `<stateDir>/.env` as a first-class environment
 * source (`service-env-plan.ts`, source `state-dotenv`). So a key written here
 * reaches the launchd-managed gateway without the app having to inject it, and
 * `openclaw.json` — the file a user is most likely to paste into a bug report —
 * stays free of secrets.
 *
 * Mode 0600, written atomically: a torn write during `gateway restart` would
 * leave the daemon with half a key.
 */

const HEADER = [
  '# Managed by ClawMuse Desktop.',
  '# Provider credentials for the local OpenClaw gateway (profile: clawmuse).',
  '# Anything you add by hand below is preserved.',
  '',
].join('\n')

export type EnvMap = Record<string, string>

export function parseEnv(text: string): EnvMap {
  const out: EnvMap = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const withoutExport = line.startsWith('export ') ? line.slice(7) : line
    const eq = withoutExport.indexOf('=')
    if (eq <= 0) continue
    const key = withoutExport.slice(0, eq).trim()
    let value = withoutExport.slice(eq + 1).trim()
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      // Undo the shell escape `serializeEnv` emits for embedded quotes: a value
      // like `a'b` is written as `'a'\''b'`. Stripping the outer quotes alone
      // would hand back a corrupted key.
      value = value.slice(1, -1).replaceAll("'\\''", "'")
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

export function serializeEnv(map: EnvMap): string {
  const body = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    // Single quotes with escaping: values are API keys and URLs, and an
    // unquoted `#` or space would be read as a comment or split by the shell
    // wrapper launchd uses to source this file.
    .map(([key, value]) => `${key}='${value.replaceAll("'", "'\\''")}'`)
    .join('\n')
  return `${HEADER}${body}\n`
}

export async function readEnvFile(): Promise<EnvMap> {
  try {
    return parseEnv(await readFile(paths.env, 'utf8'))
  } catch {
    return {}
  }
}

/** Merges `updates` into the existing file. A `null` value removes the key. */
export async function patchEnvFile(updates: Record<string, string | null>): Promise<void> {
  const current = await readEnvFile()
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete current[key]
    else current[key] = value
  }
  // On a machine that has never run ClawMuse, `~/.openclaw-clawmuse` does not exist yet —
  // and this is the *first* thing `applyProvider` does, before the config write
  // that used to be the only thing creating it. Without this, a genuinely fresh
  // install threw ENOENT the moment the user pressed "Save and start" on the
  // very first screen. 0700 because the next line writes a credential into it.
  await mkdir(dirname(paths.env), { recursive: true, mode: 0o700 })
  const tmp = `${paths.env}.tmp`
  await writeFile(tmp, serializeEnv(current), { mode: 0o600 })
  await rename(tmp, paths.env)
}
