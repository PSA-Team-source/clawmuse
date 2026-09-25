import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddAgentSheet } from '@/features/room3d/AddAgentSheet'
import { ToastProvider } from '@/components/patterns'
import { useRoomStore } from '@/stores/room.store'
import { useSkillsStore } from '@/stores/skills.store'

/**
 * Regression: opening this sheet turned the entire window black.
 *
 * `useRoomStore((s) => s.characters())` looks like an ordinary selector, but
 * `characters()` builds a fresh array on every call. `useSyncExternalStore`
 * compares snapshots by identity, so each read looked like a store mutation,
 * React threw #185 ("Maximum update depth exceeded") and unmounted the whole
 * tree — canvas included. Nothing about the symptom pointed at a selector.
 *
 * Rendering the component is the test: an unstable snapshot throws during
 * render, so a component that mounts at all has a stable one.
 */

/**
 * The sheet refreshes from the gateway on mount, so the mock — not the seeded
 * store — decides what it ends up rendering.
 */
vi.mock('@/services/gateway-ws.service', () => ({
  gatewayWS: {
    getSkillsStatus: vi.fn().mockResolvedValue({
      skills: [
        { skillKey: 'research', name: 'Research', description: 'Finds things', emoji: '🔎' },
        { skillKey: 'already-here', name: 'Already Here', description: 'In the room', emoji: '🪑' },
        // The common case on a real machine: a skill whose CLI is not installed.
        {
          skillKey: 'onepassword',
          name: '1password',
          description: 'Read secrets',
          emoji: '🔐',
          missing: { bins: ['op'] },
        },
      ],
    }),
    setSkillEnabled: vi.fn().mockResolvedValue({}),
  },
  encodeAttachment: vi.fn(),
}))

function renderSheet() {
  return render(
    <ToastProvider>
      <AddAgentSheet onClose={() => undefined} />
    </ToastProvider>,
  )
}

beforeEach(() => {
  useSkillsStore.setState({
    isLoading: false,
    skills: [
      {
        skillKey: 'research',
        name: 'Research',
        description: 'Finds things',
        emoji: '🔎',
        enabled: true,
        eligible: true,
        bundled: true,
        missingBins: [],
      },
      {
        skillKey: 'already-here',
        name: 'Already Here',
        description: 'In the room',
        emoji: '🪑',
        enabled: true,
        eligible: true,
        bundled: true,
        missingBins: [],
      },
    ],
  })
})

describe('AddAgentSheet', () => {
  it('mounts without tearing the tree down', async () => {
    expect(() => renderSheet()).not.toThrow()
    await waitFor(() => expect(screen.getByText('Research')).toBeTruthy())
  })

  it('reads the room from stable state rather than a fresh-array selector', async () => {
    // The room store is the source of "who is already here". Reading it through
    // `characters()` is what caused the crash, so this asserts the filtering
    // still works while the component holds only stable references.
    useRoomStore.setState({
      rooms: [
        {
          id: 'main',
          name: 'Main Office',
          characterConfigs: [
            {
              skillId: 'already-here',
              skillName: 'Already Here',
              description: '',
              appearanceSeed: 0,
            },
          ],
        },
      ],
      activeRoomId: 'main',
    })

    renderSheet()

    await waitFor(() => expect(screen.getByText('Research')).toBeTruthy())
    expect(screen.queryByText('Already Here')).toBeNull()
  })

  it('still adds a skill whose CLI is not installed', async () => {
    // Regression: every row with a missing binary was disabled. Most OpenClaw
    // skills need a third-party CLI, so on an ordinary machine that left a
    // sheet full of agents and no way to add a single one.
    const added: string[] = []
    useRoomStore.setState({
      rooms: [{ id: 'main', name: 'Main Office', characterConfigs: [] }],
      activeRoomId: 'main',
      addCharacterToRoom: ((config: { skillId: string }) => {
        added.push(config.skillId)
      }) as never,
    })

    renderSheet()
    const row = await screen.findByText('1password')

    // The warning is still there — told, not blocked.
    expect(screen.getByText(/needs op/i)).toBeTruthy()

    fireEvent.click(row)
    expect(added).toEqual(['onepassword'])
  })

  it('survives repeated store updates, which is what the infinite loop looked like', async () => {
    renderSheet()
    await waitFor(() => expect(screen.getByText('Research')).toBeTruthy())
    for (let i = 0; i < 5; i += 1) {
      useRoomStore.setState({ taskCounts: { research: i } })
    }
    expect(screen.getByText('Research')).toBeTruthy()
  })
})

describe('room store', () => {
  it('characters() really does return a new array each call', () => {
    // Documented deliberately: this is safe inside a callback and fatal inside
    // a selector, and the difference is invisible at the call site.
    const first = useRoomStore.getState().characters()
    const second = useRoomStore.getState().characters()
    expect(first).not.toBe(second)
  })
})
