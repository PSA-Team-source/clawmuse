import { useMemo } from 'react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { IconButton } from '@/components/brand'
import { EmptyState } from '@/components/patterns'
import { CLAWMUSE_SKILL_ID, roomToCharacters, useRoomStore } from '@/stores/room.store'
import type { GameCharacter } from '@/types'
import { cn } from '@/lib/cn'

function AgentCard({
  char,
  selected,
  onSelect,
  onRemove,
}: {
  char: GameCharacter
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const removable = char.skillId !== CLAWMUSE_SKILL_ID
  return (
    // The card is the button and the remove control is a *second* button, so
    // the wrapper is a div: interactive content nested inside a <button> is
    // invalid HTML, which is why the remove affordance had been a
    // `<span role="button">` with hand-written Enter/Space handling and a 17px
    // hit area that no pointer could reliably find.
    <div
      className={cn(
        'relative mb-2.5 w-full rounded-box border',
        !selected && 'border-line bg-fill',
      )}
      style={
        selected ? { backgroundColor: char.color + '22', borderColor: char.color } : undefined
      }
    >
      {removable && (
        <IconButton
          icon={Cancel01Icon}
          label={`Remove ${char.name}`}
          size="xs"
          shape="circle"
          onClick={onRemove}
          className="absolute right-2 top-2 z-1"
        />
      )}
      <button type="button" onClick={onSelect} className="block w-full p-3.5 text-left">
      <div className="flex items-center gap-2.5 pr-6">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: char.color + '33' }}
        >
          <span className="text-body font-bold" style={{ color: char.color }}>
            {char.name.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-content-primary">{char.name}</p>
        </div>
      </div>
      {!!char.description && (
        <p className="mt-2 line-clamp-2 text-caption text-content-muted">{char.description}</p>
      )}
      {char.taskCount > 0 && (
        <span
          className="mt-2 inline-block rounded-full px-2 py-0.5 text-micro font-bold text-room-void"
          style={{ backgroundColor: char.color }}
        >
          {char.taskCount} task{char.taskCount > 1 ? 's' : ''}
        </span>
      )}
      </button>
    </div>
  )
}

export function BasicModeView({
  onSelectSkill,
  topInset = 0,
}: {
  onSelectSkill: (skillId: string) => void
  /** Top padding so cards clear the floating header. */
  topInset?: number
}) {
  const rooms = useRoomStore((s) => s.rooms)
  const activeRoomId = useRoomStore((s) => s.activeRoomId)
  const taskCounts = useRoomStore((s) => s.taskCounts)
  const selectedSkillId = useRoomStore((s) => s.selectedSkillId)

  const characters = useMemo(() => {
    const room = rooms.find((r) => r.id === activeRoomId) ?? rooms[0]
    return room ? roomToCharacters(room, taskCounts) : []
  }, [rooms, activeRoomId, taskCounts])

  if (characters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center" style={{ paddingTop: topInset }}>
        <EmptyState
          icon={<span className="text-4xl">🦞</span>}
          title="No agents yet"
          description="Add an agent to get started."
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-3" style={{ paddingTop: topInset + 12, paddingBottom: 96 }}>
      <p className="mb-3 px-1 text-footnote font-medium text-content-muted">Agents</p>
      {characters.map((char) => (
        <AgentCard
          key={char.skillId}
          char={char}
          selected={selectedSkillId === char.skillId}
          onSelect={() => {
            useRoomStore.getState().selectSkill(char.skillId)
            onSelectSkill(char.skillId)
          }}
          onRemove={() => useRoomStore.getState().removeCharacterFromRoom(char.skillId)}
        />
      ))}
    </div>
  )
}
