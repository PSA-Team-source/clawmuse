import { useMemo } from 'react'
import { roomToCharacters, useRoomStore } from '@/stores/room.store'
import type { GameCharacter } from '@/types'
import { cn } from '@/lib/cn'

// Bottom agent bar (web/mobile parity): a hint line + a horizontal row of
// agent cards (name in the agent's accent colour + body class), shown over
// the 3D room. Clicking a card selects that agent — the same action as
// clicking the agent directly in the 3D scene.

function BoomCard({
  char,
  active,
  onSelect,
}: {
  char: GameCharacter
  active: boolean
  onSelect: () => void
}) {
  const accent = char.color
  const cls = char.bodyStyle.charAt(0).toUpperCase() + char.bodyStyle.slice(1)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'mr-3 w-[150px] shrink-0 overflow-hidden rounded-box border bg-room-void/85 text-left',
        // Only the selected card's border is the agent's accent, so that colour
        // stays dynamic; the resting border is the shared hairline.
        !active && 'border-line-subtle',
      )}
      style={active ? { borderColor: accent } : undefined}
    >
      {/* accent top bar (3px when active, 2px otherwise) */}
      <div style={{ height: active ? 3 : 2, backgroundColor: accent, opacity: active ? 1 : 0.4 }} />
      <div className="px-4 py-3">
        <div
          className="mb-1.5 truncate font-display text-micro tracking-display"
          style={{ color: accent }}
        >
          {char.name.toUpperCase()}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-caption tracking-wide text-content-muted">{cls}</span>
          {char.taskCount > 0 && (
            <span
              className="rounded-field px-1.5 py-px text-micro font-bold text-white"
              style={{ backgroundColor: accent }}
            >
              {char.taskCount}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function AgentBoomBar({ onSelectSkill }: { onSelectSkill: (skillId: string) => void }) {
  const rooms = useRoomStore((s) => s.rooms)
  const activeRoomId = useRoomStore((s) => s.activeRoomId)
  const taskCounts = useRoomStore((s) => s.taskCounts)
  const selectedSkillId = useRoomStore((s) => s.selectedSkillId)

  const characters = useMemo(() => {
    const room = rooms.find((r) => r.id === activeRoomId) ?? rooms[0]
    return room ? roomToCharacters(room, taskCounts) : []
  }, [rooms, activeRoomId, taskCounts])

  if (characters.length === 0) return null

  return (
    <div>
      <p className="mb-2.5 text-center text-micro tracking-display-wide text-content-faint">
        CLICK TO SELECT · SCROLL TO ZOOM
      </p>
      <div className="flex overflow-x-auto px-4 pb-1">
        {characters.map((char) => (
          <BoomCard
            key={char.skillId}
            char={char}
            active={selectedSkillId === char.skillId}
            onSelect={() => {
              useRoomStore.getState().selectSkill(char.skillId)
              onSelectSkill(char.skillId)
            }}
          />
        ))}
      </div>
    </div>
  )
}
