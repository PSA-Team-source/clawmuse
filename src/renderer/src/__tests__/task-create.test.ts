import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalTask, listLocalTasks } from '@/services/local-tasks'
import { gatewayWS } from '@/services/gateway-ws.service'

/**
 * Creating a task locally is a `cron.add`, and the gateway's contract has two
 * traps that produce a job which is accepted but never does anything:
 *
 *  - `sessionTarget` must be explicit. Left out, the job lands on `main`, and
 *    `main` only accepts `systemEvent` payloads — an `agentTurn` is rejected.
 *  - an agent-scoped task must target `session:<key>`, or nothing ties the task
 *    back to the agent and it shows up unattributed.
 */

vi.mock('@/services/gateway-ws.service', () => ({
  gatewayWS: { cronAdd: vi.fn().mockResolvedValue({}), cronList: vi.fn() },
  encodeAttachment: vi.fn(),
}))

const cronAdd = vi.mocked(gatewayWS.cronAdd)
const cronList = vi.mocked(gatewayWS.cronList)

beforeEach(() => {
  cronAdd.mockClear()
  cronList.mockReset()
})

describe('createLocalTask', () => {
  it('targets the agent session so the task belongs to that agent', async () => {
    await createLocalTask({
      name: 'Daily spend check',
      prompt: 'Check yesterday spend',
      skillId: 'facebook-ads',
      everyMs: 86_400_000,
    })

    expect(cronAdd).toHaveBeenCalledTimes(1)
    const job = cronAdd.mock.calls[0]![0] as Record<string, unknown>
    expect(job.sessionTarget).toBe('session:webchat:skill:facebook-ads')
    expect(job.payload).toEqual({ kind: 'agentTurn', message: 'Check yesterday spend' })
    expect(job.schedule).toEqual({ kind: 'every', everyMs: 86_400_000 })
    expect(job.enabled).toBe(true)
  })

  it('runs isolated — never on main — when no agent is chosen', async () => {
    await createLocalTask({ name: 'Ping', prompt: 'ping', skillId: null, everyMs: 60_000 })

    const job = cronAdd.mock.calls[0]![0] as Record<string, unknown>
    // `main` would reject the agentTurn payload outright.
    expect(job.sessionTarget).toBe('isolated')
    expect(job.sessionTarget).not.toBe('main')
  })
})

describe('listLocalTasks — agent attribution', () => {
  it('recovers the agent from a session-scoped target', async () => {
    cronList.mockResolvedValue({
      jobs: [
        {
          id: 'job1',
          name: 'Daily check',
          enabled: true,
          sessionTarget: 'session:webchat:skill:facebook-ads',
          schedule: { kind: 'every', everyMs: 3600000 },
          payload: {},
          state: {},
        },
      ],
    })

    const [task] = await listLocalTasks()
    expect(task?.skill_id).toBe('facebook-ads')
  })

  it('falls back to agentId when the target names no agent', async () => {
    cronList.mockResolvedValue({
      jobs: [
        {
          id: 'job2',
          name: 'Isolated job',
          enabled: true,
          sessionTarget: 'isolated',
          agentId: 'research',
          schedule: {},
          payload: {},
          state: {},
        },
      ],
    })

    const [task] = await listLocalTasks()
    expect(task?.skill_id).toBe('research')
  })

  it('leaves the agent null when there is nothing to attribute to', async () => {
    cronList.mockResolvedValue({
      jobs: [
        {
          id: 'job3',
          name: 'Loose job',
          enabled: true,
          sessionTarget: 'isolated',
          schedule: {},
          payload: {},
          state: {},
        },
      ],
    })

    const [task] = await listLocalTasks()
    expect(task?.skill_id).toBeNull()
  })
})
