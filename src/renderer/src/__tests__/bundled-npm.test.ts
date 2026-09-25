import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron-log/main.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const home = mkdtempSync(join(tmpdir(), 'clawmuse-home-'))
vi.mock('../../../main/services/local-runtime/paths.js', async (orig) => {
  const real = await orig<typeof import('../../../main/services/local-runtime/paths.js')>()
  return { ...real, paths: { ...real.paths, home } }
})

describe('bundled npm (first install on a Mac with no Node)', () => {
  it('finds the npm devDependency in dev', async () => {
    const { devNpmCli } = await import('../../../main/services/local-runtime/install-cli.js')
    const cli = devNpmCli()
    expect(cli).toMatch(/node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/)
    expect(existsSync(cli!)).toBe(true)
  })

  it('unpacks the shipped tarball once, into the profile, with its bundled deps', async () => {
    const resources = mkdtempSync(join(tmpdir(), 'clawmuse-resources-'))
    mkdirSync(join(resources, 'vendor'))
    // A real npm tarball: pack the pinned version the way scripts/vendor-npm.mjs does.
    execFileSync('npm', ['pack', 'npm@11.8.0', '--pack-destination', join(resources, 'vendor'), '--silent'])
    const proc = process as NodeJS.Process & { resourcesPath?: string }
    const before = proc.resourcesPath
    proc.resourcesPath = resources
    try {
      const { ensureBundledNpm } = await import('../../../main/services/local-runtime/install-cli.js')
      const cli = await ensureBundledNpm()
      expect(cli).toBe(join(home, 'tools', 'npm-11.8.0', 'bin', 'npm-cli.js'))
      expect(existsSync(join(home, 'tools', 'npm-11.8.0', 'node_modules', 'graceful-fs'))).toBe(true)
      expect(existsSync(join(home, 'tools', 'npm-11.8.0.partial'))).toBe(false)
      // Second launch reuses it.
      expect(await ensureBundledNpm()).toBe(cli)
    } finally {
      proc.resourcesPath = before
    }
  }, 60_000)
})
