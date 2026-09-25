import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalSkill,
  listLocalSkills,
  removeLocalSkill,
  saveLocalSkill,
} from '@/services/local-skills'

/**
 * Local skill authoring writes `workspace/skills/<slug>/SKILL.md` and nothing
 * else. Two properties are load-bearing:
 *
 *  - it must never reach the network — local mode has no account, and a stray
 *    request that leaves this machine breaks the app's central promise;
 *  - every path stays relative, so the main process's root allowlist (which
 *    realpaths and re-checks) remains the only thing resolving paths.
 */

const fs = {
  list: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  mkdir: vi.fn(),
  delete: vi.fn(),
}

beforeEach(() => {
  Object.values(fs).forEach((mock) => mock.mockReset())
  Object.defineProperty(window, 'clawmuse', { value: { fs }, writable: true })
})

const VALID = `---
name: research
description: Finds things
---

Body.
`

describe('listLocalSkills', () => {
  it('reads each skill directory and pulls the description from frontmatter', async () => {
    fs.list.mockResolvedValue([
      { name: 'research', path: 'skills/research', isDirectory: true },
      { name: 'notes.txt', path: 'skills/notes.txt', isDirectory: false },
    ])
    fs.read.mockResolvedValue({ content: VALID, path: '', size: VALID.length })

    const skills = await listLocalSkills()

    expect(skills).toHaveLength(1)
    expect(skills[0]?.slug).toBe('research')
    expect(skills[0]?.description).toBe('Finds things')
    expect(fs.read).toHaveBeenCalledWith('workspace', 'skills/research/SKILL.md')
  })

  it('returns empty when the skills directory does not exist yet', async () => {
    fs.list.mockRejectedValue(new Error('ENOENT'))
    expect(await listLocalSkills()).toEqual([])
  })

  it('skips a directory that holds no SKILL.md', async () => {
    fs.list.mockResolvedValue([{ name: 'empty', path: 'skills/empty', isDirectory: true }])
    fs.read.mockRejectedValue(new Error('ENOENT'))
    expect(await listLocalSkills()).toEqual([])
  })

  it('skips a SKILL.md too large or binary to read', async () => {
    fs.list.mockResolvedValue([{ name: 'huge', path: 'skills/huge', isDirectory: true }])
    fs.read.mockResolvedValue({ content: '', path: '', size: 0, tooLarge: true })
    expect(await listLocalSkills()).toEqual([])
  })
})

describe('saveLocalSkill', () => {
  it('creates the directory then writes the file, both by relative path', async () => {
    await saveLocalSkill('research', VALID)

    expect(fs.mkdir).toHaveBeenCalledWith('workspace', 'skills/research')
    expect(fs.write).toHaveBeenCalledWith('workspace', 'skills/research/SKILL.md', VALID)
  })

  it('refuses a document the gateway would fail to load', async () => {
    await expect(saveLocalSkill('research', '# no frontmatter')).rejects.toThrow()
    expect(fs.write).not.toHaveBeenCalled()
  })

  it('refuses a frontmatter name that disagrees with the directory', async () => {
    await expect(saveLocalSkill('other', VALID)).rejects.toThrow(/other/)
    expect(fs.write).not.toHaveBeenCalled()
  })
})

describe('getLocalSkill', () => {
  it('returns null rather than throwing when the skill is absent', async () => {
    fs.read.mockRejectedValue(new Error('ENOENT'))
    expect(await getLocalSkill('missing')).toBeNull()
  })
})

describe('removeLocalSkill', () => {
  it('deletes the whole skill directory', async () => {
    await removeLocalSkill('research')
    expect(fs.delete).toHaveBeenCalledWith('workspace', 'skills/research')
  })
})
