import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock01Icon, ReloadIcon, Search01Icon } from '@hugeicons/core-free-icons'
import { TaskCard } from '@/components/tasks'
import { GhostButton, GradientButton, IconButton, SectionLabel, Skeleton } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { EmptyState, TextField, useToast } from '@/components/patterns'
import { errorMessage, useDebounced, useTaskMutations, useTasks } from '@/hooks'
import { cn } from '@/lib/cn'
import { CLAWMUSE_SKILL_ID } from '@/stores/room.store'
import type { ScheduledTask } from '@/types'
import { NewTaskModal } from '@/routes/tasks/NewTaskModal'

/** `skill_id` is a slug (or absent for the main agent) — turn it into a display label. */
function skillLabel(skillId?: string | null): string {
  if (!skillId || skillId === CLAWMUSE_SKILL_ID) return 'ClawMuse'
  return skillId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function isFailedStatus(status?: string | null): boolean {
  const value = (status ?? '').toLowerCase()
  return value === 'error' || value === 'failed'
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: 'success' | 'neutral' | 'error' }) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'error' ? 'text-error' : 'text-content-secondary'
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cn('text-title-3 font-bold tabular-nums', toneClass)}>{value}</span>
      <span className="text-caption text-content-muted">{label}</span>
    </div>
  )
}

/**
 * Scheduled automations, grouped by owning agent.
 *
 * Tasks can be created here or by simply asking an agent in chat; both end up
 * in the same list, because both are the same cron job underneath.
 */
export default function TasksScreen() {
  const navigate = useNavigate()
  const { data: tasks, isLoading, isFetching, refetch } = useTasks()
  const { toggle, run, remove } = useTaskMutations()
  const { show } = useToast()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 150)
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false)

  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    const list = tasks ?? []
    if (!query) return list
    return list.filter(
      (task) => task.name.toLowerCase().includes(query) || (task.description?.toLowerCase().includes(query) ?? false),
    )
  }, [tasks, debouncedSearch])

  const grouped = useMemo(() => {
    const map = new Map<string, ScheduledTask[]>()
    for (const task of filtered) {
      const label = skillLabel(task.skill_id)
      const bucket = map.get(label) ?? []
      bucket.push(task)
      map.set(label, bucket)
    }
    return Array.from(map.entries())
  }, [filtered])

  const stats = useMemo(() => {
    const list = tasks ?? []
    const active = list.filter((task) => task.enabled).length
    const failed = list.filter((task) => isFailedStatus(task.last_status)).length
    return { active, paused: list.length - active, failed }
  }, [tasks])

  function handleToggle(task: ScheduledTask, enabled: boolean) {
    toggle.mutate(
      { cronJobId: task.cron_job_id, enabled },
      { onError: (error) => show({ title: 'Could not update task', description: errorMessage(error), variant: 'error' }) },
    )
  }

  function handleRun(task: ScheduledTask) {
    run.mutate(task.cron_job_id, {
      onSuccess: () => show({ title: 'Task started', variant: 'success' }),
      onError: (error) => show({ title: 'Could not run task', description: errorMessage(error), variant: 'error' }),
    })
  }

  function handleDelete(task: ScheduledTask) {
    remove.mutate(task.cron_job_id, {
      onSuccess: () => show({ title: 'Task deleted', variant: 'success' }),
      onError: (error) => show({ title: 'Could not delete task', description: errorMessage(error), variant: 'error' }),
    })
  }

  const hasAnyTasks = (tasks?.length ?? 0) > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line-hairline px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-title-3 font-bold text-content-primary">Tasks</h1>
            <p className="text-body-sm text-content-tertiary">Scheduled automations your agent runs on its own.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <GradientButton size="sm" onClick={() => setIsNewTaskOpen(true)}>
              New task
            </GradientButton>
            <IconButton
              icon={ReloadIcon}
              label="Refresh tasks"
              onClick={() => void refetch()}
              disabled={isFetching}
              shape="circle"
              tone="filled"
              className={cn('shrink-0', isFetching && '[&_svg]:animate-spin')}
            />
          </div>
        </div>

        {hasAnyTasks && (
          <div className="flex items-center gap-5">
            <StatChip label="Active" value={stats.active} tone="success" />
            <StatChip label="Paused" value={stats.paused} tone="neutral" />
            <StatChip label="Failed" value={stats.failed} tone="error" />
            <div className="ml-auto w-64">
              <TextField value={search} onChange={setSearch} placeholder="Search tasks" icon={Search01Icon} />
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-box" />
            ))}
          </div>
        ) : !hasAnyTasks ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Icon icon={Clock01Icon} size={44} className="text-content-disabled" />}
              title="No scheduled tasks yet"
              description="Schedule recurring work — a daily spend check, a weekly summary — or just ask your agent in chat and it will show up here."
              action={
                <div className="flex gap-2">
                  <GradientButton onClick={() => setIsNewTaskOpen(true)}>New task</GradientButton>
                  <GhostButton onClick={() => navigate('/chat')}>Open chat</GhostButton>
                </div>
              }
            />
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState title="No matches" description="Try a different search." />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {grouped.map(([label, list]) => (
              <section key={label} className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <SectionLabel>{label}</SectionLabel>
                  <span className="text-micro text-content-faint">{list.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
                  {list.map((task) => (
                    <TaskCard
                      key={task.cron_job_id}
                      task={task}
                      onToggle={(enabled) => handleToggle(task, enabled)}
                      onRun={() => handleRun(task)}
                      onDelete={() => handleDelete(task)}
                      onOpen={() => navigate(`/tasks/${encodeURIComponent(task.cron_job_id)}`)}
                      running={run.isPending && run.variables === task.cron_job_id}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <NewTaskModal open={isNewTaskOpen} onOpenChange={setIsNewTaskOpen} />
    </div>
  )
}
