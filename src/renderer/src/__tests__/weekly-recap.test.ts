import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_ASSISTANT_SETTINGS, type FeedUnit, type Goal } from '@shared/assistant'
import { allowedNumbers, computeWeekFacts, hasActivity, nextRecapAt, parseRecap, recapDue, recapSlot, recapStats, weekLabel, weekOf, type WeekFactsInput } from '@shared/recap'
import { parseShareCardInput } from '@shared/share-card'
import { shareCardHtml } from '../../../main/services/share-card-html'
import { withCompleted } from '@/lib/goals'

// Weeks are wall-clock weeks, so the tests pin a zone with a DST change.
const zone = process.env.TZ
process.env.TZ = 'America/New_York'
afterAll(() => { process.env.TZ = zone })

/** Local time in the pinned zone; month is 1-based. */
const local = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute)
const iso = (month: number, day: number, hour = 12) => local(month, day, hour).toISOString()

const goal = (patch: Partial<Goal>): Goal => ({ id: Math.random().toString(36), title: 'Ship it', completed: false, createdAt: iso(9, 1), ...patch })
const unit = (at: string, n = 0): FeedUnit => ({ id: `feed-${at}-${n}`, title: `Story ${n}`, body: 'b', at })

function input(patch: Partial<WeekFactsInput> = {}): WeekFactsInput {
  const now = local(9, 27, 18) // Sunday evening
  return { week: weekOf(now), now, goals: [], feed: [], feedAtCap: false, checkIns: [], userMessages: [], ...patch }
}

describe('weekly recap: weeks', () => {
  it('runs Monday 00:00 to the next Monday 00:00, local', () => {
    const { start, end } = weekOf(local(9, 27, 23, 59)) // Sunday
    expect([start.getDay(), start.getDate(), start.getHours()]).toEqual([1, 21, 0])
    expect([end.getDay(), end.getDate(), end.getHours()]).toEqual([1, 28, 0])
    expect(weekOf(local(9, 21, 0, 0)).start.getTime()).toBe(start.getTime()) // Monday midnight belongs to its own week
    expect(weekOf(local(9, 20, 23, 59)).end.getTime()).toBe(start.getTime()) // Sunday before belongs to the previous one
  })

  it('stays Monday to Monday across a daylight-saving change', () => {
    // US clocks fall back on Sunday Nov 1 2026: that week is 169 hours long.
    const { start, end } = weekOf(local(11, 1, 20))
    expect([start.getDate(), start.getHours(), end.getDate(), end.getHours()]).toEqual([26, 0, 2, 0])
    expect((end.getTime() - start.getTime()) / 3600_000).toBe(169)
    // Spring forward (Mar 8 2026): 167 hours, still midnight to midnight.
    const spring = weekOf(local(3, 8, 20))
    expect([spring.start.getDate(), spring.end.getDate(), spring.end.getHours()]).toEqual([2, 9, 0])
    expect((spring.end.getTime() - spring.start.getTime()) / 3600_000).toBe(167)
    // Late Sunday in the long week still counts.
    const facts = computeWeekFacts(input({ week: weekOf(local(11, 1, 23)), now: local(11, 1, 23, 30), goals: [goal({ createdAt: local(11, 1, 23, 10).toISOString() })] }))
    expect(facts.goalsAdded).toBe(1)
  })

  it('labels the week', () => {
    const facts = computeWeekFacts(input())
    expect(weekLabel(facts, 'en-US')).toBe('Sep 21 – 27')
    expect(weekLabel(computeWeekFacts(input({ week: weekOf(local(9, 30)) })), 'en-US')).toBe('Sep 28 – Oct 4')
  })
})

