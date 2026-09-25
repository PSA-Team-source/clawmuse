import { describe, expect, it } from 'vitest'
import { timeLabel } from '@/components/chat/MessageList'

describe('timeLabel (Muse formatTimestampLabel)', () => {
  const now = new Date(2026, 8, 23, 18, 0)
  it('is only the clock for today', () => {
    expect(timeLabel(new Date(2026, 8, 23, 15, 45).toISOString(), now, 'en-US')).toBe('3:45 PM')
  })
  it('adds month and day on another day of this year', () => {
    expect(timeLabel(new Date(2026, 8, 21, 15, 45).toISOString(), now, 'en-US')).toBe('Sep 21, 3:45 PM')
  })
  it('adds the year for another year', () => {
    expect(timeLabel(new Date(2025, 11, 31, 9, 5).toISOString(), now, 'en-US')).toBe('Dec 31, 2025, 9:05 AM')
  })
  it('is empty for an unparseable date', () => {
    expect(timeLabel('nope', now)).toBe('')
  })
})
