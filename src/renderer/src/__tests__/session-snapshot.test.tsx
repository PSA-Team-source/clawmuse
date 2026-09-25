import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSession } from '@/hooks'
import { useChatStore } from '@/stores/chat.store'

/**
 * Regression: a zustand selector that builds a fresh `[]` on every read.
 *
 * `useSyncExternalStore` compares snapshots by identity, so returning a new
 * literal makes React re-render forever and throw "Maximum update depth
 * exceeded" (#185) — which unmounts the entire tree, not just the screen. It
 * only triggers for a session that has no messages yet, i.e. every brand-new
 * conversation, which is why it survived until an end-to-end run clicked
 * "New chat".
 */
describe('useSession snapshot stability', () => {
  it('returns the same empty array reference across reads', () => {
    const { result, rerender } = renderHook(() => useSession('session-that-has-no-messages'))
    const first = result.current.messages
    rerender()
    expect(result.current.messages).toBe(first)
  })

  it('is stable for a null session too', () => {
    const { result, rerender } = renderHook(() => useSession(null))
    const first = result.current.messages
    rerender()
    expect(result.current.messages).toBe(first)
  })

  it('still reads real messages when the store has them', () => {
    useChatStore.setState({
      messages: {
        'has-messages': [
          {
            id: 'm1',
            session_id: 'has-messages',
            role: 'user',
            content: 'hi',
            status: 'sent',
            created_at: new Date(0).toISOString(),
          },
        ],
      },
    })
    const { result } = renderHook(() => useSession('has-messages'))
    expect(result.current.messages).toHaveLength(1)
  })
})
