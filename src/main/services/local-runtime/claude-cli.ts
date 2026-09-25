import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { DEFAULT_MODEL_BY_PROVIDER, type ProviderChoice } from '@shared/ipc'
import { run } from './exec.js'

/**
 * Claude Code, already signed in on this Mac, as ClawMuse's model — no API key.
 *
 * OpenClaw's own guidance (docs/gateway/authentication.md, "Claude CLI
 * reuse"): "when a Claude CLI login is available on the host, that's the
 * preferred path for local/desktop use." The installed `claude` reads and
 * refreshes its own login; OpenClaw never sees the tokens. Usage draws from
 * the signed-in plan's limits (docs/providers/anthropic.md, "Billing").
 *
 * Config shape is the documented one: the canonical `anthropic/*` model ref
 * plus `agentRuntime: { id: "claude-cli" }` (written by `wireProvider`).
 */

/** Where the official installers put `claude`; a Dock launch has no shell PATH to search. */
const CANDIDATES = process.platform === 'win32'
  ? [
      // Anthropic's native installer, then npm's global shim (run via exec.ts's cmd-shim mapping).
      join(homedir(), '.local', 'bin', 'claude.exe'),
      join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
    ]
  : [
      join(homedir(), '.local', 'bin', 'claude'),
      join(homedir(), '.claude', 'local', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ]

export function findClaudeBin(): string | null {
  return CANDIDATES.find((path) => existsSync(path)) ?? null
}

/** The Claude Code binary when it is installed *and* signed in, else null. */
export async function claudeCliLogin(): Promise<string | null> {
  const bin = findClaudeBin()
  if (!bin) return null
  const result = await run(bin, ['auth', 'status', '--json'], { timeoutMs: 15_000 })
  if (result.code !== 0) return null
  try {
    const status = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as { loggedIn?: unknown }
    return status.loggedIn === true ? bin : null
  } catch {
    return null
  }
}

export function claudeCliProvider(): ProviderChoice {
  return { id: 'anthropic', model: DEFAULT_MODEL_BY_PROVIDER.anthropic!, runtime: 'claude-cli' }
}

/**
 * The gateway runs `claude` by name ("The gateway service must resolve
 * `claude` on PATH"), and a GUI launch's PATH rarely includes ~/.local/bin.
 * Prepended to this process's PATH, which `openclawEnv()` hands to the CLI and
 * `gateway install` records for the service.
 */
export function ensureClaudeOnPath(bin: string): void {
  const dir = dirname(bin)
  const parts = (process.env.PATH ?? '').split(delimiter)
  if (!parts.includes(dir)) process.env.PATH = [dir, ...parts].filter(Boolean).join(delimiter)
}
