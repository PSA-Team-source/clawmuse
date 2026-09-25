import type { BotSummary } from '@shared/ipc'
import { BotAvatar } from '@/components/chat'
import { cn } from '@/lib/cn'
import { type BotGroup, useGroupsStore } from '@/stores/groups.store'

/** Groups the roster shows, newest first. */
export function useGroups(): BotGroup[] {
  return useGroupsStore((state) => state.groups)
}

/**
 * One group in the roster.
 *
 * Stacked faces rather than a generic group glyph: the only question this row
 * has to answer at a glance is *who is in it*, and three overlapping avatars
 * answer it without a line of text.
 */
export function GroupRow({
  group,
  bots,
  active,
  onSelect,
}: {
  group: BotGroup
  bots: BotSummary[]
  active: boolean
  onSelect: () => void
}) {
  const members = group.members
    .map((id) => bots.find((bot) => bot.id === id))
    .filter((bot): bot is BotSummary => Boolean(bot))

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-field py-2.5 pl-2.5 pr-3 text-left transition-colors',
        active ? 'bg-fill-accent' : 'hover:bg-fill-raised',
      )}
    >
      <div className="flex w-[34px] shrink-0 -space-x-2">
        {members.slice(0, 3).map((bot) => (
          <BotAvatar
            key={bot.id}
            id={bot.id}
            name={bot.name}
            emoji={bot.emoji}
            avatar={bot.avatar}
            size={22}
            className="ring-1 ring-bg-surface"
          />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-semibold text-content-primary">
          {group.name}
        </span>
        {/* A group whose members were all deleted says nothing rather than
            "No members", which reads as a failure to load them. */}
        {members.length > 0 && (
          <span className="block truncate text-caption text-content-tertiary">
            {members.map((bot) => bot.name).join(', ')}
          </span>
        )}
      </div>
    </button>
  )
}
