import { useMemo, useState } from 'react'
import { GhostButton, GradientButton } from '@/components/brand'
import { TextField, useToast } from '@/components/patterns'
import { Dialog } from '@/components/primitives'
import { Select } from '@/components/primitives'
import { errorMessage, useTaskMutations } from '@/hooks'
import { useSkillsStore } from '@/stores/skills.store'

/**
 * Intervals people actually pick. Anything finer than a minute is a stress
 * test, not a schedule, and the gateway measures in milliseconds.
 */
const INTERVALS = [
  { label: 'Every 15 minutes', ms: 15 * 60_000 },
  { label: 'Hourly', ms: 60 * 60_000 },
  { label: 'Every 6 hours', ms: 6 * 60 * 60_000 },
  { label: 'Daily', ms: 24 * 60 * 60_000 },
  { label: 'Weekly', ms: 7 * 24 * 60 * 60_000 },
] as const

interface NewTaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-selects an agent when opened from that agent's thread. */
  defaultSkillId?: string | null
}

export function NewTaskModal({ open, onOpenChange, defaultSkillId = null }: NewTaskModalProps) {
  const { show } = useToast()
  const { create } = useTaskMutations()
  const skills = useSkillsStore((state) => state.skills)

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [skillId, setSkillId] = useState<string | null>(defaultSkillId)
  const [everyMs, setEveryMs] = useState<number>(24 * 60 * 60_000)

  // A task can run in an isolated session, so naming an agent is optional.
  const canSubmit = prompt.trim().length > 0

  // Only agents that are actually on can run work; offering a disabled one
  // would schedule a task that silently never fires.
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills])

  function reset() {
    setName('')
    setPrompt('')
    setSkillId(defaultSkillId)
    setEveryMs(24 * 60 * 60_000)
  }

  function handleSubmit() {
    const trimmedPrompt = prompt.trim()
    create.mutate(
      {
        // An unnamed task still needs a label in the list; the first line of
        // the instruction is what the user would have typed anyway.
        name: name.trim() || trimmedPrompt.split('\n')[0]!.slice(0, 80),
        prompt: trimmedPrompt,
        skillId,
        everyMs,
      },
      {
        onSuccess: () => {
          show({ title: 'Task scheduled', variant: 'success' })
          reset()
          onOpenChange(false)
        },
        onError: (error) =>
          show({
            title: 'Could not create task',
            description: errorMessage(error),
            variant: 'error',
          }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New task">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-caption font-medium text-content-secondary" htmlFor="task-prompt">
            What should the agent do?
          </label>
          <textarea
            id="task-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            placeholder="Check yesterday's ad spend and summarise anything unusual"
            className="selectable resize-none rounded-field border border-line bg-bg-surface p-3 text-body text-content-primary outline-none focus:border-primary/60"
          />
        </div>

        <TextField
          label="Name (optional)"
          value={name}
          onChange={setName}
          placeholder="Daily spend check"
        />

        <Select
          id="task-agent"
          label="Agent (optional)"
          value={skillId ?? ''}
          onValueChange={(next) => setSkillId(next || null)}
          // "No agent" is the empty value, and an empty value renders the
          // placeholder rather than the item's label — so the placeholder has
          // to carry the meaning or the field reads as blank.
          placeholder="No agent (isolated run)"
          items={[
            {
              value: '',
              label: 'No agent (isolated run)',
            },
            ...enabledSkills.map((skill) => ({
              value: skill.skillKey,
              label: skill.name || skill.skillKey,
            })),
          ]}
        />

        <Select
          id="task-interval"
          label="How often"
          value={String(everyMs)}
          onValueChange={(next) => setEveryMs(Number(next))}
          items={INTERVALS.map((interval) => ({
            value: String(interval.ms),
            label: interval.label,
          }))}
        />

        <div className="flex justify-end gap-2">
          <GhostButton onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </GhostButton>
          <GradientButton onClick={handleSubmit} disabled={!canSubmit} loading={create.isPending}>
            Schedule task
          </GradientButton>
        </div>
      </div>
    </Dialog>
  )
}
