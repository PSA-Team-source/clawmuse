import { describe, expect, it } from 'vitest'
import {
  SEED_ROSTER,
  agentsMarkdown,
  botIdFromName,
  guidelinesSection,
  permissionsOf,
  uniqueBotId,
} from '../../../main/services/local-runtime/bots'

/**
 * The id is not cosmetic: sessions are keyed `agent:<id>:<conversation>`, so an
 * id that changes — or that OpenClaw silently rewrites on the way in — orphans a
 * bot's entire transcript.
 */
describe('botIdFromName', () => {
  it('slugs a display name', () => {
    expect(botIdFromName('Inbox Manager')).toBe('inbox-manager')
    expect(botIdFromName('Talent Scout')).toBe('talent-scout')
  })

  it('produces an id OpenClaw accepts as-is', () => {
    // `normalizeAgentId` (openclaw src/routing/session-key.ts) accepts
    // /^[a-z0-9][a-z0-9_-]{0,63}$/i and coerces anything else.
    const pattern = /^[a-z0-9][a-z0-9_-]{0,63}$/
    for (const name of ['Inbox Manager', 'CFO’s Bot', '  spaced  out  ', 'Ads/Store', '🦞 Lobster']) {
      expect(botIdFromName(name)).toMatch(pattern)
    }
  })

  it('never returns an empty id', () => {
    expect(botIdFromName('🦞')).toBe('bot')
    expect(botIdFromName('   ')).toBe('bot')
  })
})

describe('uniqueBotId', () => {
  it('keeps a free id', () => {
    expect(uniqueBotId('scout', ['inbox'])).toBe('scout')
  })

  it('suffixes a taken one', () => {
    expect(uniqueBotId('scout', ['scout'])).toBe('scout-2')
    expect(uniqueBotId('scout', ['scout', 'scout-2'])).toBe('scout-3')
  })

  it('treats `main` as taken — OpenClaw reserves it', () => {
    expect(uniqueBotId('main', [])).toBe('main-2')
  })
})

describe('agentsMarkdown', () => {
  const draft = { name: 'Inbox Manager', job: 'keeps the inbox triaged', guidelines: 'Never send.' }

  it('carries the name, job and the user’s own words', () => {
    const markdown = agentsMarkdown(draft)
    expect(markdown).toContain('# Inbox Manager')
    expect(markdown).toContain('keeps the inbox triaged')
    expect(markdown).toContain('Never send.')
  })

  it('always names the shared computer and the other bots', () => {
    const markdown = agentsMarkdown(draft)
    expect(markdown).toContain('sessions_send')
    expect(markdown).toMatch(/shared computer/i)
  })

  it('falls back rather than writing an empty section', () => {
    const markdown = agentsMarkdown({ name: 'X', job: '', guidelines: '' })
    expect(markdown).toContain('General assistant.')
    expect(markdown).toMatch(/Ask before anything irreversible/)
  })
})

/**
 * Duplicating copies the brief, not the generated scaffolding — otherwise each
 * duplication adds another "shared computer" section to the file.
 */
describe('guidelinesSection', () => {
  it('round-trips what was written', () => {
    const guidelines = 'Triage first, write second.\n\nSend nothing without asking.'
    const markdown = agentsMarkdown({ name: 'A', job: 'b', guidelines })
    expect(guidelinesSection(markdown)).toBe(guidelines)
  })

  it('returns nothing for a file with no such section', () => {
    expect(guidelinesSection('# Just a heading\n\nsome text')).toBe('')
  })
})

describe('the seeded roster', () => {
  it('opens with a team, not one bot', () => {
    expect(SEED_ROSTER.length).toBeGreaterThanOrEqual(4)
  })

  it('gives every seeded bot a usable brief, not a placeholder', () => {
    for (const bot of SEED_ROSTER) {
      expect(bot.name.length).toBeGreaterThan(0)
      expect(bot.job.length).toBeGreaterThan(10)
      expect(bot.guidelines.length).toBeGreaterThan(120)
    }
  })

  it('produces distinct ids', () => {
    const ids = SEED_ROSTER.map((bot) => botIdFromName(bot.name))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/**
 * Guidelines are prose and a model can talk itself past them. The deny-list is
 * the half the gateway enforces before the tool is ever offered.
 */
describe('permissionsOf', () => {
  it('reads a full deny-list as read-only', () => {
    expect(permissionsOf(['write', 'edit', 'apply_patch', 'exec', 'process'])).toBe('read-only')
  })

  it('treats a partial deny-list as full access', () => {
    // Half a restriction is not a restriction: a bot that can still `exec` is
    // not read-only, and calling it that in the UI would be the dangerous lie.
    expect(permissionsOf(['write'])).toBe('full')
  })

  it('defaults to full when nothing is denied', () => {
    expect(permissionsOf(undefined)).toBe('full')
    expect(permissionsOf([])).toBe('full')
    expect(permissionsOf('nonsense')).toBe('full')
  })
})
