import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The very first write a fresh install performs.
 *
 * `applyProvider` calls `patchEnvFile` *before* the config write, and the
 * config write was the only thing that created `~/.openclaw-clawmuse`. So on a machine
 * that had never run ClawMuse — which is every machine, once — pressing "Save
 * and start" on the first screen threw ENOENT and the wizard just showed an
 * error. It only reproduces on a profile that does not exist yet, which is why
 * no developer machine ever saw it.
 */

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'clawmuse-envfile-'))
  vi.resetModules()
  vi.doMock('../../../main/services/local-runtime/paths', () => ({
    paths: { env: join(home, '.openclaw-clawmuse', '.env') },
  }))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  vi.doUnmock('../../../main/services/local-runtime/paths')
})

describe('patchEnvFile on a profile that does not exist yet', () => {
  it('creates the directory instead of throwing', async () => {
    const { patchEnvFile } = await import('../../../main/services/local-runtime/env-file')
    await expect(patchEnvFile({ OPENROUTER_API_KEY: 'sk-or-test' })).resolves.toBeUndefined()
    expect(existsSync(join(home, '.openclaw-clawmuse', '.env'))).toBe(true)
  })

  it('writes the key it was given', async () => {
    const { patchEnvFile } = await import('../../../main/services/local-runtime/env-file')
    await patchEnvFile({ OPENROUTER_API_KEY: 'sk-or-test' })
    expect(readFileSync(join(home, '.openclaw-clawmuse', '.env'), 'utf8')).toContain('sk-or-test')
  })

  it('keeps the profile directory private — it holds a credential', async () => {
    const { patchEnvFile } = await import('../../../main/services/local-runtime/env-file')
    await patchEnvFile({ OPENROUTER_API_KEY: 'sk-or-test' })
    expect(statSync(join(home, '.openclaw-clawmuse')).mode & 0o777).toBe(0o700)
    expect(statSync(join(home, '.openclaw-clawmuse', '.env')).mode & 0o777).toBe(0o600)
  })

  it('still merges into an existing file', async () => {
    const { patchEnvFile } = await import('../../../main/services/local-runtime/env-file')
    await patchEnvFile({ FIRST: 'one' })
    await patchEnvFile({ SECOND: 'two' })
    const written = readFileSync(join(home, '.openclaw-clawmuse', '.env'), 'utf8')
    expect(written).toContain('one')
    expect(written).toContain('two')
  })
})
