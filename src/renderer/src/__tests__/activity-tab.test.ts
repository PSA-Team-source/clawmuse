import { describe, expect, it } from 'vitest'
import { groupActivity, toActivityRow, type TaskSummary } from '@/routes/status/ActivityTab'

const NOW = new Date(2026, 8, 23, 15, 0)
const at = (day: number, hour: number) => new Date(2026, 8, day, hour, 0).getTime()

function task(partial: Partial<TaskSummary> & Pick<TaskSummary, 'id' | 'status'>): TaskSummary {
  return { runtime: 'cron', title: 'heartbeat-main', createdAt: at(23, 10), ...partial }
}

describe('Activity tab mapping', () => {
  it('maps ledger statuses onto Muse timeline statuses with the right subtitle', () => {
    expect(toActivityRow(task({ id: 'a', status: 'running', progressSummary: 'Running automation.' }))).toMatchObject({ status: 'pending', subtitle: 'Running automation.' })
    expect(toActivityRow(task({ id: 'b', status: 'queued' }))?.status).toBe('pending')
    expect(toActivityRow(task({ id: 'c', status: 'failed', error: 'heartbeat skipped: no-route', progressSummary: 'Running automation.' }))).toMatchObject({ status: 'error', subtitle: 'heartbeat skipped: no-route' })
    expect(toActivityRow(task({ id: 'd', status: 'timed_out' }))?.subtitle).toBe('Timed out')
    expect(toActivityRow(task({ id: 'e', status: 'cancelled' }))).toMatchObject({ status: 'stopped', subtitle: 'Stopped' })
    expect(toActivityRow(task({ id: 'f', status: 'completed', terminalSummary: 'Edited 1 file(s), 3 test(s)' }))).toMatchObject({ status: 'success', subtitle: 'Edited 1 file, 3 tests' })
  })

  it('links a row to its transcript only when one exists', () => {
    expect(toActivityRow(task({ id: 'a', status: 'completed', sessionKey: '', hasTranscript: false }))?.sessionKey).toBeNull()
    expect(toActivityRow(task({ id: 'b', status: 'completed', runtime: 'subagent', sessionKey: 'agent:main:webchat:main' }))?.sessionKey).toBeNull()
    expect(toActivityRow(task({ id: 'c', status: 'completed', runtime: 'subagent', sessionKey: 'agent:main:webchat:main', childSessionKey: 'agent:main:subagent:x' }))?.sessionKey).toBe('subagent:x')
    expect(toActivityRow(task({ id: 'd', status: 'completed', runtime: 'cli', sessionKey: 'agent:ops:webchat:main' }))?.sessionKey).toBe('agent:ops:webchat:main')
  })

  it('groups newest first by local day and drops repeats across pages', () => {
    const days = groupActivity([
      task({ id: 'old', status: 'completed', createdAt: at(22, 9) }),
      task({ id: 'new', status: 'completed', createdAt: at(23, 12) }),
      task({ id: 'mid', status: 'failed', createdAt: at(23, 8) }),
      task({ id: 'new', status: 'completed', createdAt: at(23, 12) }),
      task({ id: 'bad', status: 'completed', createdAt: 'not a date', updatedAt: undefined }),
    ], NOW)
    expect(days.map((day) => day.label)).toEqual(['Today', 'Yesterday'])
    expect(days[0]!.rows.map((row) => row.id)).toEqual(['new', 'mid'])
    expect(days[1]!.rows.map((row) => row.id)).toEqual(['old'])
  })
})
