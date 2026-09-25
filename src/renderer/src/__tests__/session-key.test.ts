import { describe, expect, it } from 'vitest'
import {
  MAIN_SESSION_KEY,
  agentIdFromSessionKey,
  botMainSessionKey,
  canonicalSessionKey,
  channelSessionKey,
  eventSessionKey,
  groupIdFromSessionKey,
  groupSessionKey,
  isSkillSessionKey,
  newMainConvKey,
  newSkillConvKey,
  normalizeSessionKey,
  parseSessionKey,
  sessionKeyFor,
  skillBaseKey,
  skillIdFromSessionKey,
} from '@/services/session-key'

/**
 * These conventions are shared with the mobile client and the web client. If
 * desktop derives a different key, the same conversation shows up twice.
 */
describe('normalizeSessionKey', () => {
  it('strips the container prefix', () => {
    expect(normalizeSessionKey('agent:main:webchat:main')).toBe('webchat:main')
  })

  it('leaves an already-normalised key alone', () => {
    expect(normalizeSessionKey('webchat:main')).toBe('webchat:main')
  })

  it('only strips the prefix at the start', () => {
    expect(normalizeSessionKey('webchat:agent:main:x')).toBe('webchat:agent:main:x')
  })

  it('strips any bot, not only main', () => {
    // The single-agent version hard-coded `agent:main:`, so every other bot's
    // key came through with its prefix intact and matched nothing.
    expect(normalizeSessionKey('agent:talent-scout:webchat:main')).toBe('webchat:main')
  })
})

/**
 * Many bots run in one gateway, and each has a `webchat:main`. The conversation
 * part alone is therefore NOT an identity — these are the rules that keep two
 * bots' threads apart.
 */
describe('agent scoping', () => {
  it('parses the bot out of a scoped key', () => {
    expect(parseSessionKey('agent:inbox:webchat:main')).toEqual({
      agentId: 'inbox',
      local: 'webchat:main',
    })
    expect(agentIdFromSessionKey('agent:inbox:webchat:main')).toBe('inbox')
  })

  it('reports no bot for an unscoped key', () => {
    expect(parseSessionKey('webchat:main')).toEqual({ agentId: null, local: 'webchat:main' })
    expect(agentIdFromSessionKey('webchat:main')).toBeNull()
  })

  it('leaves the default agent unprefixed', () => {
    // What this app has always sent. Prefixing it would orphan every stored id.
    expect(sessionKeyFor('main', MAIN_SESSION_KEY)).toBe('webchat:main')
    expect(sessionKeyFor(null, MAIN_SESSION_KEY)).toBe('webchat:main')
    expect(canonicalSessionKey('agent:main:webchat:main')).toBe('webchat:main')
  })

  it('keeps every other bot prefixed, round-trip', () => {
    const key = botMainSessionKey('talent-scout')
    expect(key).toBe('agent:talent-scout:webchat:main')
    // The id the app stores and the key it sends back must be the same string:
    // `chat.send` validates `agentId` against the prefix and rejects a mismatch.
    expect(canonicalSessionKey(key)).toBe(key)
    expect(agentIdFromSessionKey(key)).toBe('talent-scout')
  })

  it('gives two bots distinct ids for the same conversation', () => {
    expect(botMainSessionKey('inbox')).not.toBe(botMainSessionKey('expenses'))
  })

  it('still finds the skill under a bot scope', () => {
    expect(skillIdFromSessionKey('agent:ads:webchat:skill:facebook-ads')).toBe('facebook-ads')
    expect(isSkillSessionKey('agent:ads:webchat:skill:ads:conv:1', 'ads')).toBe(true)
  })
})

describe('eventSessionKey', () => {
  it('takes the bot from the prefix when the frame carries one', () => {
    expect(eventSessionKey('agent:inbox:webchat:main')).toBe('agent:inbox:webchat:main')
  })

  it('takes the bot from the sibling field when the key is bare', () => {
    // Not every gateway frame prefixes the key; some report the bot alongside.
    expect(eventSessionKey('webchat:main', 'inbox')).toBe('agent:inbox:webchat:main')
  })

  it('prefers the prefix when both are present', () => {
    expect(eventSessionKey('agent:inbox:webchat:main', 'inbox')).toBe('agent:inbox:webchat:main')
  })

  it('leaves default-agent frames exactly as they were', () => {
    expect(eventSessionKey('webchat:main', 'main')).toBe('webchat:main')
    expect(eventSessionKey('webchat:main')).toBe('webchat:main')
  })
})

describe('group threads', () => {
  it('gives each participating bot its own session in the group', () => {
    expect(groupSessionKey('inbox', 'g1')).toBe('agent:inbox:webchat:group:g1')
    expect(groupSessionKey('scout', 'g1')).toBe('agent:scout:webchat:group:g1')
  })

  it('recovers the group from any participant key', () => {
    expect(groupIdFromSessionKey('agent:scout:webchat:group:g1')).toBe('g1')
    expect(groupIdFromSessionKey('agent:scout:webchat:main')).toBeNull()
  })
})

describe('skill keys', () => {
  it('builds the base key', () => {
    expect(skillBaseKey('create-store')).toBe('webchat:skill:create-store')
  })

  it('builds a distinct conversation key under the skill', () => {
    const key = newSkillConvKey('create-store')
    expect(key.startsWith('webchat:skill:create-store:conv:')).toBe(true)
  })

  it('matches the base key and its conversations', () => {
    expect(isSkillSessionKey('webchat:skill:ads', 'ads')).toBe(true)
    expect(isSkillSessionKey('webchat:skill:ads:conv:1', 'ads')).toBe(true)
  })

  it('does not match a different skill with a shared prefix', () => {
    // "ads" must not swallow "ads-manager" — a plain startsWith would.
    expect(isSkillSessionKey('webchat:skill:ads-manager', 'ads')).toBe(false)
  })

  it('does not match an unrelated key', () => {
    expect(isSkillSessionKey('webchat:main', 'ads')).toBe(false)
  })
})

describe('other key builders', () => {
  it('exposes the main session key', () => {
    expect(MAIN_SESSION_KEY).toBe('webchat:main')
  })

  it('scopes a new main conversation under the main key', () => {
    expect(newMainConvKey().startsWith('webchat:main:conv:')).toBe(true)
  })

  it('builds a channel key', () => {
    expect(channelSessionKey('telegram')).toBe('webchat:channel:telegram')
  })
})
