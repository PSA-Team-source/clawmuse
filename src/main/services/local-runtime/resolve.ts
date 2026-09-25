import { existsSync } from 'node:fs'
import log from 'electron-log/main.js'
import type { OpenclawResolution, OpenclawSource } from '@shared/ipc'
import { run } from './exec.js'
import { PINNED_OPENCLAW_VERSION } from './install-cli.js'
import { openclawEnv, paths } from './paths.js'

/**
 * Finds the `openclaw` binary this app should drive.
 *
 * Order is deliberate:
 *   1. `CLAWMUSE_OPENCLAW_BIN` (or the older `LOCALFANG_OPENCLAW_BIN`) — dev/CI escape hatch, wins over everything.
 *   2. managed install under `~/.openclaw-clawmuse/runtime` — what the app installs itself.
 *      Preferred over PATH so the app controls the version it was tested with
 *      and never mutates a global install the user maintains for other work.
 *   3. `openclaw` on PATH — the user already has one; reuse rather than
 *      duplicate a ~200 MB dependency tree.
 *
 * A Docker fallback is Phase 9. There is deliberately no cloud fallback: a
 * local failure must stay a local failure (G6).
 */

const CANDIDATE_TIMEOUT = 15_000

/**
 * `2026.9.5` → `[2026, 9, 5]`.
 *
 * The build suffix is dropped on purpose. It is an increment within a release,
 * not a semver prerelease, so ordering it would mean taking a position on
 * whether `2026.7.1` precedes `2026.7.1-2` — a question this gate does not need
 * to answer. Comparing the release triple alone is enough to catch the case
 * that matters: a CLI from an older release line.
 */
function versionParts(version: string): number[] {
  return (version.split('-')[0] ?? '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0))
}

/**
 * Whether a CLI predates the release this app generates config for.
 *
 * Load-bearing, and the failure it prevents is genuinely confusing: config keys
 * are added over time, so an older CLI rejects a *correct* document. A stale
 * `openclaw` on PATH (a Homebrew install kept for other work, say) made every
 * launch fail at "Generated an invalid gateway config" with a bare
 * `gateway: Invalid input` — pointing at the app's own config, which was fine,
 * rather than at the binary reading it.
 */
export function isOutdatedOpenclaw(version: string): boolean {
  const have = versionParts(version)
  const want = versionParts(PINNED_OPENCLAW_VERSION)
  for (let i = 0; i < want.length; i += 1) {
    const a = have[i] ?? 0
    const b = want[i] ?? 0
    if (a !== b) return a < b
  }
  return false
}

async function probe(bin: string, source: OpenclawSource): Promise<OpenclawResolution | null> {
  const result = await run(bin, ['--version'], { env: openclawEnv(), timeoutMs: CANDIDATE_TIMEOUT })
  if (result.code !== 0) return null
  // `openclaw --version` prints e.g. "OpenClaw 2026.9.5 (ec9c1a1)".
  const version = /(\d{4}\.\d+\.\d+[\w.-]*)/.exec(result.stdout)?.[1]
  if (!version) return null
  return { bin, version, source }
}

export async function resolveOpenclaw(): Promise<OpenclawResolution | null> {
  const override = (process.env.CLAWMUSE_OPENCLAW_BIN ?? process.env.LOCALFANG_OPENCLAW_BIN)?.trim()
  if (override) {
    const resolved = await probe(override, 'env-override')
    if (resolved) return resolved
    // An explicit override that does not work is a configuration error, not a
    // reason to silently fall through to something else.
    log.error('[local-runtime] CLAWMUSE_OPENCLAW_BIN set but unusable:', override)
    return null
  }

  if (existsSync(paths.runtimeBin)) {
    const resolved = await probe(paths.runtimeBin, 'managed')
    // A managed install can be stale too — an app upgrade bumps the pin without
    // touching what an earlier release already put on disk. Rejecting it here
    // makes `ensure()` reinstall at the new pin instead of running the old one.
    if (resolved && accept(resolved)) return resolved
  }

  const onPath = await probe('openclaw', 'path')
  if (onPath && accept(onPath)) return onPath

  // Nothing usable was found. Returning null sends `ensure()` into
  // `installOpenclawCli()`, which installs the pinned version into the
  // app-managed prefix — the one path that is guaranteed to match this build.
  return null
}

/** Accepts a candidate, or logs why a too-old one is being ignored. */
function accept(resolution: OpenclawResolution): boolean {
  if (!isOutdatedOpenclaw(resolution.version)) return true
  log.warn(
    `[local-runtime] ignoring ${resolution.source} openclaw ${resolution.version} at ${resolution.bin} — ` +
      `older than the ${PINNED_OPENCLAW_VERSION} this build generates config for`,
  )
  return false
}
