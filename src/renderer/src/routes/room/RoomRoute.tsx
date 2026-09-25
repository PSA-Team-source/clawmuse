import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RoomScreen } from '@/features/room3d'
import { useRoomRealtime } from '@/hooks'
import { useChatStore } from '@/stores/chat.store'
import { useRoomStore } from '@/stores/room.store'

/**
 * Thin host for the 3D room: wires live task counts into the room store (so
 * character name-plates show pending work) and hands the rest off to
 * `RoomScreen`, which owns the actual three.js canvas and its own layout.
 *
 * Picking a character is the room's whole point, so this is also where the
 * selection turns into a conversation. `createSession` derives the id
 * `webchat:skill:<skillId>` — the same key the canvas reads to decide whether a
 * character shows its "thinking" glow — so opening a chat from the room lands
 * on that agent's existing thread instead of forking a new one each click.
 */
export default function RoomRoute() {
  useRoomRealtime(useRoomStore.getState().setTaskCounts)

  const navigate = useNavigate()
  const createSession = useChatStore((state) => state.createSession)

  const handleSelectSkill = useCallback(
    (skillId: string) => {
      navigate(`/chat/${encodeURIComponent(createSession({ skillId }))}`)
    },
    [createSession, navigate],
  )

  return (
    <div className="h-full w-full">
      <RoomScreen onSelectSkill={handleSelectSkill} />
    </div>
  )
}
