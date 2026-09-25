import { describe, expect, it } from 'vitest'
import { groupIdeas, ideasRequest, isUserChat, parseIdeas } from '@shared/assistant'

describe('ideas from the agent', () => {
  it('grounds the request in open goals and real asks only', () => {
    const text = ideasRequest([{ id: 'g', title: 'Build PlatformDTC into a $1B company', completed: false, createdAt: '' }, { id: 'd', title: 'Done goal', completed: true, createdAt: '' }], ['Audit my Stripe rate'])
    expect(text).toContain('- Build PlatformDTC into a $1B company')
    expect(text).not.toContain('Done goal')
    expect(text).toContain('- Audit my Stripe rate')
    expect(isUserChat('webchat:main:conv:x')).toBe(true)
    expect(isUserChat('agent:ops:webchat:main')).toBe(true)
    expect(isUserChat('cron:2435e1dc')).toBe(false)
  })
  it('parses a fenced JSON reply and drops invalid items', () => {
    const reply = 'Here you go:\n```json\n[{"emoji":"💳","title":"I can audit your Stripe rate","description":"Research volume pricing.","category":"Finance"},{"title":""},{"nope":1}]\n```'
    expect(parseIdeas(reply, 'b')).toEqual([{ id: 'b-0', emoji: '💳', title: 'I can audit your Stripe rate', description: 'Research volume pricing.', category: 'Finance' }])
    expect(parseIdeas('no json here', 'b')).toEqual([])
  })
  it('features the first four, then groups by category', () => {
    const ideas = Array.from({ length: 6 }, (_, i) => ({ id: String(i), title: `t${i}`, description: '', category: i === 5 ? 'Health' : 'Finance' }))
    expect(groupIdeas(ideas).map((g) => [g.heading, g.ideas.length])).toEqual([[null, 4], ['Finance', 1], ['Health', 1]])
  })
})
