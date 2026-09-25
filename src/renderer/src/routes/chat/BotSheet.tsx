import { useEffect, useState } from 'react'
import type { BotDraft, BotPermissions, BotSummary } from '@shared/ipc'
import { GhostButton, GradientButton } from '@/components/brand'
import { TextField } from '@/components/patterns'
import { Dialog, SegmentedControl } from '@/components/primitives'

/**
 * New bot / Edit profile.
 *
 * Three fields, because three is what it takes to brief a colleague: what to
 * call them, the one job they own, and how they should go about it. Anything
 * more is a workflow builder, which is the thing this product exists not to be.
 *
 * The guidelines box is the honest home for boundaries. They are prose, they go
 * into the bot's `AGENTS.md`, and they are advisory — the hard stops are tool
 * policy and the approval prompt, not a sentence. The placeholder says so by
 * example rather than by disclaimer.
 */

const GUIDELINES_PLACEHOLDER = [
  'How should this bot work?',
  '',
  'e.g. Draft replies in my voice, never send. Ask before spending anything.',
  'Report back with what changed and what is still open.',
].join('\n')

export function BotSheet({
  open,
  bot,
  onClose,
  onSubmit,
}: {
  open: boolean
  /** `null` creates; a bot edits it in place. */
  bot: BotSummary | null
  onClose: () => void
  onSubmit: (draft: BotDraft) => Promise<{ ok: boolean; error?: string }>
}) {
  // Initialised from the bot rather than reset in an effect: the parent mounts
  // this only while it is open, so a fresh instance is the reset.
  const [name, setName] = useState(bot?.name ?? '')
  const [job, setJob] = useState(bot?.job ?? '')
  const [emoji, setEmoji] = useState(bot?.emoji ?? '')
  const [guidelines, setGuidelines] = useState('')
  const [permissions, setPermissions] = useState<BotPermissions>(bot?.permissions ?? 'full')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Editing loads the bot's own words back out of its `AGENTS.md`, so saving
  // does not quietly replace instructions the user cannot see in the form.
  // This one reads an external system, which is what an effect is for.
  useEffect(() => {
    if (!bot) return
    let cancelled = false
    void window.clawmuse.runtime.botsGuidelines(bot.id).then((text) => {
      if (!cancelled) setGuidelines(text)
    })
    return () => {
      cancelled = true
    }
  }, [bot])

  async function submit(): Promise<void> {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    const result = await onSubmit({
      name: name.trim(),
      job: job.trim(),
      guidelines,
      permissions,
      ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
    })
    setSaving(false)
    if (result.ok) onClose()
    else setError(result.error ?? 'Could not save')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={bot ? 'Edit profile' : 'New bot'}
      description={
        bot
          ? undefined
          : 'A bot is a teammate you message. Give it one job and it keeps its own memory of it.'
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="w-20">
            <TextField label="Emoji" value={emoji} onChange={setEmoji} placeholder="📥" />
          </div>
          <div className="flex-1">
            <TextField
              label="Name"
              value={name}
              onChange={setName}
              placeholder="Inbox Manager"
              autoFocus
            />
          </div>
        </div>

        <TextField
          label="One primary job"
          value={job}
          onChange={setJob}
          placeholder="keeps the inbox triaged and nothing waiting on a reply"
        />

        <TextField
          label="Operating guidelines"
          value={guidelines}
          onChange={setGuidelines}
          placeholder={GUIDELINES_PLACEHOLDER}
          multiline
          rows={7}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-content-tertiary">What it may do</span>
          <SegmentedControl
            aria-label="Permissions"
            value={permissions}
            onValueChange={setPermissions}
            items={[
              { value: 'full', label: 'Everything' },
              { value: 'read-only', label: 'Read & draft' },
            ]}
          />
          <p className="text-caption text-content-faint">
            {permissions === 'read-only'
              ? 'It can read, browse and draft. No file writes and no shell — enforced, not requested.'
              : 'Files, shell and browser. Say in the guidelines where it must stop and ask.'}
          </p>
        </div>

        {error && <p className="text-body-sm text-error">{error}</p>}

        {!bot && (
          <p className="text-caption text-content-faint">
            The agent restarts nothing and nobody signs in — the bot exists as soon as you save.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GradientButton onClick={() => void submit()} disabled={!name.trim()} loading={saving}>
            {bot ? 'Save' : 'Create bot'}
          </GradientButton>
        </div>
      </div>
    </Dialog>
  )
}
