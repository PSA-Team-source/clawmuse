import { describe, expect, it } from 'vitest'
import type { BotSummary } from '@shared/ipc'
import { addressedBots, mentionQuery, stripMentions } from '@/routes/chat/mentions'

function bot(id: string, name: string): BotSummary {
  return {
    id,
    name,
    job: '',
    emoji: null,
    avatar: null,
    isDefault: false,
    workspace: null,
    model: null,
    permissions: 'full',
  }
}

const ROSTER = [
  bot('inbox-manager', 'Inbox Manager'),
  bot('account-manager', 'Account Manager'),
  bot('account', 'Account'),
  bot('scout', 'Talent Scout'),
]

/**
 * Bot names have spaces, so `@\w+` is wrong twice over: it addresses "Inbox"
 * and leaves "Manager" sitting in the message body.
 */
describe('addressedBots', () => {
  it('matches a multi-word name', () => {
    expect(addressedBots('@Inbox Manager can you triage this', ROSTER).map((b) => b.id)).toEqual([
      'inbox-manager',
    ])
  })

  it('prefers the longest name when one is a prefix of another', () => {
    expect(addressedBots('@Account Manager please look', ROSTER).map((b) => b.id)).toEqual([
      'account-manager',
    ])
  })

  it('still matches the short name on its own', () => {
    expect(addressedBots('@Account please look', ROSTER).map((b) => b.id)).toEqual(['account'])
  })

  it('addresses several bots at once, in roster order', () => {
    const ids = addressedBots('@Talent Scout and @Inbox Manager — sync up', ROSTER).map((b) => b.id)
    expect(ids).toEqual(['inbox-manager', 'scout'])
  })

  it('is case-insensitive', () => {
    expect(addressedBots('@talent scout hi', ROSTER)).toHaveLength(1)
  })

  it('returns nothing when the room is addressed', () => {
    // Empty means "nobody in particular". Falling back to everyone here would
    // take the decision away from the caller, which is where it belongs.
    expect(addressedBots('who can take this?', ROSTER)).toEqual([])
  })

  it('does not match a name that only appears without an @', () => {
    expect(addressedBots('ask Talent Scout later', ROSTER)).toEqual([])
  })
})

describe('stripMentions', () => {
  it('removes the addressing from the body', () => {
    expect(stripMentions('@Inbox Manager triage this', ROSTER)).toBe('triage this')
  })

  it('collapses the gap it leaves behind', () => {
    expect(stripMentions('please @Talent Scout look', ROSTER)).toBe('please look')
  })

  it('leaves an unaddressed message alone', () => {
    expect(stripMentions('who can take this?', ROSTER)).toBe('who can take this?')
  })
})

describe('mentionQuery', () => {
  it('reports the fragment being typed', () => {
    expect(mentionQuery('hey @inb')).toBe('inb')
    expect(mentionQuery('hey @')).toBe('')
  })

  it('keeps matching across a space, because names have spaces', () => {
    expect(mentionQuery('@Inbox Man')).toBe('Inbox Man')
  })

  it('reports nothing when the caret is not in a mention', () => {
    expect(mentionQuery('hey there')).toBeNull()
  })
})
