import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { execPath } from 'node:process'
import log from 'electron-log/main.js'
import type { NodeCheck } from '@shared/ipc'
import { run } from './exec.js'
import { commonBinDirs } from './shell-path.js'
import { CLAWMUSE_HOME, LEGACY_HOMES, LEGACY_LAUNCH_AGENT, LEGACY_LAUNCHD_LABEL, paths } from './paths.js'

/**
 * OpenClaw 2026.9.5 publishes a strict engine range: Node 24.16+ below 25, or
 * Node 26.1+. Reject 22/25 before installation so npm's engine warning cannot
 * turn into a confusing gateway crash after setup.
 */
const MIN_NODE_24_MINOR = 16

export function evaluateNodeVersion(version: string): NodeCheck {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return { ok: false, version, warning: 'Unrecognised Node version' }

  const major = Number(match[1])
  const minor = Number(match[2])

  const supported =
    (major === 24 && minor >= MIN_NODE_24_MINOR) ||
    (major === 26 && minor >= 1) ||
    major > 26

  if (!supported) {
    return {
      ok: false,
      version,
      warning: `Node ${version} is not supported by OpenClaw 2026.9.5. Install Node 24.16+ or 26.1+.`,
    }
  }
  if (major > 26) {
    return {
      ok: true,
      version,
      warning: `Node ${version} is newer than the versions LocalFang has been tested against.`,
    }
  }
  return { ok: true, version }
}

/**
 * Tells "there is no Node here" apart from "the Node here does not work".
 *
 * They are completely different problems with completely different fixes, and
 * the app used to report both as "Node is not installed or not on PATH.
 * Install Node 24 from nodejs.org" — advice that is not just unhelpful to
 * someone who already has Node, it is actively misleading.
 *
 * The case that produced this: a Homebrew upgrade left
 * `/opt/homebrew/bin/node` pointing at a build whose `libsimdjson` had moved,
 * so the binary existed, was executable, was first on PATH, and died on every
 * launch with a dyld error. Nothing about "install Node" would have fixed it.
 */
export function describeNodeFailure(stderr: string): string {
  const first = stderr.split('\n').find((line) => line.trim().length > 0)?.trim() ?? ''

  if (/dyld|Library not loaded|image not found/i.test(stderr)) {
    return `Node is installed but cannot start: ${first} — try reinstalling it (\`brew reinstall node\`).`
  }
  if (first) {
    return `Node is installed but cannot start: ${first}`
  }
  return 'Node is not installed or not on PATH. Install Node 24.16+ or 26.1+ from nodejs.org.'
}

/** A working `node`, and where it was found. */
interface NodeProbe {
  ok: boolean
  version: string
  stderr: string
  /** The directory that has to lead PATH for this one to win. `null` = already does. */
  dir: string | null
}

