import { describe, expect, it } from 'vitest'
import { isSkillSessionKey, skillIdFromSessionKey } from '@/services/session-key'

/**
 * A thread's agent is encoded in its session key, and the per-agent Tasks and
 * Settings tabs key off that. Getting this wrong shows one agent's SOUL.md
 * while you talk to another, so the parsing is pinned here.
 */
describe('skillIdFromSessionKey', () => {
  it('reads the agent from a base thread', () => {
    expect(skillIdFromSessionKey('webchat:skill:create-store')).toBe('create-store')
  })

  it('reads the same agent from a follow-up conversation', () => {
    expect(skillIdFromSessionKey('webchat:skill:create-store:conv:abc123')).toBe('create-store')
  })

  it('strips the container prefix first', () => {
    expect(skillIdFromSessionKey('agent:main:webchat:skill:facebook-ads')).toBe('facebook-ads')
  })

  it('returns null for threads that have no agent', () => {
    expect(skillIdFromSessionKey('webchat:main')).toBeNull()
    expect(skillIdFromSessionKey('webchat:main:conv:xyz')).toBeNull()
    expect(skillIdFromSessionKey('webchat:channel:telegram')).toBeNull()
  })
})

describe('isSkillSessionKey', () => {
  it('matches the base thread and its conversations, not a similarly named agent', () => {
    expect(isSkillSessionKey('webchat:skill:ads', 'ads')).toBe(true)
    expect(isSkillSessionKey('webchat:skill:ads:conv:1', 'ads')).toBe(true)
    expect(isSkillSessionKey('webchat:skill:ads-manager', 'ads')).toBe(false)
  })
})
