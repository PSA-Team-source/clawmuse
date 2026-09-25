/**
 * Regression tests for the scheduled-tasks boundary.
 *
 * The Tasks screen showed "No scheduled tasks yet" against an account with three
 * live cron jobs. The gateway sends `description: null` / `skill_id: null` for
 * columns it has no value for; both fields were declared `.optional()`, which in
 * Zod accepts `undefined` but NOT `null`. One rejected row failed the whole
 * `z.array(...)`, whose `.catch([])` then replaced every task with an empty list
 * — silently, with a 200 response and no console error.
 */
import { describe, expect, it } from 'vitest'
import { scheduledTaskSchema, tasksResponseSchema, tolerantArray } from '@/types'
import { z } from 'zod'

/** Shaped exactly like a row the production gateway returns. */
const liveTask = {
  id: '1e6b2a3c-abba-4834-b521-8d5ce10094ee',
  user_id: 'a9a901bf-87ab-4133-8a29-d82904827579',
  cron_job_id: '02d2965e-f69d-4132-b56f-1eafc4b0b49e',
  name: 'Gitea Daily Activity Monitor (08:30 VN)',
  description: null,
  enabled: true,
  schedule: { tz: 'Asia/Ho_Chi_Minh', expr: '30 1 * * *', kind: 'cron' },
  payload: { prompt: 'check gitea' },
  skill_id: null,
  session_target: 'webchat:main',
  next_run_at: '2026-07-22T01:30:00.000Z',
  last_run_at: '2026-07-21T01:30:00.000Z',
  last_status: 'ok',
  created_at: '2026-07-01T00:00:00.000Z',
}

describe('scheduledTaskSchema', () => {
  it('accepts the nulls the gateway actually sends', () => {
    const parsed = scheduledTaskSchema.safeParse(liveTask)
    expect(parsed.success).toBe(true)
  })

  it.each(['description', 'skill_id', 'session_target', 'created_at'])(
    'accepts null for %s',
    (field) => {
      expect(scheduledTaskSchema.safeParse({ ...liveTask, [field]: null }).success).toBe(true)
    },
  )

  it('still requires the fields the UI cannot work without', () => {
    const { cron_job_id: _omitted, ...withoutCronId } = liveTask
    expect(scheduledTaskSchema.safeParse(withoutCronId).success).toBe(false)
  })
})

describe('tasksResponseSchema', () => {
  it('returns every task from a real payload', () => {
    const parsed = tasksResponseSchema.parse({ tasks: [liveTask, liveTask, liveTask] })
    expect(parsed.tasks).toHaveLength(3)
  })

  it('drops only the malformed row, never the whole list', () => {
    const parsed = tasksResponseSchema.parse({
      tasks: [liveTask, { name: 'broken — no cron_job_id' }, { ...liveTask, id: '2' }],
    })

    // The old `z.array(x).catch([])` returned [] here — the bug that shipped.
    expect(parsed.tasks).toHaveLength(2)
    expect(parsed.tasks.map((t) => t.id)).toEqual([liveTask.id, '2'])
  })

  it('falls back to an empty list when `tasks` is not an array', () => {
    expect(tasksResponseSchema.parse({ tasks: 'nope' }).tasks).toEqual([])
    expect(tasksResponseSchema.parse({}).tasks).toEqual([])
  })
})

describe('tolerantArray', () => {
  const row = z.object({ id: z.string() })

  it('keeps good rows and discards bad ones', () => {
    const schema = z.object({ items: tolerantArray(row, 'test') })
    expect(schema.parse({ items: [{ id: 'a' }, { id: 42 }, { id: 'b' }] }).items).toEqual([
      { id: 'a' },
      { id: 'b' },
    ])
  })

  it('never throws on a non-array', () => {
    const schema = z.object({ items: tolerantArray(row, 'test') })
    expect(schema.parse({ items: null }).items).toEqual([])
  })
})