async function probe(command: string, dir: string | null): Promise<NodeProbe> {
  const result = await run(command, ['--version'], { timeoutMs: 10_000 })
  return { ok: result.code === 0, version: result.stdout, stderr: result.stderr, dir }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * First launch after the LocalFang → ClawMuse rename: bring the old profile
 * across, once. The old directory is copied, never moved or deleted — it stays
 * behind as the user's backup — and the old LaunchAgent is retired first, so two
 * gateways never fight over one port. Absolute paths the config stored (agent
 * dirs, bot workspaces, the shared workspace) are pointed at the new home; a
 * profile carried forward from `~/.localfang` still named that directory.
 */
async function migrateLegacyProfile(): Promise<void> {
  if (existsSync(CLAWMUSE_HOME)) return
  const source = LEGACY_HOMES.find((home) => existsSync(home))
  if (!source) return
  if (existsSync(LEGACY_LAUNCH_AGENT)) {
    const uid = process.getuid?.() ?? 0
    await run('launchctl', ['bootout', `gui/${uid}/${LEGACY_LAUNCHD_LABEL}`], { timeoutMs: 20_000 }).catch(() => undefined)
    await rm(LEGACY_LAUNCH_AGENT, { force: true })
    log.info(`[local-runtime] retired the pre-rename gateway service ${LEGACY_LAUNCHD_LABEL}`)
  }
  await cp(source, CLAWMUSE_HOME, { recursive: true, errorOnExist: false, verbatimSymlinks: true })
  if (existsSync(paths.config)) {
    const before = await readFile(paths.config, 'utf8')
    const after = rewriteLegacyPaths(before)
    if (after !== before) await writeFile(paths.config, after, { mode: 0o600 })
  }
  log.info(`[local-runtime] carried the profile from ${source} to ${CLAWMUSE_HOME} (the original is left in place)`)
}

/** Every stored absolute path under an old profile home, re-rooted at the new one. */
export function rewriteLegacyPaths(text: string): string {
  let out = text
  // Longest first: `~/.openclaw-localfang` must not be half-matched as `~/.localfang`.
  for (const home of [...LEGACY_HOMES].sort((a, b) => b.length - a.length)) {
    out = out.split(`${home}/`).join(`${CLAWMUSE_HOME}/`).split(`"${home}"`).join(`"${CLAWMUSE_HOME}"`)
  }
  return out
}

/**
 * Electron 43 ships Node 24.18, inside the application bundle. Expose that
 * runtime through a private `node` shim so a clean Mac can install and run
 * OpenClaw without Homebrew, nodejs.org, or any account. The shim stays under
 * the app-owned runtime directory and never changes the user's global PATH.
 */
async function bundledNode(): Promise<NodeProbe | null> {
  if (process.platform === 'win32') {
    // `node.cmd` is never executed by cmd.exe from this app — `exec.ts` maps it
    // straight to Electron in Node mode — but OpenClaw's Scheduled Task runs
    // the gateway through it, so it must also work as a real batch file.
    await mkdir(paths.nodeBin, { recursive: true })
    await writeFile(paths.nodeShim, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" %*\r\n`)
    const found = await probe(paths.nodeShim, paths.nodeBin)
    return found.ok ? found : null
  }
  await migrateLegacyProfile()
  if (existsSync(paths.runtimeBin)) {
    const target = await readlink(paths.runtimeBin).catch(() => '')
    if (LEGACY_HOMES.some((home) => target.startsWith(home))) {
      await rm(paths.runtime, { recursive: true, force: true })
      log.info('[local-runtime] discarded the copied runtime cache so OpenClaw can reinstall canonically')
    }
  }
  await mkdir(paths.nodeBin, { recursive: true })
  const script = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} "$@"\n`
  await writeFile(paths.nodeShim, script, { mode: 0o700 })
  await chmod(paths.nodeShim, 0o700)
  const found = await probe(paths.nodeShim, paths.nodeBin)
  return found.ok ? found : null
}

/**
 * Node as seen by a *spawned process*, which is what actually matters: Electron
 * bundles its own Node, but the gateway runs under the user's `node` on PATH.
 *
 * When the first one on PATH cannot run, the known install locations are tried
 * before giving up — a broken Homebrew node must not hide a perfectly good one
 * two directories later. A winner is promoted to the front of `PATH` so the CLI
 * install and the gateway itself use the same binary this check approved.
 */
export async function checkNode(): Promise<NodeCheck> {
  const embedded = await bundledNode()
  if (embedded) {
    const evaluated = evaluateNodeVersion(embedded.version)
    if (evaluated.ok) {
      process.env.PATH = `${paths.nodeBin}${delimiter}${process.env.PATH ?? ''}`
      return evaluated
    }
  }

  const first = await probe('node', null)
  const firstEvaluation = first.ok ? evaluateNodeVersion(first.version) : null
  if (firstEvaluation?.ok) return firstEvaluation

  for (const dir of commonBinDirs()) {
    const candidate = join(dir, 'node')
    if (!existsSync(candidate)) continue
    const found = await probe(candidate, dir)
    if (!found.ok) continue

    const evaluated = evaluateNodeVersion(found.version)
    if (!evaluated.ok) continue

    process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`
    log.warn(
      `[local-runtime] the first node on PATH could not start; using ${candidate} (${found.version.trim()}) instead`,
    )
    return evaluated
  }

  if (firstEvaluation) return firstEvaluation
  return { ok: false, version: 'not found', warning: describeNodeFailure(first.stderr) }
}
