import { z } from 'zod'
import { gatewayWS } from '@/services/gateway-ws.service'
import {
  agentIdFromSessionKey,
  botMainSessionKey,
  skillBaseKey,
  skillIdFromSessionKey,
} from '@/services/session-key'
import { cronScheduleSchema, tolerantArray } from '@/types'
import type { ScheduledTask } from '@/types'

/**
 * Tasks, read straight from the gateway's cron engine.
 *
 * In cloud mode the app reads `/api/tasks`, where the server has already
 * flattened cron jobs into snake_case rows keyed by `cron_job_id`. Locally
 * there is no such server, so this adapts the raw `cron.list` shape to the same
 * `ScheduledTask` the screens already render — the UI stays identical whichever
 * mode it is in.
 *
 * Field-by-field, the wire shapes do not overlap much:
 *
 *   gateway                     REST
 *   id                          cron_job_id
 *   state.nextRunAtMs (epoch)   next_run_at (ISO)
 *   state.lastRunStatus         last_status
 *   sessionTarget               session_target
 */

const cronJobStateSchema = z
  .object({
    nextRunAtMs: z.number().optional(),
    lastRunAtMs: z.number().optional(),
    lastRunStatus: z.string().optional(),
    lastStatus: z.string().optional(),
    lastError: z.string().optional(),
  })
  .loose()

const cronJobSchema = z
  .object({
    id: z.string(),
    name: z.string().catch('Untitled task'),
    displayName: z.string().nullish(),
    description: z.string().nullish(),
    enabled: z.boolean().catch(true),
    agentId: z.string().nullish(),
    sessionTarget: z.string().nullish(),
    schedule: cronScheduleSchema.catch({}),
    payload: z.record(z.string(), z.unknown()).catch({}),
    createdAtMs: z.number().optional(),
    state: cronJobStateSchema.catch({}),
  })
  .loose()

const cronListSchema = z.object({ jobs: tolerantArray(cronJobSchema, 'cron.jobs') }).loose()

type CronJob = z.infer<typeof cronJobSchema>

function isoFrom(epochMs: number | undefined): string | null {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null
  return new Date(epochMs).toISOString()
}

/**
 * The gateway states a job's target as `session:webchat:skill:<id>`, or names
 * the agent directly. Either way the agent has to be recovered here, or the
 * task screens lose track of which agent a task belongs to — which is what
 * previously left every local task unattributed.
 */
function skillIdOf(job: CronJob): string | null {
  const target = job.sessionTarget
  if (typeof target === 'string') {
    const key = target.startsWith('session:') ? target.slice('session:'.length) : target
    const skillId = skillIdFromSessionKey(key)
    if (skillId) return skillId
  }
  return job.agentId ?? null
}

/**
 * The bot a routine belongs to.
 *
 * A routine is a cron job pointed at that bot's own thread, so its result lands
 * in the conversation the user reads rather than in a task log they have to go
 * looking for. `agentId` is authoritative; the target is the fallback for jobs
 * created before it was set.
 */
export function botIdOfTask(task: { session_target?: string | null }): string | null {
  const target = task.session_target
  if (typeof target === 'string') {
    const key = target.startsWith('session:') ? target.slice('session:'.length) : target
    const agentId = agentIdFromSessionKey(key)
    if (agentId) return agentId
  }
  return null
}

function toScheduledTask(job: CronJob): ScheduledTask {
  return {
    id: job.id,
    // The task screens route by `cron_job_id`; locally the cron id *is* the id.
    cron_job_id: job.id,
    name: job.name,
    display_name: job.displayName ?? null,
    description: job.description ?? null,
    enabled: job.enabled,
    schedule: job.schedule,
    payload: job.payload,
    skill_id: skillIdOf(job),
    session_target: job.sessionTarget ?? null,
    next_run_at: isoFrom(job.state.nextRunAtMs),
    last_run_at: isoFrom(job.state.lastRunAtMs),
    // `lastStatus` is the deprecated alias; prefer the current field but accept
    // either so an older gateway still shows run results.
    last_status: job.state.lastRunStatus ?? job.state.lastStatus ?? null,
    last_error: job.state.lastError ?? null,
    created_at: isoFrom(job.createdAtMs),
  }
}