describe('weekly recap: facts', () => {
  it('counts only what happened inside the week and before now', () => {
    const facts = computeWeekFacts(input({
      now: local(9, 24, 12), // Thursday: the week so far
      goals: [goal({ createdAt: iso(9, 22) }), goal({ createdAt: iso(9, 20) }), goal({ createdAt: iso(9, 25) }), goal({ createdAt: '' })],
      feed: [unit(iso(9, 22, 7), 0), unit(iso(9, 22, 7), 1), unit(iso(9, 23, 7), 0), unit(iso(9, 19, 7), 0)],
      checkIns: [{ at: iso(9, 23, 10), message: 'm' }, { at: iso(9, 18, 10), message: 'm' }],
      userMessages: [{ chat: 'agent:main:webchat:main', at: local(9, 23, 11).getTime() }, { chat: 'webchat:main:conv:a', at: local(9, 22, 9).getTime() }, { chat: 'webchat:main:conv:a', at: local(9, 19, 9).getTime() }],
    }))
    expect(facts).toMatchObject({ goalsAdded: 1, feedEditions: 2, feedStories: 3, checkIns: 1, checkInsAnswered: 1, messagesSent: 2, chats: 2 })
    // No goal carries a completion date yet: the count is unknown, not zero.
    expect(facts.goalsCompleted).toBeUndefined()
  })

  it('counts completed goals by when they were completed', () => {
    const facts = computeWeekFacts(input({ goals: [
      goal({ completed: true, completedAt: iso(9, 24) }),
      goal({ completed: true, completedAt: iso(9, 14) }),
      goal({ completed: true }), // completed before dates were recorded
      goal({ completed: false, completedAt: iso(9, 24) }), // reopened
    ] }))
    expect(facts.goalsCompleted).toBe(1)
  })

  it('leaves out counts it could not make completely', () => {
    const full = Array.from({ length: 60 }, (_, n) => unit(iso(9, 22 + (n % 5), 7), n))
    const facts = computeWeekFacts(input({ feed: full, feedAtCap: true, userMessages: null }))
    expect(facts.feedEditions).toBeUndefined()
    expect(facts.feedStories).toBeUndefined()
    expect(facts.messagesSent).toBeUndefined()
    expect(facts.checkInsAnswered).toBeUndefined()
    // At the cap but still holding something older than the week: complete.
    expect(computeWeekFacts(input({ feed: [...full.slice(1), unit(iso(9, 10))], feedAtCap: true })).feedEditions).toBe(5)
  })

  it('answers a check-in only with a Main chat message before the next one, within a day', () => {
    const facts = computeWeekFacts(input({
      checkIns: [{ at: iso(9, 22, 10), message: 'a' }, { at: iso(9, 22, 15), message: 'b' }, { at: iso(9, 24, 10), message: 'c' }],
      userMessages: [
        { chat: 'webchat:main:conv:x', at: local(9, 22, 11).getTime() }, // another chat: not an answer
        { chat: 'agent:main:webchat:main', at: local(9, 22, 16).getTime() }, // answers b only
        { chat: 'agent:main:webchat:main', at: local(9, 25, 11).getTime() }, // 25h after c: too late
      ],
    }))
    expect(facts.checkIns).toBe(3)
    expect(facts.checkInsAnswered).toBe(1)
  })

  it('makes no recap and no card for an empty week', () => {
    const facts = computeWeekFacts(input({ goals: [goal({ createdAt: iso(9, 1) })], feed: [unit(iso(9, 2))] }))
    expect(hasActivity(facts)).toBe(false)
    expect(recapStats(facts)).toEqual([])
  })

  it('puts only counted, non-zero numbers on the card', () => {
    const facts = computeWeekFacts(input({ goals: [goal({ createdAt: iso(9, 22) })], feed: [unit(iso(9, 22)), unit(iso(9, 22), 1)], userMessages: null }))
    expect(recapStats(facts)).toEqual([{ label: 'goal set', value: 1 }, { label: 'Feed stories', value: 2 }])
  })
})

