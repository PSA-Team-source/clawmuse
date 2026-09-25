/**
 * Builds the OpenClaw runtime that ships inside the installer, one tarball per
 * target: vendor/openclaw/<os>-<arch>/openclaw-runtime-<version>.<ext>, where
 * <os>-<arch> is electron-builder's `${os}-${arch}` (mac-arm64, mac-x64,
 * win-x64, win-arm64). electron-builder.yml copies exactly that directory into
 * Resources/vendor, so each installer carries only its own platform's binaries.
 *
 * Why: without it a new user's first launch ran `npm install openclaw` (~330
 * packages) and waited minutes on the network. With it, first launch is one
 * local `tar -x` (install-cli.ts installBundledRuntime); the npm install stays
 * as the fallback.
 *
 * How the tree is made: the same `npm install --prefix <dir> openclaw@<pin>`
 * the app runs, with npm's `--os`/`--cpu` so optional platform packages
 * (@openclaw/fs-safe-*, koffi, node-pty, cua-driver…) resolve for the TARGET,
 * not for this build machine. It runs under Electron-as-Node when available,
 * which is the Node the app itself installs and runs OpenClaw with.
 *
 * A tarball, like vendor/npm-*.tgz: electron-builder strips every node_modules
 * folder it copies. xz for macOS — 90 MB against gzip's 136 MB, for ~5 s more
 * unpacking — since /usr/bin/tar links liblzma. gzip for Windows: its
 * System32\\tar.exe is known to read .tgz (the bundled npm ships that way),
 * and xz support there has not been verified.
 *
 * Usage: node scripts/vendor-openclaw.mjs mac-arm64 [win-x64 …]
 *   (called per target by scripts/before-pack.mjs)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')
const require = createRequire(import.meta.url)

const TARGETS = {
  'mac-arm64': { os: 'darwin', cpu: 'arm64', ext: 'tar.xz', flag: ['-cJf'] },
  'mac-x64': { os: 'darwin', cpu: 'x64', ext: 'tar.xz', flag: ['-cJf'] },
  'win-x64': { os: 'win32', cpu: 'x64', ext: 'tgz', flag: ['-czf'] },
  'win-arm64': { os: 'win32', cpu: 'arm64', ext: 'tgz', flag: ['-czf'] },
}

/** The one pin, read from the source the app compiles — never a second copy. */
export function pinnedOpenclawVersion() {
  const source = readFileSync(join(root, 'src/main/services/local-runtime/install-cli.ts'), 'utf8')
  const version = /export const PINNED_OPENCLAW_VERSION = '([^']+)'/.exec(source)?.[1]
  if (!version) throw new Error('vendor-openclaw: PINNED_OPENCLAW_VERSION not found in install-cli.ts')
  return version
}

export function runtimeTarballPath(target, version = pinnedOpenclawVersion()) {
  const spec = TARGETS[target]
  if (!spec) throw new Error(`vendor-openclaw: unsupported target "${target}" (supported: ${Object.keys(TARGETS).join(', ')})`)
  return join(root, 'vendor', 'openclaw', target, `openclaw-runtime-${version}.${spec.ext}`)
}

/** Every symlink under `dir`, recursively (not following them). */
function symlinksUnder(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) found.push(full)
    else if (entry.isDirectory()) symlinksUnder(full, found)
  }
  return found
}

/**
 * npm links bins by the HOST platform, so a Windows tree built here has POSIX
 * symlinks in `.bin` — which Windows' tar.exe cannot create without admin
 * rights, and which `openclaw.cmd` (paths.runtimeBin) is not. Rewrite them the
 * way npm does on Windows, with npm's own cmd-shim (.cmd + .ps1 + sh).
 */
async function windowsBinShims(prefix) {
  const cmdShim = require(join(dirname(require.resolve('npm/package.json')), 'node_modules', 'cmd-shim'))
  for (const link of symlinksUnder(join(prefix, 'node_modules'))) {
    if (!link.split(/[\\/]/).includes('.bin')) continue
    const target = resolve(dirname(link), readlinkSync(link))
    unlinkSync(link)
    await cmdShim(target, link)
  }
  const left = symlinksUnder(join(prefix, 'node_modules'))
  if (left.length > 0) throw new Error(`vendor-openclaw: symlinks Windows tar.exe cannot extract:\n  ${left.join('\n  ')}`)
}

/**
 * Electron-as-Node: the Node the app installs and runs OpenClaw with
 * (node-check.ts writes the same shim into the profile). Lifecycle scripts run
 * `node` from PATH, so the shim directory leads PATH, as it does in the app —
 * and OpenClaw's preinstall refuses a Node older than it supports, so a build
 * machine on an older Node could not produce the runtime any other way.
 */
