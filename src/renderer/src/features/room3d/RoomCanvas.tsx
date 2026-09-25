import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { roomToCharacters, useRoomStore } from '@/stores/room.store'
import { useChatStore } from '@/stores/chat.store'
import { gameCharToSceneData } from '@/features/room3d/engine/scene-data'
import { useRoomEngine } from '@/features/room3d/useRoomEngine'
import { useRoomControls } from '@/features/room3d/useRoomControls'
import { pickVisibleLabels } from '@/features/room3d/engine/labels'
import { LabelOverlay } from '@/features/room3d/LabelOverlay'
import type { Anchor, LabelVM } from '@/features/room3d/engine/labels'

function labelsEqual(a: LabelVM[], b: LabelVM[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    const bi = b[i]!
    if (
      ai.skillId !== bi.skillId ||
      Math.round(ai.xPx) !== Math.round(bi.xPx) ||
      Math.round(ai.yPx) !== Math.round(bi.yPx) ||
      ai.taskCount !== bi.taskCount
    ) {
      return false
    }
  }
  return true
}

export function RoomCanvas({
  onSelectSkill,
  active,
  onReady,
}: {
  onSelectSkill: (skillId: string) => void
  /** False while the room is not the visible view (e.g. Simple/3D mode
   *  toggled away) — pauses the render loop without disposing the engine. */
  active: boolean
  /** Fired once the engine has mounted onto the canvas (first real size from
   *  ResizeObserver) — lets RoomScreen dismiss its INITIALIZING splash. */
  onReady?: () => void
}) {
  const rooms = useRoomStore((s) => s.rooms)
  const activeRoomId = useRoomStore((s) => s.activeRoomId)
  const taskCounts = useRoomStore((s) => s.taskCounts)
  const isTyping = useChatStore((s) => s.isTyping)

  // `useRoomStore.getState().characters()` allocates a fresh array + fresh
  // character objects on every call, so calling it directly inside a zustand
  // selector would make every downstream useCallback/useEffect see a "new"
  // value on every store update (including unrelated ones) — memoize on the
  // store's actually-stable primitives instead.
  const characters = useMemo(() => {
    const room = rooms.find((r) => r.id === activeRoomId) ?? rooms[0]
    return room ? roomToCharacters(room, taskCounts) : []
  }, [rooms, activeRoomId, taskCounts])

  const getCharData = useCallback(
    () =>
      characters.map((c, i) =>
        gameCharToSceneData(c, i, c.taskCount, !!isTyping['webchat:skill:' + c.skillId]),
      ),
    [characters, isTyping],
  )

  const handleSelectIndex = useCallback(
    (idx: number) => {
      const c = useRoomStore.getState().characters()[idx]
      if (!c) return
      useRoomStore.getState().selectSkill(c.skillId)
      onSelectSkill(c.skillId)
    },
    [onSelectSkill],
  )

  // Label overlay state, driven from the engine's SINGLE rAF loop via onFrame
  // (no second rAF — see engine.ts's doc comment on this).
  const [labels, setLabels] = useState<LabelVM[]>([])
  const lastLabelsRef = useRef<LabelVM[]>([])
  const frameTickRef = useRef(0)

  const updateLabels = useCallback((anchors: Anchor[]) => {
    // Throttle to every other frame — label positions don't need 60fps and this
    // halves the React setState/reconcile work driven by the render loop.
    if ((frameTickRef.current++ & 1) !== 0) return
    const state = useRoomStore.getState()
    const next = pickVisibleLabels(anchors, state.characters(), state.taskCounts)
    if (!labelsEqual(next, lastLabelsRef.current)) {
      lastLabelsRef.current = next
      setLabels(next)
    }
  }, [])

  const { engineRef, mount, resize } = useRoomEngine(getCharData, handleSelectIndex, updateLabels)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mountedRef = useRef(false)

  useRoomControls(canvasRef, engineRef)

  // Always-current mirrors of `active`/`onReady`, read from the ResizeObserver
  // callback below so a first-mount that happens while `active` is already
  // false starts the engine paused instead of a beat later. Written in an
  // effect (not during render) — mutating a ref while rendering is a React
  // footgun even though the value itself doesn't affect this render's output.
  const activeRef = useRef(active)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    activeRef.current = active
    onReadyRef.current = onReady
  }, [active, onReady])

  // Mount the engine once the container has a real size, then keep it in sync
  // via ResizeObserver — desktop's replacement for RN's onLayout.
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width === 0 || height === 0) return
      if (!mountedRef.current) {
        mountedRef.current = true
        mount(canvas, width, height)
        engineRef.current?.setPaused(!activeRef.current)
        onReadyRef.current?.()
      } else {
        resize(width, height)
      }
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      mountedRef.current = false
    }
    // mount/resize hold no dependencies of their own (useRoomEngine reaches the
    // changing callbacks through refs), so this effect runs once per canvas and
    // the engine is never rebuilt underneath it; engineRef/activeRef/onReadyRef
    // are refs and never need to appear here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mount, resize])

  // Pause when the room stops being the active view; complements the
  // visibilitychange-based pause inside useRoomEngine (tab hidden).
  useEffect(() => {
    engineRef.current?.setPaused(!active)
  }, [active, engineRef])

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <LabelOverlay labels={labels} />
    </div>
  )
}
