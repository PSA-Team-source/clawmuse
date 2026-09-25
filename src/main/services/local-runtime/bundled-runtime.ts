import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main.js'
import { firstMeaningfulLine, run } from './exec.js'
import { systemTar, vendorDir } from './install-cli.js'
import { paths } from './paths.js'
import { compareOpenclawVersions, isOutdatedOpenclaw } from './resolve.js'

/**
 * The OpenClaw runtime that shipped inside the installer.
 *
 * A first launch used to run `npm install openclaw` — ~330 packages from the
 * network, minutes on a good connection and a failure on a flaky one. The
 * build now installs that same tree per target (scripts/vendor-openclaw.mjs)
 * and ships it as Resources/vendor/openclaw-runtime-<version>.{tar.xz,tgz}; here it is
 * unpacked into `paths.runtime` with the system tar. `installOpenclawCli` stays
 * as the fallback for anything this cannot do.
 */

const TARBALL = /^openclaw-runtime-(\d{4}\.\d+\.\d+(?:-[\w.]+?)?)\.(?:tar\.xz|tgz)$/

export interface BundledRuntime {
  file: string
  version: string
}

/**
 * The newest usable runtime tarball in `dir`, or null. One ships per build;
 * the version is read from the name so an app upgrade that bumps the pin
 * cannot unpack an older runtime than it generates config for.
 */
export function bundledRuntimeTarball(dir: string | null): BundledRuntime | null {
  if (!dir || !existsSync(dir)) return null
  const found = readdirSync(dir)
    .map((name) => ({ name, version: TARBALL.exec(name)?.[1] }))
    .filter((entry): entry is { name: string; version: string } => Boolean(entry.version) && !isOutdatedOpenclaw(entry.version!))
    .sort((a, b) => compareOpenclawVersions(b.version, a.version))[0]
  return found ? { file: join(dir, found.name), version: found.version } : null
}

/** The version of the managed runtime already on disk, if any. */
function installedVersion(prefix: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(prefix, 'node_modules', 'openclaw', 'package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/** Whether `prefix` holds the entry point `paths.runtimeBin` points at (a symlink on macOS, a .cmd on Windows). */
function hasRuntimeBin(prefix: string): boolean {
  const bin = join(prefix, 'node_modules', '.bin', process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw')
  return lstatSync(bin, { throwIfNoEntry: false }) !== undefined
}

/**
 * Unpacks the shipped runtime into `paths.runtime`. True when it is in place;
 * false — with a log line saying why — when the caller should fall back to the
 * npm install.
 *
 * Atomic: it unpacks into a staging directory beside the runtime, checks what
 * came out, and only then renames it into place, so an interrupted launch
 * never leaves a half-written tree that looks installed. `node-bin/` (the Node
 * shim node-check.ts writes) lives in the same prefix and is left alone.
 *
 * Never replaces a newer runtime: a managed install ahead of the shipped one
 * belongs to something that knew better, and the npm path decides what to do.
 */
export async function installBundledRuntime(dir: string | null = vendorDir()): Promise<boolean> {
  const bundled = bundledRuntimeTarball(dir)
  if (!bundled) return false

  const existing = installedVersion(paths.runtime)
  if (existing && compareOpenclawVersions(existing, bundled.version) > 0) {
    log.info(`[local-runtime] keeping the managed openclaw ${existing}; the bundled ${bundled.version} is older`)
    return false
  }

  const started = Date.now()
  const staging = `${paths.runtime}.partial`
  const replaced = `${paths.runtime}.replaced`
  try {
    await rm(staging, { recursive: true, force: true })
    await rm(replaced, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    // `-xf`: bsdtar (macOS and Windows alike) detects xz or gzip itself.
    const untar = await run(systemTar(), ['-xf', bundled.file, '-C', staging], { timeoutMs: 600_000 })
    if (untar.code !== 0) throw new Error(untar.timedOut ? 'tar timed out' : firstMeaningfulLine(untar.stderr) || `tar exit ${untar.code}`)
    const unpacked = installedVersion(staging)
    if (unpacked !== bundled.version || !hasRuntimeBin(staging)) {
      throw new Error(`the archive holds openclaw ${unpacked ?? 'nothing'} without its launcher, expected ${bundled.version}`)
    }

    await mkdir(paths.runtime, { recursive: true })
    await mkdir(replaced, { recursive: true })
    const current = join(paths.runtime, 'node_modules')
    if (existsSync(current)) await rename(current, join(replaced, 'node_modules'))
    try {
      await rename(join(staging, 'node_modules'), current)
    } catch (error) {
      // Put the previous tree back rather than leave the prefix empty.
      if (existsSync(join(replaced, 'node_modules'))) await rename(join(replaced, 'node_modules'), current).catch(() => undefined)
      throw error
    }
    // The manifest npm would have written, so a later npm install into this
    // prefix (the fallback, or an upgrade) sees the tree it is updating.
    for (const file of ['package.json', 'package-lock.json']) {
      if (existsSync(join(staging, file))) await rename(join(staging, file), join(paths.runtime, file))
    }
    log.info(`[local-runtime] installed openclaw@${bundled.version} from the bundled runtime in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    return true
  } catch (error) {
    log.warn(`[local-runtime] could not unpack the bundled runtime, falling back to npm — ${(error as Error).message}`)
    return false
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    await rm(replaced, { recursive: true, force: true }).catch(() => undefined)
  }
}