describe('weekly recap: parsing', () => {
  const facts = computeWeekFacts(input({ goals: [goal({ title: 'Grow my store to $50k in monthly sales', createdAt: iso(9, 22) })], userMessages: [{ chat: 'webchat:main', at: local(9, 22).getTime() }, { chat: 'webchat:main', at: local(9, 23).getTime() }] }))
  const allowed = allowedNumbers(facts, [goal({ title: 'Grow my store to $50k in monthly sales' })])

  it('reads the recap and focus, fenced or not', () => {
    const reply = '```json\n{"recap": "You set 1 new goal and sent me 2 messages this week.", "focus": "Pick one product to push toward $50k."}\n```'
    expect(parseRecap(reply, allowed)).toEqual({ text: 'You set 1 new goal and sent me 2 messages this week.', focus: 'Pick one product to push toward $50k.' })
  })

  it('rejects a recap that states a number the app never counted', () => {
    expect(parseRecap('{"recap": "A 7-day streak! You sent me 2 messages.", "focus": "Keep going with the store."}', allowed)).toBeNull()
    expect(parseRecap('{"recap": "You sent me 2 messages, up 40% on last week.", "focus": "Keep going with the store."}', allowed)).toBeNull()
  })

  it('rejects unreadable or empty replies', () => {
    for (const bad of ['', 'no json here', '{"recap": "short", "focus": "Do one thing well."}', '{"recap": "A long enough recap sentence here.", "focus": 3}', '{broken']) expect(parseRecap(bad, allowed)).toBeNull()
  })
})

describe('weekly recap: schedule', () => {
  const settings = { ...DEFAULT_ASSISTANT_SETTINGS }

  it('is due on Sunday evening inside active hours, once', () => {
    expect(recapDue(local(9, 27, 17, 59), settings, null, null)).toBe(false)
    expect(recapDue(local(9, 27, 18, 0), settings, null, null)).toBe(true)
    expect(recapDue(local(9, 27, 19), settings, iso(9, 27, 18), iso(9, 27, 18))).toBe(false)
    // Last week's recap does not count for this one.
    expect(recapDue(local(9, 27, 19), settings, iso(9, 20, 18), iso(9, 20, 18))).toBe(true)
    // A failed try waits.
    expect(recapDue(local(9, 27, 18, 10), settings, null, local(9, 27, 18, 0).toISOString())).toBe(false)
    expect(recapDue(local(9, 27, 19), { ...settings, weeklyRecap: false }, null, null)).toBe(false)
  })

  it('waits for active hours, catches up for two days, then waits for next Sunday', () => {
    expect(recapDue(local(9, 27, 22), settings, null, null)).toBe(false) // after 21:00
    expect(recapDue(local(9, 28, 9, 30), settings, null, null)).toBe(true) // Monday morning catch-up
    expect(recapDue(local(9, 30, 10), settings, null, null)).toBe(false) // Wednesday: too late
    expect(nextRecapAt(local(9, 30, 10), settings, null).getTime()).toBe(local(10, 4, 18).getTime())
  })

  it('moves the slot into active hours that end before the evening', () => {
    const early = { ...settings, activeStart: '08:00', activeEnd: '16:00' }
    expect(recapSlot(local(9, 27, 12), early).getTime()).toBe(local(9, 27, 8).getTime())
    expect(recapDue(local(9, 27, 9), early, null, null)).toBe(true)
  })
})

describe('weekly recap: share card', () => {
  it('draws only real, whole, positive numbers', () => {
    const card = parseShareCardInput({ kind: 'recap', title: 'My week with ClawMuse', body: 'Text', stats: [{ value: 12, label: 'messages sent' }, { value: 0, label: 'zero' }, { value: 2.5, label: 'half' }, { value: -1, label: 'neg' }, { value: '3', label: 'string' }, { value: 4, label: '<b>x</b>' }] })
    expect(card.stats).toEqual([{ value: 12, label: 'messages sent' }, { value: 4, label: '<b>x</b>' }])
    const html = shareCardHtml(card)
    expect(html).toContain('My week')
    expect(html).toContain('<b>12</b><span>messages sent</span>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(shareCardHtml(parseShareCardInput({ kind: 'recap', body: 'Text' }))).not.toContain('class="stats"')
  })
})

describe('goals record when they were completed', () => {
  it('stamps completion and clears it when reopened', () => {
    const now = local(9, 24)
    const done = withCompleted(goal({}), true, now)
    expect(done).toMatchObject({ completed: true, completedAt: now.toISOString() })
    expect(withCompleted(done, true, local(9, 25))).toBe(done)
    expect(withCompleted(done, false)).not.toHaveProperty('completedAt')
  })
})
