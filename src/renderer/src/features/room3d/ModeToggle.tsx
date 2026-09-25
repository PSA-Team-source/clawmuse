import { CubeIcon, DashboardSquare01Icon } from '@hugeicons/core-free-icons'
import { SegmentedControl } from '@/components/primitives'
import { useModeStore, type RoomMode } from '@/stores/mode.store'

const MODES = [
  { value: 'basic' as RoomMode, label: 'Simple', icon: DashboardSquare01Icon },
  { value: '3d' as RoomMode, label: '3D', icon: CubeIcon },
]

/** Switches the Agent Room between the flat list and the 3D scene. */
export function ModeToggle() {
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)

  return (
    <SegmentedControl
      aria-label="Room view"
      value={mode}
      onValueChange={setMode}
      items={MODES}
    />
  )
}
