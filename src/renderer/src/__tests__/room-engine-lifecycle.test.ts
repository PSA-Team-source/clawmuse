/**
 * Regression tests for the Agent Room's engine lifecycle.
 *
 * The room shipped permanently black: `useRoomEngine.mount` was memoized on
 * `getCharData`, which is rebuilt on every roster/task-count/typing change, so
 * RoomCanvas's ResizeObserver effect re-ran and rebuilt the engine on the SAME
 * <canvas>. The teardown called `renderer.forceContextLoss()`, which kills the
 * context for the canvas ELEMENT — so the replacement renderer adopted a lost
 * context, three read null out of getShaderPrecisionFormat(), and threw.
 *
 * Two independent properties keep that from coming back; either alone would
 * have prevented the bug, and both are cheap to assert.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoomEngine } from '@/features/room3d/useRoomEngine'

const created: { disposedWith: (boolean | undefined)[] }[] = []
const disposeCalls: (boolean | undefined)[] = []

vi.mock('@/features/room3d/engine/engine', () => ({
  createEngine: vi.fn(() => {
    const engine = {
      disposedWith: [] as (boolean | undefined)[],
      resize: vi.fn(),
      setCharacters: vi.fn(),
      setPaused: vi.fn(),
      dispose: vi.fn((releaseContext?: boolean) => {
        disposeCalls.push(releaseContext)
      }),
    }
    created.push(engine)
    return engine
  }),
}))

const canvas = () => document.createElement('canvas')

describe('useRoomEngine', () => {
  beforeEach(() => {
    created.length = 0
    disposeCalls.length = 0
    vi.clearAllMocks()
  })

  it('keeps `mount` referentially stable when the character data changes', () => {
    let chars = [{ id: 'a' }]
    const { result, rerender } = renderHook(() => useRoomEngine(() => chars as never, vi.fn(), vi.fn()))

    const firstMount = result.current.mount

    // Simulate a roster update: a brand-new getCharData identity, exactly what
    // RoomCanvas produces when task counts or typing state move.
    chars = [{ id: 'a' }, { id: 'b' }]
    rerender()

    expect(result.current.mount).toBe(firstMount)
  })

  it('preserves the WebGL context when rebuilding onto the same canvas', () => {
    const { result } = renderHook(() => useRoomEngine(() => [] as never, vi.fn(), vi.fn()))
    const shared = canvas()

    result.current.mount(shared, 800, 600)
    result.current.mount(shared, 800, 600)

    // The rebuild must ask the engine NOT to release the context, or the second
    // renderer inherits a dead one and the room renders black forever.
    expect(disposeCalls).toEqual([false])
    expect(created).toHaveLength(2)
  })

  it('releases the WebGL context on unmount', () => {
    const { result, unmount } = renderHook(() => useRoomEngine(() => [] as never, vi.fn(), vi.fn()))
    result.current.mount(canvas(), 800, 600)

    unmount()

    // Default (undefined) means release — the canvas is going away with it.
    expect(disposeCalls).toEqual([undefined])
  })

  it('routes late callback identities through to the live engine', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ onSelect }) => useRoomEngine(() => [] as never, onSelect, vi.fn()), {
      initialProps: { onSelect: first },
    })

    result.current.mount(canvas(), 800, 600)
    rerender({ onSelect: second })

    // The engine was built with a stable wrapper; it must call whichever
    // callback is current, not the one captured at mount time.
    const { createEngine } = await import('@/features/room3d/engine/engine')
    const opts = vi.mocked(createEngine).mock.calls.at(-1)![0]
    opts.onSelect?.(3)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(3)
  })
})
