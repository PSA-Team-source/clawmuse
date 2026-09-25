import { Component, useCallback, useState } from 'react'
import { IconButton } from '@/components/brand'
import type { ReactNode } from 'react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { useModeStore } from '@/stores/mode.store'
import { RoomCanvas } from './RoomCanvas'
import { BasicModeView } from './BasicModeView'
import { ModeToggle } from './ModeToggle'
import { RoomSwitcher } from './RoomSwitcher'
import { AgentBoomBar } from './AgentBoomBar'
import { AddAgentSheet } from './AddAgentSheet'
import { RoomLoadingOverlay } from './RoomLoadingOverlay'

interface BoundaryState {
  failed: boolean
}
interface BoundaryProps {
  fallback: ReactNode
  children: ReactNode
}

/** Ported verbatim from mobile's RoomScreen.tsx: a WebGL context failure (lost
 *  context, driver crash, unsupported GPU) falls back to the flat agent list
 *  instead of a blank/broken canvas. */
class GLBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * Room3D orchestrator — the desktop counterpart of mobile's RoomScreen.tsx,
 * minus the ChatPanel: per this repo's CLAUDE.md, ClawMuse's only surface is
 * the 3D room; chat lives in the separate OpenClaw control-UI iframe, not a
 * panel owned by this feature. Selecting an agent here updates the shared
 * room store (`selectSkill`) and forwards to `onSelectSkill`, which a host
 * shell can use to route to that chat surface — this component doesn't know
 * or need to know how that happens.
 */
export function RoomScreen({ onSelectSkill }: { onSelectSkill?: (skillId: string) => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const mode = useModeStore((s) => s.mode)

  // True once the 3D engine has mounted onto its canvas (RoomCanvas.onReady).
  // The "AGENT ROOM" title + agent bar only appear once the room has actually
  // rendered — not during the INITIALIZING splash.
  const [ready, setReady] = useState(false)

  // Reset readiness when the view mode changes — "adjust state during render"
  // (React's documented pattern for derived state, avoids a setState-in-effect
  // cascade). Re-entering 3D then shows the INITIALIZING splash again until
  // RoomCanvas.onReady fires, same as mobile.
  const [prevMode, setPrevMode] = useState(mode)
  if (prevMode !== mode) {
    setPrevMode(mode)
    if (mode !== '3d') setReady(false)
  }

  const handleSelectSkill = useCallback((skillId: string) => onSelectSkill?.(skillId), [onSelectSkill])
  const handleReady = useCallback(() => setReady(true), [])

  const show3DChrome = mode === '3d' && ready

  return (
    <div className="relative h-full w-full bg-bg-base">
      {/* Full-bleed content layer — the 3D background fills edge to edge; the
          header floats on top of it. */}
      {mode === 'basic' ? (
        <BasicModeView onSelectSkill={handleSelectSkill} topInset={64} />
      ) : (
        <GLBoundary fallback={<BasicModeView onSelectSkill={handleSelectSkill} topInset={64} />}>
          <RoomCanvas onSelectSkill={handleSelectSkill} active={mode === '3d'} onReady={handleReady} />
        </GLBoundary>
      )}

      {/* Persistent "AGENT ROOM" title (web/mobile parity) — 3D mode only, own
          row so it never collides with the header controls. */}
      {show3DChrome && (
        <div className="pointer-events-none absolute left-0 right-0 top-[76px] flex items-center justify-center">
          <span
            className="font-display text-micro tracking-display-wider text-content-tertiary"
            style={{ textShadow: '0 0 14px rgba(100,200,255,0.4)' }}
          >
            AGENT ROOM
          </span>
        </div>
      )}

      {/* Floating header: room switcher (left, scrollable) + Simple/3D toggle +
          add-agent button (right). */}
      <div className="absolute left-0 right-0 top-3 z-10 flex items-center justify-between gap-3 px-4">
        <div className="min-w-0 flex-1">
          <RoomSwitcher />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ModeToggle />
          <IconButton
            icon={PlusSignIcon}
            label="Add agent"
            onClick={() => setShowAdd(true)}
            shape="circle"
            className="border-transparent bg-primary text-white shadow-overlay hover:bg-primary-dark"
          />
        </div>
      </div>

      {/* Bottom agent bar — 3D mode only, floats above the window chrome. */}
      {show3DChrome && (
        <div className="pointer-events-none absolute bottom-2.5 left-0 right-0">
          <div className="pointer-events-auto">
            <AgentBoomBar onSelectSkill={handleSelectSkill} />
          </div>
        </div>
      )}

      {/* INITIALIZING splash — only relevant in 3D mode. */}
      {mode === '3d' && <RoomLoadingOverlay visible={!ready} />}

      {showAdd && <AddAgentSheet onClose={() => setShowAdd(false)} />}
    </div>
  )
}
