import { describe, expect, it } from 'vitest'
import { parseSkills } from '@/stores/skills.store'

/**
 * Both parsers exist because the gateway's payload shape varies by version.
 * They are the layer most likely to break silently on a backend upgrade, so
 * every accepted shape is pinned here.
 */

describe('parseSkills', () => {
  it('reads an array', () => {
    const result = parseSkills([{ skillKey: 'ads', name: 'Ads', description: 'd' }])
    expect(result).toHaveLength(1)
    expect(result[0]?.skillKey).toBe('ads')
  })

  it('reads a keyed map, using the key as the skill key', () => {
    const result = parseSkills({ 'create-store': { name: 'Create Store' } })
    expect(result[0]?.skillKey).toBe('create-store')
    expect(result[0]?.name).toBe('Create Store')
  })

  it('reads a map nested under .skills', () => {
    expect(parseSkills({ skills: { ads: { name: 'Ads' } } })[0]?.skillKey).toBe('ads')
  })

  it('inverts the `disabled` field into `enabled`', () => {
    expect(parseSkills([{ skillKey: 'a', disabled: true }])[0]?.enabled).toBe(false)
    expect(parseSkills([{ skillKey: 'b', disabled: false }])[0]?.enabled).toBe(true)
  })

  it('defaults enabled to true when neither field is present', () => {
    expect(parseSkills([{ skillKey: 'a' }])[0]?.enabled).toBe(true)
  })

  it('respects an explicit enabled:false', () => {
    expect(parseSkills([{ skillKey: 'a', enabled: false }])[0]?.enabled).toBe(false)
  })

  it('lifts missing.bins into missingBins', () => {
    expect(parseSkills([{ skillKey: 'a', missing: { bins: ['ffmpeg'] } }])[0]?.missingBins).toEqual(['ffmpeg'])
  })

  it('defaults the emoji', () => {
    expect(parseSkills([{ skillKey: 'a' }])[0]?.emoji).toBe('🧩')
  })

  it('sorts by name', () => {
    const result = parseSkills([{ skillKey: 'z', name: 'Zebra' }, { skillKey: 'a', name: 'Alpha' }])
    expect(result.map((s) => s.name)).toEqual(['Alpha', 'Zebra'])
  })

  it('drops entries with no key', () => {
    expect(parseSkills([{ description: 'orphan' }])).toHaveLength(0)
  })

  it('survives garbage input', () => {
    expect(parseSkills(null)).toEqual([])
  })
})
