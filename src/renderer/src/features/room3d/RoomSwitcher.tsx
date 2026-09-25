import type { MouseEvent } from 'react'
import { IconButton } from '@/components/brand'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { useRoomStore } from '@/stores/room.store'
import type { RoomData } from '@/types'

function RoomChip({ room, isActive, canDelete }: { room: RoomData; isActive: boolean; canDelete: boolean }) {
  const setActiveRoom = useRoomStore((s) => s.setActiveRoom)
  const deleteRoom = useRoomStore((s) => s.deleteRoom)

  const handleContextMenu = (e: MouseEvent) => {
    if (!canDelete) return
    e.preventDefault()
    // Desktop has no long-press; right-click is the equivalent affordance for
    // a destructive secondary action on a chip (mirrors mobile's onLongPress).
    if (window.confirm(`Delete "${room.name}"?`)) deleteRoom(room.id)
  }

  return (
    <button
      type="button"
      onClick={() => setActiveRoom(room.id)}
      onContextMenu={handleContextMenu}
      title={canDelete ? 'Right-click to delete' : undefined}
      // The same shape and state language as `PillButton`: `.btn-pill` keys its
      // indigo off `aria-pressed`, which is also the honest thing to announce.
      aria-pressed={isActive}
      className="btn btn-sm btn-pill mr-2 shrink-0"
    >
      {room.name}
    </button>
  )
}

/**
 * Room chip row — mobile built this component but never mounted it (no room
 * for it on a phone screen alongside the header + agent bar). Desktop has
 * the width to spare, so RoomScreen mounts it below the header.
 */
export function RoomSwitcher() {
  const rooms = useRoomStore((s) => s.rooms)
  const activeRoomId = useRoomStore((s) => s.activeRoomId)
  const addRoom = useRoomStore((s) => s.addRoom)

  const handleAddRoom = () => {
    addRoom(`Room ${rooms.length + 1}`)
  }

  return (
    <div className="flex items-center overflow-x-auto">
      {rooms.map((room) => (
        <RoomChip
          key={room.id}
          room={room}
          isActive={room.id === activeRoomId}
          canDelete={room.id !== 'main' && rooms.length > 1}
        />
      ))}
      <IconButton
        icon={PlusSignIcon}
        label="New room"
        onClick={handleAddRoom}
        shape="circle"
        tone="filled"
        className="shrink-0"
      />
    </div>
  )
}
