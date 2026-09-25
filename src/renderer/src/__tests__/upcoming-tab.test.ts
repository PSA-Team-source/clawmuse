/**
 * Status panel → Upcoming: the Muse grouping, labels and next-run text mapped
 * onto OpenClaw's structured cron schedules.
 */
import { describe, expect, it } from 'vitest'
import {
  formatNextRunTime,
  groupSchedulesByMode,
  runStatusPresentation,
  scheduleMode,
  scheduleSubtitle,
} from '@/routes/status/UpcomingTab'
import type { CronSchedule } from '@/types'

const job = (name: string, schedule: CronSchedule, next: string | null = null, enabled = true) => ({
  name,
  enabled,
  schedule,
  next_run_at: next,
})

describe('scheduleMode', () => {
  it('classifies every schedule shape the gateway sends', () => {
    expect(scheduleMode({ kind: 'at', at: '2026-09-24T09:00:00Z' })).toBe('runonce')
    expect(scheduleMode({ kind: 'every', everyMs: 1_800_000 })).toBe('interval')
    expect(scheduleMode({ kind: 'every', everyMs: 86_400_000 })).toBe('daily')
    expect(scheduleMode({ kind: 'every', everyMs: 604_800_000 })).toBe('weekly')
    expect(scheduleMode({ kind: 'cron', expr: '0 3 * * *' })).toBe('daily')
    expect(scheduleMode({ kind: 'cron', expr: '0 9,17 * * *' })).toBe('daily')
    expect(scheduleMode({ kind: 'cron', expr: '*/15 * * * *' })).toBe('hourly')
    expect(scheduleMode({ kind: 'cron', expr: '0 */2 * * *' })).toBe('hourly')
    expect(scheduleMode({ kind: 'cron', expr: '0 9 * * 1' })).toBe('weekly')
    expect(scheduleMode({ kind: 'cron', expr: '0 9 1 * *' })).toBe('monthly')
    expect(scheduleMode({ kind: 'cron', expr: '0 9 25 12 *' })).toBe('yearly')
    expect(scheduleMode({ kind: 'cron', expr: '30 0 9 * * 1' })).toBe('weekly')
    expect(scheduleMode({})).toBe('interval')
  })
})

describe('groupSchedulesByMode', () => {
  it('drops disabled jobs, folds intervals into Daily, orders groups like Muse and runs by next fire', () => {
    const groups = groupSchedulesByMode([
      job('weekly', { kind: 'cron', expr: '0 9 * * 1' }),
      job('heartbeat', { kind: 'every', everyMs: 1_800_000 }, '2026-09-23T12:30:00Z'),
      job('dream', { kind: 'cron', expr: '0 3 * * *' }, '2026-09-23T10:00:00Z'),
      job('paused', { kind: 'cron', expr: '0 3 * * *' }, null, false),
      job('reminder', { kind: 'at', at: '2026-09-24T09:00:00Z' }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Reminders', 'Daily', 'Weekly'])
    expect(groups[1]!.schedules.map((s) => s.name)).toEqual(['dream', 'heartbeat'])
    expect(groups.flatMap((g) => g.schedules).some((s) => s.name === 'paused')).toBe(false)
    expect(groupSchedulesByMode([])).toEqual([])
  })
})

describe('next-run text', () => {
  const now = new Date('2026-09-23T08:00:00Z')

  it('shows only the time when the run is today in the job zone, otherwise the date too', () => {
    expect(formatNextRunTime(Date.parse('2026-09-23T15:00:00Z'), 'UTC', now)).toMatch(/^3:00\s?pm$/)
    expect(formatNextRunTime(Date.parse('2026-09-24T09:00:00Z'), 'UTC', now)).toMatch(/^Sep 24, 9:00\s?am$/)
    expect(formatNextRunTime(Number.NaN, 'UTC', now)).toBeNull()
  })

  it('shows cadence for interval jobs and the next fire for calendar jobs', () => {
    expect(scheduleSubtitle(job('hb', { kind: 'every', everyMs: 1_800_000 }, '2026-09-23T08:30:00Z'), now)).toBe('Every 30 minutes')
    expect(scheduleSubtitle(job('d', { kind: 'cron', expr: '0 9 * * *', tz: 'UTC' }, '2026-09-24T09:00:00Z'), now)).toMatch(/^Sep 24, 9:00\s?am$/)
    expect(scheduleSubtitle(job('d', { kind: 'cron', expr: '0 9 * * *' }), now)).toBe('Every day at 09:00')
  })
})

describe('runStatusPresentation', () => {
  it('maps OpenClaw run statuses to Muse labels', () => {
    expect(runStatusPresentation('ok')).toEqual({ label: 'Succeeded', tone: 'success' })
    expect(runStatusPresentation('error')).toEqual({ label: 'Failed', tone: 'error' })
    expect(runStatusPresentation('error', 'timeout')).toEqual({ label: 'Timed out', tone: 'error' })
    expect(runStatusPresentation('skipped')).toEqual({ label: 'Skipped', tone: 'muted' })
  })
})
