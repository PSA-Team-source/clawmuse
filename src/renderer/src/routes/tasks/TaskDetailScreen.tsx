import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Clock01Icon, Delete02Icon, PlayIcon } from '@hugeicons/core-free-icons'
import { RunStatusBadge } from '@/components/tasks'
import { GhostButton, GradientButton, SectionLabel, Separator, Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { BackLink, EmptyState, useToast } from '@/components/patterns'
import { Dialog, Switch } from '@/components/primitives'
import { errorMessage, useTaskMutations, useTaskRuns, useTasks } from '@/hooks'
import { formatRelativeTime } from '@/utils/format'
import { describeSchedule } from '@/utils/schedule'

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-body-sm text-content-tertiary">{label}</span>
      <span className="text-body-sm font-medium text-content-primary">{value}</span>
    </div>
  )
}

/** Payload shapes vary by skill — pull the free-text prompt out of whatever field the agent stored it under. */
// `fallback` is the task's description, which the gateway sends as null when
// the cron job has none — hence `null` in the signature, not just `undefined`.
function promptFromPayload(payload: Record<string, unknown>, fallback?: string | null): string {
  if (typeof payload.message === 'string' && payload.message) return payload.message
  if (typeof payload.text === 'string' && payload.text) return payload.text
  return fallback || '—'
}

export default function TaskDetailScreen() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const { data: tasks, isLoading } = useTasks()
  const { data: runs = [] } = useTaskRuns(taskId)
  const { toggle, run, remove } = useTaskMutations()
  const { show } = useToast()
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const task = tasks?.find((t) => t.cron_job_id === taskId)

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center">
        {isLoading ? (
          <Spinner size={24} />
        ) : (
          <EmptyState
            icon={<Icon icon={Clock01Icon} size={40} className="text-content-disabled" />}
            title="Task not found"
            description="This task may have already been deleted."
            action={<GhostButton onClick={() => navigate('/tasks')}>Back to tasks</GhostButton>}
          />
        )}
      </div>
    )
  }

  // Re-bind to a plain const so every closure below sees the non-null type
  // TS already narrowed above, instead of re-deriving it from `tasks?.find`.
  const currentTask = task
  const promptText = promptFromPayload(currentTask.payload, currentTask.description)

  function handleToggle(enabled: boolean) {
    toggle.mutate(
      { cronJobId: currentTask.cron_job_id, enabled },
      { onError: (error) => show({ title: 'Could not update task', description: errorMessage(error), variant: 'error' }) },
    )
  }

  function handleRun() {
    run.mutate(currentTask.cron_job_id, {
      onSuccess: () => show({ title: 'Task started', variant: 'success' }),
      onError: (error) => show({ title: 'Could not run task', description: errorMessage(error), variant: 'error' }),
    })
  }

  function handleDeleteConfirm() {
    setIsDeleting(true)
    remove.mutate(currentTask.cron_job_id, {
      onSuccess: () => {
        setIsDeleting(false)
        setIsDeleteOpen(false)
        navigate('/tasks')
      },
      onError: (error) => {
        setIsDeleting(false)
        show({ title: 'Could not delete task', description: errorMessage(error), variant: 'error' })
      },
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
        <BackLink to="/tasks" label="Tasks" />

        <div>
          <h1 className="text-title-2 font-bold text-content-primary">{currentTask.name || 'Untitled task'}</h1>
          {currentTask.description && <p className="mt-1 text-body-sm text-content-tertiary">{currentTask.description}</p>}
        </div>

        <div className="flex items-center justify-between rounded-box border border-line-subtle bg-fill p-4">
          <div>
            <p className="text-body font-semibold text-content-primary">{currentTask.enabled ? 'Enabled' : 'Disabled'}</p>
            <p className="text-caption text-content-tertiary">
              {currentTask.enabled ? 'This task runs on schedule.' : 'This task is paused.'}
            </p>
          </div>
          <Switch
            checked={currentTask.enabled}
            onCheckedChange={handleToggle}
            disabled={toggle.isPending}
            aria-label={currentTask.enabled ? 'Pause this task' : 'Resume this task'}
          />
        </div>

        <div className="overflow-hidden rounded-box border border-line-subtle bg-fill">
          <DetailRow label="Schedule" value={describeSchedule(currentTask.schedule)} />
          <Separator />
          <DetailRow label="Next run" value={currentTask.next_run_at ? formatRelativeTime(currentTask.next_run_at) : '—'} />
          <Separator />
          <DetailRow label="Last run" value={currentTask.last_run_at ? formatRelativeTime(currentTask.last_run_at) : 'Never'} />
          {currentTask.last_status && (
            <>
              <Separator />
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-body-sm text-content-tertiary">Last status</span>
                <RunStatusBadge status={currentTask.last_status} />
              </div>
            </>
          )}
        </div>

        {/* A bare "failed" badge is a dead end — the reason is the only part
            the user can act on. */}
        {currentTask.last_error && (
          <div className="flex flex-col gap-2.5">
            <SectionLabel>Last error</SectionLabel>
            <div className="rounded-box border border-error/40 bg-error/10 p-4">
              <p className="selectable whitespace-pre-wrap font-mono text-caption leading-code text-error">
                {currentTask.last_error}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <SectionLabel>Prompt</SectionLabel>
          <div className="rounded-box border border-line-subtle bg-fill p-4">
            <p className="whitespace-pre-wrap text-body-sm leading-5 text-content-secondary">{promptText}</p>
          </div>
        </div>

        {runs.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <SectionLabel>Run history</SectionLabel>
            <div className="flex flex-col rounded-box border border-line-subtle bg-fill">
              {runs.map((entry, index) => (
                <div key={entry.id}>
                  {index > 0 && <Separator />}
                  <div className="flex flex-col gap-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-body-sm text-content-secondary">
                        {entry.startedAt ? formatRelativeTime(entry.startedAt) : 'Unknown time'}
                      </span>
                      <div className="flex items-center gap-2">
                        {entry.durationMs != null && (
                          <span className="text-caption tabular-nums text-content-muted">
                            {Math.round(entry.durationMs / 100) / 10}s
                          </span>
                        )}
                        <RunStatusBadge status={entry.status} />
                      </div>
                    </div>
                    {entry.error && (
                      <p className="selectable whitespace-pre-wrap font-mono text-caption leading-code text-error">
                        {entry.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <GradientButton onClick={handleRun} loading={run.isPending}>
            <Icon icon={PlayIcon} size={16} className="text-current" />
            Run now
          </GradientButton>
          <GhostButton onClick={() => setIsDeleteOpen(true)} className="border-error/40 bg-error/10 text-error">
            <Icon icon={Delete02Icon} size={16} className="text-current" />
            Delete task
          </GhostButton>
        </div>
      </div>

      <Dialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete task"
        description={`Delete "${currentTask.name || 'this task'}"? This cannot be undone.`}
      >
        <div className="flex justify-end gap-2">
          <GhostButton onClick={() => setIsDeleteOpen(false)}>Cancel</GhostButton>
          <GhostButton onClick={handleDeleteConfirm} disabled={isDeleting} className="border-error/40 bg-error/10 text-error">
            {isDeleting ? 'Deleting…' : 'Delete'}
          </GhostButton>
        </div>
      </Dialog>
    </div>
  )
}
