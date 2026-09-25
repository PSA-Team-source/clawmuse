import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LocalBootScreen from '@/routes/onboarding/LocalBootScreen'
import { useGatewayStore } from '@/stores/gateway.store'
import { useRuntimeStore } from '@/stores/runtime.store'
import type { LocalRuntimeStatus } from '@shared/ipc'

/**
 * The state a genuinely new Mac starts in.
 *
 * ClawMuse supplies Node from Electron's embedded runtime. A node-gate failure
 * is therefore recoverable in-app and must never send a clean Mac to a third
 * party download page.
 */

const navigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}))

const openExternal = vi.fn()
const bootLocal = vi.fn()
const openLogs = vi.fn()

const nodeMissing: LocalRuntimeStatus = {
  state: 'error',
  step: 'checking-node',
  message: 'Node is not installed or not on PATH. Install Node 24 from nodejs.org.',
  hint: 'Install Node 24 from nodejs.org',
  recoverable: false,
}

function renderBoot(status: LocalRuntimeStatus): void {
  useRuntimeStore.setState({ status, openLogs })
  useGatewayStore.setState({ connectionState: 'error', errorMessage: null, errorHint: null, bootLocal })
  render(
    <MemoryRouter>
      <LocalBootScreen />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Defined *on* the real window rather than replacing it: the boot screen
  // renders motion components, and a plain object spread of `window` loses
  // every prototype method they reach for (`addEventListener` first).
  Object.defineProperty(window, 'clawmuse', {
    // `reportConnectionState` too: the gateway store mirrors every state change
    // into the tray menu from a module-level subscription, so any `setState`
    // here reaches it.
    value: { shell: { openExternal }, reportConnectionState: vi.fn() },
    writable: true,
    configurable: true,
  })
})

describe('a machine with no Node', () => {
  it('keeps recovery inside the app', () => {
    renderBoot(nodeMissing)
    fireEvent.click(screen.getByText('Retry'))
    expect(bootLocal).toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('tells the user what happens after they install it', () => {
    renderBoot(nodeMissing)
    // Without this, "Get Node" reads as a dead end too — the app never says
    // that installing Node is the whole of the user's part.
    expect(screen.getByText(/press Retry/i)).toBeTruthy()
  })

  it('still allows Retry, and offers nowhere else to go', () => {
    renderBoot(nodeMissing)
    fireEvent.click(screen.getByText('Retry'))
    expect(bootLocal).toHaveBeenCalled()
    // There is no cloud to fall back to, and pretending otherwise would be the
    // one promise this app cannot keep. Retry and the log are the whole of it.
    expect(screen.queryByText(/in the cloud/i)).toBeNull()
  })

  it('treats a too-old external Node as recoverable by the embedded runtime', () => {
    renderBoot({
      state: 'error',
      step: 'checking-node',
      message: 'Node v18.0.0 is too old. OpenClaw needs 22.19+ (24 recommended).',
      recoverable: false,
    })
    expect(screen.getByText('Retry')).toBeTruthy()
    expect(screen.queryByText('Get Node')).toBeNull()
  })

  it('does not offer a Node download for failures Node cannot fix', () => {
    // A gateway that will not start is not a missing-runtime problem, and
    // sending the user to nodejs.org for it wastes their time.
    renderBoot({
      state: 'error',
      step: 'health',
      message: 'The local agent did not become ready in time',
      recoverable: true,
    })
    expect(screen.queryByText('Get Node')).toBeNull()
    expect(screen.getByText('Retry')).toBeTruthy()
  })
})
