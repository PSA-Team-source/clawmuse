import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock01Icon } from '@hugeicons/core-free-icons'
import { TaskCard } from '@/components/tasks'
import { Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { EmptyState, useToast } from '@/components/patterns'
import { errorMessage, useTaskMutations, useTasks } from '@/hooks'
import { isSkillSessionKey } from '@/services/session-key'
import type { ScheduledTask } from '@/types'

interface AgentTasksPanelProps {
  skillId: string
}

/**
 * The scheduled work belonging to the agent you are talking to.
 *
 * Tasks also live on their own screen, but that list is every task on the
 * account. Asking "what does *this* agent do on its own?" while looking at it
 * is a different question, and it deserves an answer in the same place.
 */
function belongsToAgent(task: ScheduledTask, skillId: string): boolean {
  if (task.skill_id === skillId) return true
  // Tasks created from a conversation carry the session key instead of a skill
  // id, so the agent has to be recovered from the target.
  return typeof task.session_target === 'string' && isSkillSessionKey(task.session_target, skillId)
}

export function AgentTasksPanel({ skillId }: AgentTasksPanelProps) {
  const navigate = useNavigate()
  const { show } = useToast()
  const { data: tasks, isLoading } = useTasks()
  const { toggle, run, remove } = useTaskMutations()

  const agentTasks = useMemo(
    () => (tasks ?? []).filter((task) => belongsToAgent(task, skillId)),
    [tasks, skillId],
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={22} />
      </div>
    )
  }

  if (agentTasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={<Icon icon={Clock01Icon} size={44} className="text-content-disabled" />}
          title="No scheduled work"
          description="Ask this agent to do something on a schedule and it will show up here."
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
      {agentTasks.map((task) => (
        <TaskCard
          key={task.cron_job_id}
          task={task}
          running={run.isPending && run.variables === task.cron_job_id}
          onOpen={() => navigate(`/tasks/${encodeURIComponent(task.cron_job_id)}`)}
          onToggle={(enabled) =>
            toggle.mutate(
              { cronJobId: task.cron_job_id, enabled },
              {
                onError: (error) =>
                  show({
                    title: 'Could not update task',
                    description: errorMessage(error),
                    variant: 'error',
                  }),
              },
            )
          }
          onRun={() =>
            run.mutate(task.cron_job_id, {
              onSuccess: () => show({ title: 'Task started', variant: 'success' }),
              onError: (error) =>
                show({
                  title: 'Could not run task',
                  description: errorMessage(error),
                  variant: 'error',
                }),
            })
          }
          onDelete={() =>
            remove.mutate(task.cron_job_id, {
              onError: (error) =>
                show({
                  title: 'Could not delete task',
                  description: errorMessage(error),
                  variant: 'error',
                }),
            })
          }
        />
      ))}
    </div>
  )
}
