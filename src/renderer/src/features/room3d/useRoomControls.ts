import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { RoomEngine } from '@/features/room3d/engine/engine'

/** Cumulative pointer movement (px) below which a pointerdown→pointerup is a
 *  click, not a drag — mirrors the small built-in slop of a touch tap gesture. */
const DRAG_THRESHOLD_PX = 4
/** Wheel deltaY → zoom-factor sensitivity for a physical mouse wheel notch. */
const WHEEL_SENSITIVITY = 0.0015
/** macOS reports trackpad pinch as `wheel` events with `ctrlKey: true` and much
 *  smaller per-event deltaY than a wheel notch, so it needs its own (larger)
 *  sensitivity to feel comparable in speed. */
const PINCH_SENSITIVITY = 0.02

interface DragState {
  active: boolean
  moved: boolean
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
}

/**
 * Mouse/trackpad controls for the room canvas — the desktop equivalent of the
 * mobile source's react-native-gesture-handler Pan/Pinch/Tap gestures:
 *   - Left-drag         → pan    (`engine.panBy`, incremental per-move delta)
 *   - Wheel / trackpad   → zoom   (`engine.zoomBy`; clamped inside the engine
 *                                  to [0.5, 2.5]× — see engine.ts MIN/MAX_ZOOM)
 *   - Click (no drag)   → select (`engine.raycastAt`, which fires the engine's
 *                                  own `onSelect` callback)
 *   - Hover             → cursor swaps to 'pointer' over a character
 *                                  (`engine.hitTestAt` — peek-only, no
 *                                  selection side effect; see engine.ts doc
 *                                  comment on why this method exists)
 *
 * Uses Pointer Events + `setPointerCapture` (not plain `mouse*` events) so an
 * in-progress drag keeps tracking even if the cursor crosses the canvas
 * bounds mid-pan — a plain `mousemove`/`mouseup` pair would silently drop the
 * drag at the edge, unlike a native touch/gesture recognizer.
 */
export function useRoomControls(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  engineRef: RefObject<RoomEngine | null>,
): void {
  // Drag state lives in a ref, not React state — pointermove fires far too
  // often to route through re-renders.
  const dragRef = useRef<DragState>({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const localPos = (e: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const { x, y } = localPos(e)
      dragRef.current = { active: true, moved: false, pointerId: e.pointerId, startX: x, startY: y, lastX: x, lastY: y }
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = 'grabbing'
    }

    const onPointerMove = (e: PointerEvent): void => {
      const drag = dragRef.current
      const { x, y } = localPos(e)

      if (drag.active && e.pointerId === drag.pointerId) {
        const dx = x - drag.lastX
        const dy = y - drag.lastY
        drag.lastX = x
        drag.lastY = y
        if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) > DRAG_THRESHOLD_PX) {
          drag.moved = true
        }
        engineRef.current?.panBy(dx, dy)
        return
      }

      // Hover — peek-only hit test, no selection side effect.
      const idx = engineRef.current?.hitTestAt(x, y)
      canvas.style.cursor = idx != null ? 'pointer' : 'grab'
    }

    const onPointerUp = (e: PointerEvent): void => {
      const drag = dragRef.current
      if (drag.active && e.pointerId === drag.pointerId) {
        if (!drag.moved) {
          const { x, y } = localPos(e)
          engineRef.current?.raycastAt(x, y)
        }
        canvas.releasePointerCapture(e.pointerId)
      }
      dragRef.current.active = false
      canvas.style.cursor = 'grab'
    }

    const onPointerCancel = (): void => {
      dragRef.current.active = false
      canvas.style.cursor = 'grab'
    }

    const onPointerLeave = (): void => {
      // Only reset the hover cursor — an active drag keeps going via pointer
      // capture even after the cursor leaves the canvas bounds.
      if (!dragRef.current.active) canvas.style.cursor = 'default'
    }

    const onWheel = (e: WheelEvent): void => {
      // The room owns all scroll/pinch input while under the cursor — the
      // page itself must never scroll from a gesture meant to zoom the room.
      e.preventDefault()
      const sensitivity = e.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY
      const factor = Math.exp(-e.deltaY * sensitivity)
      engineRef.current?.zoomBy(factor)
    }

    canvas.style.cursor = 'grab'
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [canvasRef, engineRef])
}
