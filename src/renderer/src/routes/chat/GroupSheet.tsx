import { useState } from 'react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import type { BotSummary } from '@shared/ipc'
import { GhostButton, GradientButton } from '@/components/brand'
import { BotAvatar } from '@/components/chat'
import { TextField } from '@/components/patterns'
import { Dialog, Icon } from '@/components/primitives'
import { cn } from '@/lib/cn'
import {
  MAX_GROUP_BOTS,
  MIN_GROUP_BOTS,
  groupNameFor,
  useGroupsStore,
} from '@/stores/groups.store'

/**
 * New group — pick two to six bots.
 *
 * The name is optional and pre-filled from who is in it, because naming a group
 * before you have used it is a decision nobody has the information to make.
 */
export function GroupSheet({
  open,
  bots,
  onClose,
  onCreated,
}: {
  open: boolean
  bots: BotSummary[]
  onClose: () => void
  onCreated: (groupId: string) => void
}) {
  const create = useGroupsStore((state) => state.create)
  // No reset effect: the parent mounts this only while it is open, so a fresh
  // instance *is* the reset. An effect that cleared state on `open` would
  // cascade a render every time the dialog appeared.
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')

  const chosen = bots.filter((bot) => selected.includes(bot.id))
  const suggested = groupNameFor(chosen.map((bot) => bot.name))
  const full = selected.length >= MAX_GROUP_BOTS

  function toggle(id: string): void {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : current.length >= MAX_GROUP_BOTS
          ? current
          : [...current, id],
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New group"
      description={`Two to six bots in one thread. Address one with @, or ask the room.`}
    >
      <div className="flex flex-col gap-4">
        <div className="max-h-72 overflow-y-auto rounded-box border border-line">
          {bots.map((bot) => {
            const picked = selected.includes(bot.id)
            return (
              <button
                key={bot.id}
                type="button"
                onClick={() => toggle(bot.id)}
                disabled={!picked && full}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  picked ? 'bg-fill-accent' : 'hover:bg-fill-raised',
                  !picked && full && 'opacity-40',
                )}
              >
                <BotAvatar
                  id={bot.id}
                  name={bot.name}
                  emoji={bot.emoji}
                  avatar={bot.avatar}
                  size={28}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm text-content-primary">
                    {bot.name}
                  </span>
                  <span className="block truncate text-caption text-content-tertiary">
                    {bot.job}
                  </span>
                </span>
                {picked && (
                  <Icon icon={CheckmarkCircle02Icon} size={17} className="shrink-0 text-primary" />
                )}
              </button>
            )
          })}
        </div>

        <TextField label="Name" value={name} onChange={setName} placeholder={suggested} />

        {full && (
          <p className="text-caption text-content-faint">
            Six is the cap. Every member answers every turn, so a bigger room costs more and reads
            worse.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GradientButton
            disabled={selected.length < MIN_GROUP_BOTS}
            onClick={() => {
              const group = create(name.trim() || suggested, selected)
              onCreated(group.id)
              onClose()
            }}
          >
            Create group
          </GradientButton>
        </div>
      </div>
    </Dialog>
  )
}
