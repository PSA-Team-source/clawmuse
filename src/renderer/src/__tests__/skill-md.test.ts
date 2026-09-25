import { describe, expect, it } from 'vitest'
import {
  SKILL_TEMPLATES,
  syncFrontmatterName,
  validateSkillMd,
} from '@/routes/studio/skill-md'

/**
 * These rules are a mirror of the server's `validateSkillMd`. If they drift,
 * the editor accepts documents the API rejects — which is worse than no
 * validation at all, because the failure then arrives as a bare error string
 * after a round trip.
 */
describe('validateSkillMd', () => {
  const valid = `---
name: my-skill
description: Does a thing
---

Body.
`

  it('accepts a document with name and description', () => {
    const result = validateSkillMd(valid, 'my-skill')
    expect(result.ok).toBe(true)
    expect(result.name).toBe('my-skill')
  })

  it('rejects an empty document', () => {
    expect(validateSkillMd('   ').ok).toBe(false)
  })

  it('requires frontmatter', () => {
    const result = validateSkillMd('# Just a heading')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('frontmatter')
  })

  it('requires a name', () => {
    const result = validateSkillMd('---\ndescription: x\n---\n')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('name')
  })

  it('requires a description', () => {
    const result = validateSkillMd('---\nname: my-skill\n---\n', 'my-skill')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('description')
  })

  it('requires the name to equal the slug', () => {
    const result = validateSkillMd(valid, 'other-slug')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('other-slug')
  })

  it('tolerates a quoted name', () => {
    const result = validateSkillMd('---\nname: "my-skill"\ndescription: x\n---\n', 'my-skill')
    expect(result.ok).toBe(true)
  })

  it('skips the slug comparison when no slug is known yet', () => {
    expect(validateSkillMd(valid).ok).toBe(true)
  })
})

describe('syncFrontmatterName', () => {
  it('rewrites the name to match the slug', () => {
    const output = syncFrontmatterName('---\nname: old\ndescription: x\n---\nbody', 'new')
    expect(validateSkillMd(output, 'new').ok).toBe(true)
  })

  it('leaves a document without frontmatter untouched', () => {
    expect(syncFrontmatterName('no frontmatter', 'slug')).toBe('no frontmatter')
  })

  it('does not invent a name line that was never there', () => {
    const input = '---\ndescription: x\n---\nbody'
    expect(syncFrontmatterName(input, 'slug')).toBe(input)
  })

  it('leaves the body alone', () => {
    const output = syncFrontmatterName('---\nname: old\ndescription: x\n---\nname: not-frontmatter', 'new')
    expect(output).toContain('name: not-frontmatter')
  })
})

describe('SKILL_TEMPLATES', () => {
  it('every template produces a document the server would accept', () => {
    for (const template of SKILL_TEMPLATES) {
      const result = validateSkillMd(template.build('my-skill'), 'my-skill')
      expect(result.ok, `${template.id} failed: ${result.error}`).toBe(true)
    }
  })
})
