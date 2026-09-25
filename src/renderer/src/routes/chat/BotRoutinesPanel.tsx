import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Add01Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import { GhostButton, GradientButton, PillButton, Spinner } from '@/components/brand'
import { EmptyState, TextField, useToast } from '@/components/patterns'
import { Dialog, Icon, Select } from '@/components/primitives'
import { TaskCard } from '@/components/tasks'
import { errorMessage, useTaskMutations, useTasks } from '@/hooks'
import { botIdOfTask } from '@/services/local-tasks'

/**
 * A bot's routines — the work it does without being asked.
 *
 * A routine is a cron job pointed at this bot's own thread, so its result
 * arrives in the conversation the user already reads rather than in a task log
 * they have to go looking for. That is the whole difference between "a
 * scheduled job ran" and "your inbox manager reported in".
 */

/** Grok Bot's cap, and a sensible one: fifty routines is already a lot of Mac. */
const MAX_ROUTINES_PER_BOT = 50

const INTERVALS = [
  { value: String(15 * 60_000), label: 'Every 15 minutes' },
  { value: String(60 * 60_000), label: 'Hourly' },
  { value: String(4 * 60 * 60_000), label: 'Every 4 hours' },
  { value: String(24 * 60 * 60_000), label: 'Daily' },
  { value: String(7 * 24 * 60 * 60_000), label: 'Weekly' },
]

export function BotRoutinesPanel({ botId, botName }: { botId: string; botName: string }) {
  const navigate = useNavigate()
  const { show } = useToast()
  const { data: tasks, isLoading } = useTasks()
  const { toggle, run, remove, create } = useTaskMutations()

  const [composing, setComposing] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [everyMs, setEveryMs] = useState(INTERVALS[3]!.value)

  const routines = useMemo(
    () => (tasks ?? []).filter((task) => botIdOfTask(task) === botId),
    [tasks, botId],
  )

  const full = routines.length >= MAX_ROUTINES_PER_BOT

  function submit(): void {
    if (!name.trim() || !prompt.trim()) return
    create.mutate(
      { name: name.trim(), prompt: prompt.trim(), skillId: null, botId, everyMs: Number(everyMs) },
      {
        onSuccess: () => {
          setComposing(false)
          setName('')
          setPrompt('')
          show({ title: 'Routine added', variant: 'success' })
        },
        onError: (error) =>
          show({ title: 'Could not add routine', description: errorMessage(error), variant: 'error' }),
      },
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={22} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4">
        <p className="text-caption text-content-tertiary">
          {routines.length === 0
            ? 'Nothing scheduled yet'
            : `${routines.length} of ${MAX_ROUTINES_PER_BOT}`}
        </p>
        <PillButton variant="cta" disabled={full} onClick={() => setComposing(true)}>
          <Icon icon={Add01Icon} size={13} className="text-current" />
          New routine
        </PillButton>
      </div>

      {routines.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={<Icon icon={Clock01Icon} size={44} className="text-content-disabled" />}
            title="No routines yet"
            description={`Anything ${botName} does more than once belongs here — it runs on its own and reports back in this thread.`}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
          {routines.map((task) => (
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
                        title: 'Could not update routine',
                        description: errorMessage(error),
                        variant: 'error',
                      }),
                  },
                )
              }
              onRun={() =>
                run.mutate(task.cron_job_id, {
                  // Grok Bot's own warning, and it is the right one: a test run
                  // is a real run. It browses, writes files and calls tools.
                  onSuccess: () => show({ title: 'Running now — this does real work', variant: 'success' }),
                  onError: (error) =>
                    show({
                      title: 'Could not run routine',
                      description: errorMessage(error),
                      variant: 'error',
                    }),
                })
              }
              onDelete={() =>
                remove.mutate(task.cron_job_id, {
                  onError: (error) =>
                    show({
                      title: 'Could not delete routine',
                      description: errorMessage(error),
                      variant: 'error',
                    }),
                })
              }
            />
          ))}
        </div>
      )}

      {composing && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setComposing(false)
          }}
          title={`New routine for ${botName}`}
          description="It runs on its own and answers in this thread."
        >
          <div className="flex flex-col gap-4">
            <TextField label="Name" value={name} onChange={setName} placeholder="Morning triage" autoFocus />
            <TextField
              label="What should it do?"
              value={prompt}
              onChange={setPrompt}
              placeholder="Triage everything that arrived overnight and tell me what needs me."
              multiline
              rows={4}
            />
            <Select
              label="How often"
              value={everyMs}
              onValueChange={setEveryMs}
              items={INTERVALS}
            />
            <p className="text-caption text-content-faint">
              Runs are real: this bot will browse, write files and call tools exactly as it does when
              you ask it to. Say in its guidelines where it must stop.
            </p>
            <div className="flex justify-end gap-2">
              <GhostButton onClick={() => setComposing(false)}>Cancel</GhostButton>
              <GradientButton
                onClick={submit}
                disabled={!name.trim() || !prompt.trim()}
                loading={create.isPending}
              >
                Add routine
              </GradientButton>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
