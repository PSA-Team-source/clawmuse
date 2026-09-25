import type { CronSchedule } from '@/types'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

function withTimezone(text: string, tz?: string): string {
  return tz ? `${text} (${tz})` : text
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value)
}

/**
 * Best-effort English description of a 5-field cron expression
 * (`minute hour day-of-month month day-of-week`). Recognises the common
 * shapes tasks actually use — daily/weekly at a fixed time, "every N
 * minutes/hours" — and falls back to the raw expression otherwise, since a
 * full cron parser is overkill for a read-only summary.
 */
function describeCronExpr(expr: string, tz?: string): string {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return withTimezone(expr, tz)
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string]

  const time = isNumeric(minute) && isNumeric(hour) ? `${pad2(Number(hour))}:${pad2(Number(minute))}` : null

  const everyMinuteMatch = minute.match(/^\*\/(\d+)$/)
  if (everyMinuteMatch && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return withTimezone(`Every ${everyMinuteMatch[1]!} minutes`, tz)
  }

  const everyHourMatch = hour.match(/^\*\/(\d+)$/)
  if (everyHourMatch && minute === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return withTimezone(`Every ${everyHourMatch[1]!} hours`, tz)
  }

  if (time && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return withTimezone(`Every day at ${time}`, tz)
  }

  if (time && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = dayOfWeek
      .split(',')
      .map((d) => DAY_NAMES[Number(d) % 7] ?? d)
      .join(', ')
    return withTimezone(`Every ${days} at ${time}`, tz)
  }

  if (time && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    return withTimezone(`On day ${dayOfMonth} of the month at ${time}`, tz)
  }

  if (time) return withTimezone(`At ${time}`, tz)

  return withTimezone(expr, tz)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`
  const totalMinutes = Math.round(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`
  const totalHours = Math.round(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours} hour${totalHours === 1 ? '' : 's'}`
  const totalDays = Math.round(totalHours / 24)
  return `${totalDays} day${totalDays === 1 ? '' : 's'}`
}

const AT_FORMATTER = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Human-readable label for a scheduled task's `CronSchedule`, e.g.
 * "Every day at 09:00", "Every 2 hours", "Once on Jul 20, 2026, 3:00 PM".
 * Falls back to the raw expression when a cron pattern isn't recognised, and
 * appends the timezone whenever one is set — a "9am" that silently means UTC
 * is the kind of bug that only shows up after it fires at the wrong hour.
 */
export function describeSchedule(schedule?: CronSchedule): string {
  if (!schedule || !schedule.kind) return 'No schedule'

  if (schedule.kind === 'every') {
    return schedule.everyMs
      ? withTimezone(`Every ${formatDuration(schedule.everyMs)}`, schedule.tz)
      : 'Custom interval'
  }

  if (schedule.kind === 'at') {
    if (!schedule.at) return 'One-time'
    const date = new Date(schedule.at)
    if (Number.isNaN(date.getTime())) return withTimezone(schedule.at, schedule.tz)
    return withTimezone(`Once on ${AT_FORMATTER.format(date)}`, schedule.tz)
  }

  if (schedule.kind === 'cron') {
    return schedule.expr ? describeCronExpr(schedule.expr, schedule.tz) : 'Custom schedule'
  }

  return 'Custom schedule'
}