export interface NewTaskInput {
  name: string
  /** What the agent should actually do when the task fires. */
  prompt: string
  /** Agent to run it as; omitted means the task runs in an isolated session. */
  skillId?: string | null
  /** Bot to run it as — a routine. Wins over `skillId` when both are given. */
  botId?: string | null
  everyMs: number
}

/**
 * Creates a recurring task on the local gateway.
 *
 * Two constraints come straight from the gateway's own contract. `sessionTarget`
 * must be set explicitly — the default, `main`, only accepts `systemEvent`
 * payloads and would reject the `agentTurn` this sends. And an agent-scoped
 * task targets `session:<key>`, which is what makes it show up under that agent
 * rather than floating loose in the task list.
 */
export async function createLocalTask(input: NewTaskInput): Promise<void> {
  // A bot's routine runs *as that bot, in its own thread*, so the result lands
  // in the conversation the user already reads. `agentId` picks the bot;
  // `sessionTarget` picks where the turn lands. Setting only one of the two
  // produces a routine that either runs as the wrong bot or answers into a
  // thread nobody opens.
  const sessionTarget = input.botId
    ? `session:${botMainSessionKey(input.botId)}`
    : input.skillId
      ? `session:${skillBaseKey(input.skillId)}`
      : 'isolated'

  await gatewayWS.cronAdd({
    name: input.name,
    enabled: true,
    schedule: { kind: 'every', everyMs: input.everyMs },
    sessionTarget,
    ...(input.botId ? { agentId: input.botId } : {}),
    payload: { kind: 'agentTurn', message: input.prompt },
  })
}

export async function listLocalTasks(): Promise<ScheduledTask[]> {
  const raw = await gatewayWS.cronList(true)
  const parsed = cronListSchema.safeParse(raw)
  if (!parsed.success) return []
  return parsed.data.jobs.map(toScheduledTask)
}

export interface TaskRun {
  id: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  durationMs: number | null
}

const cronRunSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String).nullish(),
    runId: z.union([z.string(), z.number()]).transform(String).nullish(),
    status: z.string().nullish(),
    startedAtMs: z.number().nullish(),
    finishedAtMs: z.number().nullish(),
    // OpenClaw's run log (CronRunLogEntry): runAtMs is the start, ts the finish.
    runAtMs: z.number().nullish(),
    ts: z.number().nullish(),
    durationMs: z.number().nullish(),
    error: z.string().nullish(),
  })
  .loose()

// The gateway answers `entries`; `runs` is the older shape.
const cronRunsSchema = z.object({ entries: tolerantArray(cronRunSchema, 'cron.runs').optional(), runs: tolerantArray(cronRunSchema, 'cron.runs').optional() }).loose()

/**
 * Run history for one job.
 *
 * `cron.list` reports only the latest status, so a task that failed yesterday
 * and succeeded today looks perfectly healthy. This is the only place the
 * actual failure reason is recorded.
 */
export async function listLocalTaskRuns(jobId: string): Promise<TaskRun[]> {
  const parsed = cronRunsSchema.safeParse(await gatewayWS.cronRuns(jobId))
  if (!parsed.success) return []

  return (parsed.data.entries ?? parsed.data.runs ?? []).map((run, index) => ({
    id: run.runId ?? run.id ?? `run_${index}`,
    status: run.status ?? 'unknown',
    startedAt: isoFrom(run.runAtMs ?? run.startedAtMs ?? undefined),
    finishedAt: isoFrom(run.ts ?? run.finishedAtMs ?? undefined),
    error: run.error ?? null,
    durationMs: run.durationMs ?? null,
  }))
}

export async function setLocalTaskEnabled(jobId: string, enabled: boolean): Promise<void> {
  await gatewayWS.cronUpdate(jobId, { enabled })
}

export async function runLocalTask(jobId: string): Promise<void> {
  await gatewayWS.cronRun(jobId)
}

export async function removeLocalTask(jobId: string): Promise<void> {
  await gatewayWS.cronRemove(jobId)
}
