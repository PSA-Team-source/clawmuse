import { useCallback, useEffect, useRef } from 'react'
import { createEngine, type RoomEngine } from '@/features/room3d/engine/engine'
import type { Anchor } from '@/features/room3d/engine/labels'
import type { CharacterData } from '@/features/room3d/engine/types'

/**
 * Owns the RoomEngine lifecycle: create once a real `<canvas>` + its initial
 * size are known, rebuild characters when the roster changes, resize on
 * layout changes, pause while the tab is hidden, and dispose on unmount.
 *
 * Ported from mobile `useRoomEngine.ts`. The mobile hook created the engine
 * inside `onContextCreate(gl)` — expo-gl's "the native GL context now exists"
 * callback. Desktop has no such callback (a `<canvas>` exists synchronously
 * once mounted), so `mount(canvas, width, height)` is called explicitly by
 * RoomCanvas from its ResizeObserver's first measurement instead.
 */
export function useRoomEngine(
  getCharData: () => CharacterData[],
  onSelect: (skillIndex: number) => void,
  onFrame?: (anchors: Anchor[]) => void,
) {
  const engineRef = useRef<RoomEngine | null>(null)

  // The three callbacks change identity constantly — `getCharData` is memoized
  // on the character list, which is rebuilt whenever the roster, task counts or
  // typing state move. Reaching them through refs keeps `mount` referentially
  // stable, which matters because RoomCanvas re-runs its ResizeObserver effect
  // whenever `mount` changes: an unstable `mount` tears the engine down and
  // rebuilds it on the same canvas on every roster update. Roster changes are
  // already handled without a rebuild by `setCharacters` below.
  const getCharDataRef = useRef(getCharData)
  const onSelectRef = useRef(onSelect)
  const onFrameRef = useRef(onFrame)
  useEffect(() => {
    getCharDataRef.current = getCharData
    onSelectRef.current = onSelect
    onFrameRef.current = onFrame
  }, [getCharData, onSelect, onFrame])

  const mount = useCallback((canvas: HTMLCanvasElement, width: number, height: number) => {
    // `false`: a rebuild reuses this exact canvas, so the GL context must
    // survive for the next renderer to adopt.
    engineRef.current?.dispose(false)
    engineRef.current = createEngine({
      canvas,
      width,
      height,
      charData: getCharDataRef.current(),
      onSelect: (skillIndex) => onSelectRef.current(skillIndex),
      onFrame: (anchors) => onFrameRef.current?.(anchors),
    })
  }, [])

  const resize = useCallback((width: number, height: number) => {
    engineRef.current?.resize(width, height)
  }, [])

  // Rebuild scene whenever character data changes (engine.setCharacters is
  // itself a no-op mesh-rebuild unless the roster signature actually changed).
  useEffect(() => {
    engineRef.current?.setCharacters(getCharData())
  }, [getCharData])

  // Pause the render loop while the window/tab is hidden — the desktop
  // equivalent of mobile's `AppState` 'background' subscription. Complements
  // the route-visibility pause in RoomCanvas's `active` prop (two independent
  // pause sources, same structure as the mobile source).
  useEffect(() => {
    const onVisibility = () => engineRef.current?.setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  return { engineRef, mount, resize }
}
