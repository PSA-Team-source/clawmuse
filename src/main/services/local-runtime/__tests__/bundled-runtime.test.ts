import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron-log/main.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const home = mkdtempSync(join(tmpdir(), 'clawmuse-home-'))
const runtime = join(home, 'runtime')
vi.mock('../paths.js', async (orig) => {
  const real = await orig<typeof import('../paths.js')>()
  return { ...real, paths: { ...real.paths, home, runtime } }
})

const bin = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw'

/** A tarball shaped like scripts/vendor-openclaw.mjs output (xz on macOS, gzip on Windows), holding `version`. */
function runtimeTarball(dir: string, version: string, withBin = true, xz = false): void {
  const tree = mkdtempSync(join(tmpdir(), 'clawmuse-tree-'))
  mkdirSync(join(tree, 'node_modules', 'openclaw'), { recursive: true })
  mkdirSync(join(tree, 'node_modules', '.bin'))
  writeFileSync(join(tree, 'node_modules', 'openclaw', 'package.json'), JSON.stringify({ version }))
  if (withBin) writeFileSync(join(tree, 'node_modules', '.bin', bin), '')
  writeFileSync(join(tree, 'package.json'), '{}')
  writeFileSync(join(tree, 'package-lock.json'), '{}')
  const file = join(dir, `openclaw-runtime-${version}.${xz ? 'tar.xz' : 'tgz'}`)
  execFileSync('tar', [xz ? '-cJf' : '-czf', file, '-C', tree, 'node_modules', 'package.json', 'package-lock.json'])
}

const installed = () => JSON.parse(readFileSync(join(runtime, 'node_modules', 'openclaw', 'package.json'), 'utf8')).version

describe('bundled OpenClaw runtime (first launch without npm)', () => {
  it('picks the newest tarball the pin accepts, unpacks it atomically, and never downgrades', async () => {
    const { PINNED_OPENCLAW_VERSION } = await import('../install-cli.js')
    const { bundledRuntimeTarball, installBundledRuntime } = await import('../bundled-runtime.js')
    const vendor = mkdtempSync(join(tmpdir(), 'clawmuse-vendor-'))
    runtimeTarball(vendor, '2000.1.1') // older than the pin: never chosen
    runtimeTarball(vendor, PINNED_OPENCLAW_VERSION, true, process.platform !== 'win32')
    writeFileSync(join(vendor, 'npm-11.8.0.tgz'), '')
    expect(bundledRuntimeTarball(vendor)?.version).toBe(PINNED_OPENCLAW_VERSION)
    expect(bundledRuntimeTarball(join(vendor, 'missing'))).toBeNull()

    // The Node shim node-check.ts wrote into the same prefix survives.
    mkdirSync(join(runtime, 'node-bin'), { recursive: true })
    writeFileSync(join(runtime, 'node-bin', 'node'), 'shim')
    expect(await installBundledRuntime(vendor)).toBe(true)
    expect(installed()).toBe(PINNED_OPENCLAW_VERSION)
    expect(existsSync(join(runtime, 'node_modules', '.bin', bin))).toBe(true)
    expect(readFileSync(join(runtime, 'node-bin', 'node'), 'utf8')).toBe('shim')
    expect(existsSync(`${runtime}.partial`)).toBe(false)
    expect(existsSync(`${runtime}.replaced`)).toBe(false)

    // A newer managed runtime is left alone; the caller falls back to npm.
    writeFileSync(join(runtime, 'node_modules', 'openclaw', 'package.json'), JSON.stringify({ version: '9999.1.1' }))
    expect(await installBundledRuntime(vendor)).toBe(false)
    expect(installed()).toBe('9999.1.1')

    // A broken archive fails closed and keeps what was there.
    const broken = mkdtempSync(join(tmpdir(), 'clawmuse-vendor-'))
    runtimeTarball(broken, '9999.2.0', false)
    expect(await installBundledRuntime(broken)).toBe(false)
    expect(installed()).toBe('9999.1.1')
  }, 30_000)
})
