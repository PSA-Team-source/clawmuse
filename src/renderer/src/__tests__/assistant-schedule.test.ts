import { describe, expect, it } from 'vitest'
import { DEFAULT_ASSISTANT_SETTINGS, checkInBlocked, dailyDue, isLegacyAppRunChat, parseAssistantSettings, parseCheckIn, withinHours, type CheckInGate } from '@shared/assistant'

const at = (hhmm: string, day = 24) => new Date(2026, 8, day, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)))

function gate(patch: Partial<CheckInGate> = {}): CheckInGate {
  return {
    now: at('15:00'),
    settings: DEFAULT_ASSISTANT_SETTINGS,
    lastUserMessageAt: at('09:00').getTime(),
    lastEvaluatedAt: null,
    checkIns: [],
    systemIdleSeconds: 10,
    hasContext: true,
    ...patch,
  }
}

describe('built-in assistant schedule', () => {
  it('runs the daily feed once its time has passed, catching up after sleep', () => {
    expect(dailyDue(at('06:59'), '07:00', null, null)).toBe(false)
    expect(dailyDue(at('11:30'), '07:00', null, null)).toBe(true)
    expect(dailyDue(at('11:30'), '07:00', at('07:02').toISOString(), at('07:00').toISOString())).toBe(false)
    // Yesterday's edition does not count for today.
    expect(dailyDue(at('08:00'), '07:00', at('07:02', 23).toISOString(), at('07:00', 23).toISOString())).toBe(true)
    // A failed try waits before the next one.
    expect(dailyDue(at('08:00'), '07:00', null, at('07:50').toISOString())).toBe(false)
  })

  it('keeps active hours, including a window that wraps midnight', () => {
    expect(withinHours(at('08:59'), '09:00', '21:00')).toBe(false)
    expect(withinHours(at('20:59'), '09:00', '21:00')).toBe(true)
    expect(withinHours(at('23:30'), '22:00', '02:00')).toBe(true)
    expect(withinHours(at('12:00'), '22:00', '02:00')).toBe(false)
  })

  it('checks in only when the user is present, quiet with it, and under the cap', () => {
    expect(checkInBlocked(gate())).toBeNull()
    expect(checkInBlocked(gate({ settings: { ...DEFAULT_ASSISTANT_SETTINGS, checkIns: false } }))).toBe('off')
    expect(checkInBlocked(gate({ hasContext: false }))).toBe('nothing-known')
    expect(checkInBlocked(gate({ now: at('22:00') }))).toBe('outside-hours')
    expect(checkInBlocked(gate({ systemIdleSeconds: 600 }))).toBe('away')
    expect(checkInBlocked(gate({ lastUserMessageAt: at('14:00').getTime() }))).toBe('recently-talked')
    expect(checkInBlocked(gate({ lastEvaluatedAt: at('14:00').toISOString() }))).toBe('recently-evaluated')
    expect(checkInBlocked(gate({ checkIns: [{ at: at('10:00').toISOString(), message: 'x' }] }))).toBe('spacing')
    expect(checkInBlocked(gate({ now: at('20:00'), checkIns: [{ at: at('14:00').toISOString(), message: 'a' }, { at: at('09:30').toISOString(), message: 'b' }] }))).toBe('daily-cap')
  })

  it('sends only a real, specific message', () => {
    expect(parseCheckIn('{"send": false}')).toBeNull()
    expect(parseCheckIn('```json\n{"send": true, "message": "Stripe cut Connect fees this week — want me to re-run your margin model?"}\n```')).toBe('Stripe cut Connect fees this week — want me to re-run your margin model?')
    expect(parseCheckIn('{"send": true, "message": "Hi!"}')).toBeNull()
    expect(parseCheckIn('not json')).toBeNull()
  })

  it('falls back to defaults for malformed settings', () => {
    expect(parseAssistantSettings({ checkInsPerDay: 7, feedTime: '25:00', activeStart: '08:00', checkIns: 'yes' })).toEqual({ ...DEFAULT_ASSISTANT_SETTINGS, activeStart: '08:00' })
  })
})

describe('old Feed/Ideas run chats', () => {
  it('matches only side chats the app itself started', () => {
    expect(isLegacyAppRunChat('agent:main:webchat:main:conv:muf6u1xv', '[ClawMuse feed] Step 1 of 2. My feed prompt: …')).toBe(true)
    expect(isLegacyAppRunChat('webchat:main:conv:x', 'Suggest 6 to 9 concrete things you can do for me next,…')).toBe(true)
    expect(isLegacyAppRunChat('agent:main:webchat:main:conv:mue0wrum', 'Make me a feed about my interests.')).toBe(true)
    expect(isLegacyAppRunChat('agent:main:webchat:main', '[ClawMuse feed] Step 1')).toBe(false)
    expect(isLegacyAppRunChat('agent:main:webchat:main:conv:muezz8ab', 'Help me create a clear personal goal.')).toBe(false)
    expect(isLegacyAppRunChat('cron:abc', '[ClawMuse feed]')).toBe(false)
  })
})