function nodeRunner(shimDir) {
  let electron
  try {
    electron = require('electron')
  } catch {
    /* reported below */
  }
  if (typeof electron !== 'string' || !existsSync(electron)) {
    throw new Error('vendor-openclaw: the Electron binary is missing — run `node node_modules/electron/install.js`')
  }
  mkdirSync(shimDir, { recursive: true })
  if (process.platform === 'win32') {
    writeFileSync(join(shimDir, 'node.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${electron}" %*\r\n`)
  } else {
    writeFileSync(join(shimDir, 'node'), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${electron}" "$@"\n`, { mode: 0o755 })
  }
  return { bin: electron, env: { ELECTRON_RUN_AS_NODE: '1', PATH: `${shimDir}${delimiter}${process.env.PATH ?? ''}` } }
}

export async function vendorOpenclaw(target) {
  const version = pinnedOpenclawVersion()
  const out = runtimeTarballPath(target, version)
  const spec = TARGETS[target]
  const outDir = dirname(out)

  // Versioned file name: an existing one is this exact pin. Anything else in
  // the directory is a stale pin and must not ship beside it.
  mkdirSync(outDir, { recursive: true })
  for (const name of readdirSync(outDir)) if (join(outDir, name) !== out) rmSync(join(outDir, name), { recursive: true, force: true })
  if (existsSync(out) && statSync(out).size > 0) {
    console.log(`✓ vendor-openclaw: ${target} openclaw ${version} (cached, ${(statSync(out).size / 1e6).toFixed(1)} MB)`)
    return out
  }

  const staging = join(root, 'vendor', 'openclaw', `.build-${target}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  const npmCli = join(dirname(require.resolve('npm/package.json')), 'bin', 'npm-cli.js')
  const shimDir = join(root, 'vendor', 'openclaw', `.node-${target}`)
  const node = nodeRunner(shimDir)
  const started = Date.now()
  const install = spawnSync(
    node.bin,
    [
      npmCli, 'install', '--prefix', staging, `openclaw@${version}`,
      '--os', spec.os, '--cpu', spec.cpu,
      '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel', 'error',
      // Dependency install scripts run on THIS machine, so for another target
      // they probe the wrong binaries: koffi's finds no prebuilt for the host
      // and tries to compile from source. None of them produces anything the
      // runtime needs — every native module ships prebuilt (N-API) in the
      // target's optional package. OpenClaw's own postinstall does matter
      // (it clears the package's lifecycle-pending marker) and is pure JS, so
      // it runs explicitly below.
      '--ignore-scripts',
    ],
    { cwd: staging, stdio: 'inherit', env: { ...process.env, ...node.env } },
  )
  if (install.status !== 0) throw new Error(`vendor-openclaw: npm install for ${target} failed (exit ${install.status})`)
  const openclawDir = join(staging, 'node_modules', 'openclaw')
  const postinstall = spawnSync(node.bin, [join('scripts', 'postinstall-bundled-plugins.mjs')], {
    cwd: openclawDir,
    stdio: 'inherit',
    env: { ...process.env, ...node.env },
  })
  if (postinstall.status !== 0) throw new Error(`vendor-openclaw: openclaw postinstall for ${target} failed (exit ${postinstall.status})`)

  const installed = JSON.parse(readFileSync(join(staging, 'node_modules', 'openclaw', 'package.json'), 'utf8')).version
  if (installed !== version) throw new Error(`vendor-openclaw: installed openclaw ${installed}, expected ${version}`)

  if (spec.os === 'win32') await windowsBinShims(staging)
  const bin = join(staging, 'node_modules', '.bin', spec.os === 'win32' ? 'openclaw.cmd' : 'openclaw')
  if (!lstatSync(bin, { throwIfNoEntry: false })) throw new Error(`vendor-openclaw: ${bin} missing after install`)

  // COPYFILE_DISABLE: no AppleDouble `._*` files from macOS tar.
  const partial = `${out}.partial`
  // On a Windows build host PATH's `tar` is often Git's GNU tar, which reads
  // `D:\…` as a remote host ("Cannot connect to D: resolve failed" on GitHub's
  // runner). The OS's own bsdtar takes drive paths, as the app itself uses.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, [...spec.flag, partial, '-C', staging, 'node_modules', 'package.json', 'package-lock.json'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  renameSync(partial, out)
  rmSync(staging, { recursive: true, force: true })
  rmSync(shimDir, { recursive: true, force: true })
  console.log(
    `✓ vendor-openclaw: ${target} openclaw ${version} (${(statSync(out).size / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)}s)`,
  )
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const targets = process.argv.slice(2)
  if (targets.length === 0) {
    console.error(`usage: node scripts/vendor-openclaw.mjs <${Object.keys(TARGETS).join('|')}> …`)
    process.exit(1)
  }
  for (const target of targets) await vendorOpenclaw(target)
}
