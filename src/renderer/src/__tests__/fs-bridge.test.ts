import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { list, read, registerRoot, write, __testing } from '../../../main/services/fs-bridge'

/**
 * The traversal guard, tested against the attacks it exists to stop.
 *
 * This is the one place in the app where a bug hands out the user's home
 * directory, so the tests are written as attempts rather than as happy paths.
 */

let root: string
let outside: string

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'clawmuse-fs-'))
  root = join(base, 'workspace')
  outside = join(base, 'secrets')
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  mkdirSync(join(root, 'nested'), { recursive: true })

  writeFileSync(join(root, 'hello.txt'), 'hello world')
  writeFileSync(join(root, 'nested', 'deep.txt'), 'deep')
  writeFileSync(join(outside, 'id_rsa'), 'PRIVATE KEY')
  // A symlink that stays inside the root but points out of it — `resolve()`
  // alone cannot see through this, only `realpath` can.
  symlinkSync(outside, join(root, 'escape-link'))

  await registerRoot('test', 'Test', root)
})

afterAll(() => {
  __testing.roots.clear()
})

describe('path traversal', () => {
  it('rejects ../ climbing out of the root', async () => {
    await expect(read('test', '../secrets/id_rsa')).rejects.toThrow(/outside the workspace/)
  })

  it('rejects deeply nested ../ sequences', async () => {
    await expect(read('test', 'nested/../../secrets/id_rsa')).rejects.toThrow(/outside the workspace/)
  })

  it('rejects an absolute path pretending to be relative', async () => {
    await expect(read('test', '/etc/passwd')).rejects.toThrow(/outside the workspace/)
  })

  it('rejects a symlink that points outside the root', async () => {
    // The link itself lives inside the workspace, so a prefix check on the
    // unresolved path would happily allow this.
    await expect(read('test', 'escape-link/id_rsa')).rejects.toThrow(/outside the workspace/)
  })

  it('rejects writes outside the root', async () => {
    await expect(write('test', '../secrets/planted.txt', 'x')).rejects.toThrow(
      /outside the workspace/,
    )
  })

  it('rejects an unknown root id', async () => {
    await expect(list('not-a-root', '')).rejects.toThrow(/Unknown root/)
  })
})

describe('normal use still works', () => {
  it('lists directories first, then files by name', async () => {
    const entries = await list('test', '')
    const names = entries.map((entry) => entry.name)
    expect(names[0]).toBe('nested')
    expect(names).toContain('hello.txt')
  })

  it('reads a file inside the root', async () => {
    const result = await read('test', 'hello.txt')
    expect(result.content).toBe('hello world')
  })

  it('reads through a nested path', async () => {
    const result = await read('test', 'nested/deep.txt')
    expect(result.content).toBe('deep')
  })

  it('writes and reads back', async () => {
    await write('test', 'nested/new.txt', 'written')
    expect((await read('test', 'nested/new.txt')).content).toBe('written')
  })

  it('flags binary content instead of returning garbage', async () => {
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]))
    const result = await read('test', 'blob.bin')
    expect(result.binary).toBe(true)
    expect(result.content).toBe('')
  })

  it('returns supported images as safe inline previews', async () => {
    writeFileSync(join(root, 'pixel.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
    const result = await read('test', 'pixel.png')
    expect(result.binary).toBe(true)
    expect(result.mimeType).toBe('image/png')
    expect(result.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(result.content).toBe('')
  })
})
