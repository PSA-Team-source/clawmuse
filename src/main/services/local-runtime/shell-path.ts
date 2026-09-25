import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import log from 'electron-log/main.js'
import { run } from './exec.js'

/**
 * Repairs `process.env.PATH` for a GUI launch.
 *
 * A macOS app opened from Finder or the Dock does not inherit a login shell, so
 * it gets the bare `/usr/bin:/bin:/usr/sbin:/sbin`. Homebrew (`/opt/homebrew/bin`),
 * nvm, fnm and Volta all live outside that, which means `node` and `npm` are
 * invisible — and the app reports "Node is not installed" on a machine where
 * Node is installed and working. Verified against the packaged build: launched
 * with a Finder-like PATH it stops at the node check even with a complete
 * `~/.openclaw-clawmuse` profile.
 *
 * Running the app from a terminal hides this completely, which is why every
 * earlier test passed.
 *
 * Two sources, in order:
 *   1. the user's login shell, which is the authoritative answer,
 *   2. the well-known install locations, as a floor when the shell cannot be
 *      probed (locked-down shell, unusual `$SHELL`, timeout).
 */

/** Where Node ends up on a Mac, in rough order of likelihood. */
export function commonBinDirs(): string[] {
  const home = homedir()
  return [
    '/opt/homebrew/bin', // Homebrew, Apple silicon
    '/usr/local/bin', // Homebrew, Intel — and the nodejs.org installer
    join(home, '.volta', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
    '/opt/local/bin', // MacPorts
  ]
}

/**
 * Asks the login shell what PATH it would give an interactive session.
 *
 * `-ilc` because Homebrew's `shellenv` line lives in `.zprofile` for some users
 * and `.zshrc` for others; only an interactive login shell sources both. It is
 * also why this needs a timeout: a shell whose rc file blocks on input would
 * otherwise hang startup.
 */
async function shellPath(): Promise<string | null> {
  const shell = process.env.SHELL
  if (!shell) return null
  const result = await run(shell, ['-ilc', 'command -p echo "$PATH"'], {
    timeoutMs: 5_000,
    // A clean env would defeat the point: we want what this user's shell builds.
    env: process.env as Record<string, string>,
  })
  if (result.code !== 0) return null
  const line = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('/'))
    .pop()
  return line && line.length > 0 ? line : null
}

function mergePaths(...groups: (string | null | undefined)[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of groups) {
    for (const entry of (group ?? '').split(delimiter)) {
      const dir = entry.trim()
      if (dir.length === 0 || seen.has(dir)) continue
      seen.add(dir)
      out.push(dir)
    }
  }
  return out.join(delimiter)
}

let hydrated: Promise<void> | null = null

/**
 * Idempotent, and safe to call on every `ensure()` — the probe runs once.
 *
 * Mutates `process.env.PATH` rather than threading a value through every call
 * site: `run()` inherits the parent environment by default, so one fix here
 * covers the node check, the CLI install, and every gateway invocation.
 */
export function hydratePath(): Promise<void> {
  hydrated ??= (async () => {
    // Windows GUI apps inherit the user's full PATH from Explorer — there is
    // nothing to repair (and ':' splitting would cut every `C:\` entry).
    if (process.platform === 'win32') return
    const fromShell = await shellPath().catch(() => null)
    const merged = mergePaths(fromShell, process.env.PATH, commonBinDirs().join(delimiter))
    if (merged !== process.env.PATH) {
      log.info(
        `[local-runtime] PATH repaired for GUI launch (${fromShell ? 'login shell' : 'known locations'})`,
      )
    }
    process.env.PATH = merged
  })()
  return hydrated
}

/** Test seam: forget the memoized probe. */
export function resetPathHydrationForTests(): void {
  hydrated = null
}

export const __testing = { mergePaths, commonBinDirs }
