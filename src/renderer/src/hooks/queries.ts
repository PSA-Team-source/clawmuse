import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createLocalTask,
  listLocalTaskRuns,
  listLocalTasks,
  removeLocalTask,
  runLocalTask,
  setLocalTaskEnabled,
} from '@/services/local-tasks'
import {
  getLocalSkill,
  listLocalSkills,
  removeLocalSkill,
  saveLocalSkill,
} from '@/services/local-skills'
import { readLocalUsage } from '@/services/local-usage'
import { useGatewayStore } from '@/stores/gateway.store'
import type { ScheduledTask } from '@/types'

/**
 * Server state lives here (TanStack Query); real-time and local state lives in
 * Zustand. Polling uses `refetchInterval` rather than a hand-rolled
 * `setInterval`, so it pauses automatically when the window is in the
 * background.
 *
 * "Server" is a stretch here: there is no server. Every query below reads the
 * gateway running on this machine, and nothing in this file can produce a
 * network request that leaves it. That is not a policy anyone has to remember —
 * there is no REST client in this app to call.
 */

export const queryKeys = {
  tasks: ['tasks'] as const,
  usage: ['usage'] as const,
  skills: ['skills'] as const,
  skill: (slug: string) => ['skill', slug] as const,
}

// ── Routines and scheduled tasks ────────────────────────────────────────────

/**
 * The gateway's own cron engine is the source of truth; `local-tasks.ts` adapts
 * it to the `ScheduledTask` the screens render.
 */
export function useTasks() {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => listLocalTasks(),
    refetchInterval: 15_000,
    staleTime: 5_000,
  })
}

/**
 * Run history for one job.
 *
 * `cron.list` reports only the latest status, so a task that failed yesterday
 * and succeeded today looks perfectly healthy. This is the only place the
 * actual failure reason is recorded.
 */
export function useTaskRuns(cronJobId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.tasks, 'runs', cronJobId ?? ''],
    queryFn: () => listLocalTaskRuns(cronJobId!),
    enabled: Boolean(cronJobId),
    staleTime: 15_000,
  })
}

export function useTaskMutations() {
  const queryClient = useQueryClient()

  const toggle = useMutation({
    mutationFn: async ({ cronJobId, enabled }: { cronJobId: string; enabled: boolean }) => {
      await setLocalTaskEnabled(cronJobId, enabled)
    },
    // Optimistic: a cron toggle is instant to the eye but a round-trip on the
    // wire, and the list polls every 15s so a stale flip would be visible.
    onMutate: async ({ cronJobId, enabled }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks })
      const previous = queryClient.getQueryData<ScheduledTask[]>(queryKeys.tasks)
      queryClient.setQueryData<ScheduledTask[]>(queryKeys.tasks, (tasks) =>
        tasks?.map((task) => (task.cron_job_id === cronJobId ? { ...task, enabled } : task)),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.tasks, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
  })

  const run = useMutation({
    mutationFn: (cronJobId: string) => runLocalTask(cronJobId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
  })

  const remove = useMutation({
    mutationFn: (cronJobId: string) => removeLocalTask(cronJobId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
  })

  const create = useMutation({
    mutationFn: (input: {
      name: string
      prompt: string
      skillId: string | null
      /** A bot's routine — it runs as that bot, in that bot's own thread. */
      botId?: string | null
      everyMs: number
    }) =>
      createLocalTask({
        name: input.name,
        prompt: input.prompt,
        skillId: input.skillId,
        botId: input.botId ?? null,
        everyMs: input.everyMs,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
  })

  return { toggle, run, remove, create }
}

// ── Usage ───────────────────────────────────────────────────────────────────

/**
 * What this machine actually spent, read from the gateway's own session logs.
 *
 * There is no plan and no allowance to report — the user pays their provider
 * directly, or nothing at all when the model runs on this machine too.
 */
export function useLocalUsage(enabled = true) {
  return useQuery({
    queryKey: queryKeys.usage,
    queryFn: () => readLocalUsage(),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

// ── Skills ──────────────────────────────────────────────────────────────────

/**
 * Authored skills.
 *
 * A skill is a `skills/<slug>/SKILL.md` directory in the workspace, and the
 * write *is* the deploy — `skills.load.watch` reloads the file. There is
 * nothing to publish and nowhere to publish it to.
 */
export function useAdminSkills(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.skills,
    queryFn: () => listLocalSkills(),
    enabled,
  })
}

export function useAdminSkill(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.skill(slug ?? ''),
    queryFn: () => getLocalSkill(slug!),
    enabled: Boolean(slug),
  })
}

export interface SkillWriteInput {
  slug: string
  skill_md: string
}

export function useAgentStudioMutations() {
  const queryClient = useQueryClient()
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.skills })
  }

  return {
    create: useMutation({
      mutationFn: async (input: SkillWriteInput) => {
        await saveLocalSkill(input.slug, input.skill_md)
        return { ok: true as const }
      },
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: async ({ slug, skill_md }: SkillWriteInput) => {
        await saveLocalSkill(slug, skill_md)
        return { ok: true as const }
      },
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (slug: string) => {
        await removeLocalSkill(slug)
        return { ok: true as const }
      },
      onSuccess: invalidate,
    }),
  }
}

// ── Connection ──────────────────────────────────────────────────────────────

/** True once the local agent is answering — the gate every screen waits on. */
export function useConnected(): boolean {
  return useGatewayStore((state) => state.connectionState === 'connected')
}

/** Narrows an unknown error to the message worth showing a person. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) return error.message
  return fallback
}
