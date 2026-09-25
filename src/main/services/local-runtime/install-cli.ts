import { existsSync, readdirSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import log from 'electron-log/main.js'
import { firstMeaningfulLine, run } from './exec.js'
import { openclawEnv, paths } from './paths.js'

/**
 * Installs the `openclaw` CLI into the app-managed prefix.
 *
 * Two decisions worth keeping:
 *
 * - **Not `-g`.** A global install would fight with an `openclaw` the user
 *   maintains for their own work, and an app has no business mutating the
 *   user's global npm root. `--prefix ~/.openclaw-clawmuse/runtime` keeps it contained,
 *   and `resolve.ts` prefers it over PATH.
 * - **Pinned version.** `docs/platforms/mac/bundled-gateway.md` notes the mac
 *   app checks gateway version against its own. Pinning means an app release is
 *   tested against exactly one runtime instead of whatever npm serves that day.
 */

/** Latest stable OpenClaw release verified for ClawMuse on 2026-09-23. */
export const PINNED_OPENCLAW_VERSION = '2026.9.5'

type PackageManager = { bin: string; label: string; args: (spec: string) => string[] }

/**
 * The npm that ships inside ClawMuse. A new Mac has no Node, npm, pnpm or bun —
 * Electron's embedded Node is the only one (node-check.ts `bundledNode`) — so
 * without this the first launch ended at "Could not install the OpenClaw
 * runtime" for exactly the people who never installed developer tools. It runs
 * through the app's own `node` shim, so it needs nothing on PATH.
 *
 * Packaged, it is the published npm tarball in Resources/vendor
 * (scripts/vendor-npm.mjs), extracted once with the system `tar` into the
 * profile. In dev and tests it is the `npm` devDependency. Null when neither is
 * there; the system package managers below still get their turn.
 */
export async function ensureBundledNpm(): Promise<string | null> {
  const cli = await locateBundledNpm()
  if (cli && process.platform === 'win32') await writeWindowsNpmShims(cli)
  return cli
}

/**
 * `npm.cmd`/`npx.cmd` beside our `node.cmd`: OpenClaw spawns `npm.cmd` itself
 * (`gateway install` failed with "spawn npm.cmd ENOENT" on a clean Windows),
 * and a new user has no Node or npm installed. The node-bin directory leads
 * PATH for the CLI and the gateway, so this npm is the one they find.
 */
async function writeWindowsNpmShims(npmCli: string): Promise<void> {
  await mkdir(paths.nodeBin, { recursive: true })
  const npxCli = join(dirname(npmCli), 'npx-cli.js')
  const shim = (script: string) => `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${script}" %*\r\n`
  await writeFile(join(paths.nodeBin, 'npm.cmd'), shim(npmCli))
  if (existsSync(npxCli)) await writeFile(join(paths.nodeBin, 'npx.cmd'), shim(npxCli))
}

async function locateBundledNpm(): Promise<string | null> {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const vendor = resources ? join(resources, 'vendor') : null
  const tarball = vendor && existsSync(vendor) ? readdirSync(vendor).find((f) => /^npm-[\d.]+\.tgz$/.test(f)) : undefined
  if (vendor && tarball) {
    const target = join(paths.home, 'tools', tarball.replace(/\.tgz$/, ''))
    const cli = join(target, 'bin', 'npm-cli.js')
    if (existsSync(cli)) return cli
    // Extract beside the target and rename into place, so a launch interrupted
    // mid-extract never leaves a half-written npm that looks installed.
    const staging = `${target}.partial`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    // Windows 10+ ships bsdtar as %SystemRoot%\System32\tar.exe, which reads .tgz.
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar'
    const untar = await run(tar, ['-xzf', join(vendor, tarball), '-C', staging], { timeoutMs: 120_000 })
    if (untar.code === 0 && existsSync(join(staging, 'package', 'bin', 'npm-cli.js'))) {
      await rm(target, { recursive: true, force: true })
      await rename(join(staging, 'package'), target)
      await rm(staging, { recursive: true, force: true })
      return cli
    }
    log.warn(`[local-runtime] could not unpack the bundled npm: ${firstMeaningfulLine(untar.stderr) || untar.code}`)
    await rm(staging, { recursive: true, force: true })
    return null
  }
  return devNpmCli()
}

/** The `npm` devDependency — what dev runs and tests use. */
export function devNpmCli(): string | null {
  try {
    const cli = join(dirname(createRequire(import.meta.url).resolve('npm/package.json')), 'bin', 'npm-cli.js')
    return existsSync(cli) ? cli : null
  } catch {
    return null
  }
}

async function managers(): Promise<PackageManager[]> {
  // --no-update-notifier: "npm 12 is out" is not something a first-run screen should say.
  const npmArgs = (spec: string) =>
    ['install', '--prefix', paths.runtime, spec, '--no-audit', '--no-fund', '--no-update-notifier']
  const bundled = await ensureBundledNpm()
  return [
    ...(bundled && existsSync(paths.nodeShim)
      ? [{ bin: paths.nodeShim, label: 'bundled npm', args: (spec: string) => [bundled, ...npmArgs(spec)] }]
      : []),
    ...MANAGERS,
  ]
}

const MANAGERS: PackageManager[] = [
  { bin: 'npm', label: 'npm', args: (spec) => ['install', '--prefix', paths.runtime, spec, '--no-audit', '--no-fund'] },
  { bin: 'pnpm', label: 'pnpm', args: (spec) => ['add', '--dir', paths.runtime, spec] },
  { bin: 'bun', label: 'bun', args: (spec) => ['add', '--cwd', paths.runtime, spec] },
]

export interface InstallProgress {
  (line: string): void
}

export async function installOpenclawCli(onProgress?: InstallProgress): Promise<void> {
  await mkdir(paths.runtime, { recursive: true })
  const spec = `openclaw@${PINNED_OPENCLAW_VERSION}`
  const failures: string[] = []

  for (const manager of await managers()) {
    onProgress?.(`Installing ${spec} with ${manager.label}…`)
    const result = await run(manager.bin, manager.args(spec), {
      env: openclawEnv(),
      cwd: paths.runtime,
      // A cold npm install of openclaw pulls a large tree; 10 minutes is the
      // difference between "slow network" and "actually stuck".
      timeoutMs: 600_000,
      onLine: (line) => onProgress?.(line),
    })

    if (result.code === 0) {
      log.info(`[local-runtime] installed ${spec} via ${manager.label}`)
      return
    }

    const reason = result.timedOut ? 'timed out' : firstMeaningfulLine(result.stderr) || `exit ${result.code}`
    failures.push(`${manager.label}: ${reason}`)
    log.warn(`[local-runtime] ${manager.label} install failed — ${reason}`)
  }

  throw new Error(`Could not install the OpenClaw runtime. Tried ${failures.join('; ')}`)
}
