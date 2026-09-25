import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RoomRoute from '@/routes/room/RoomRoute'
import { useChatStore } from '@/stores/chat.store'

/**
 * Regression: picking a character in the room did nothing.
 *
 * `RoomScreen` forwards every selection surface — the WebGL canvas, the basic
 * mode list and the agent bar — into a single optional `onSelectSkill`. The
 * route that hosts it never passed one, so all three called `undefined?.()` and
 * the room's whole point (click an agent, talk to it) silently did nothing.
 *
 * The session id matters as much as the navigation: it has to be the
 * `webchat:skill:<id>` form, because that is the key the canvas reads for a
 * character's "thinking" glow and the key an existing thread is stored under.
 * A different shape would open a blank conversation on every click.
 */

// three.js in jsdom buys nothing here; the contract under test is the callback.
vi.mock('@/features/room3d', () => ({
  RoomScreen: ({ onSelectSkill }: { onSelectSkill?: (skillId: string) => void }) => (
    <button onClick={() => onSelectSkill?.('create-store')}>pick agent</button>
  ),
}))

vi.mock('@/hooks', () => ({ useRoomRealtime: () => undefined }))

function LocationProbe() {
  return <div data-testid="pathname">{useLocation().pathname}</div>
}

function renderRoom() {
  return render(
    <MemoryRouter initialEntries={['/room']}>
      <Routes>
        <Route path="/room" element={<RoomRoute />} />
        <Route path="/chat/:sessionId" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('room → chat', () => {
  beforeEach(() => {
    useChatStore.setState({ sessions: [], currentSessionId: null })
  })

  it('navigates to the agent thread when a character is picked', () => {
    renderRoom()
    fireEvent.click(screen.getByText('pick agent'))

    expect(screen.getByTestId('pathname').textContent).toBe(
      `/chat/${encodeURIComponent('webchat:skill:create-store')}`,
    )
  })

  it('opens the agent-scoped session rather than a fresh conversation', () => {
    renderRoom()
    fireEvent.click(screen.getByText('pick agent'))

    const { sessions, currentSessionId } = useChatStore.getState()
    expect(currentSessionId).toBe('webchat:skill:create-store')
    expect(sessions).toHaveLength(1)
  })

  it('reuses the existing thread instead of stacking duplicates', () => {
    useChatStore.setState({
      sessions: [{ id: 'webchat:skill:create-store', name: 'create-store' }],
    })

    renderRoom()
    fireEvent.click(screen.getByText('pick agent'))

    expect(useChatStore.getState().sessions).toHaveLength(1)
  })
})
