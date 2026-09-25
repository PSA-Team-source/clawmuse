import { useEffect, useRef } from 'react'
import { DEVICE } from '@/lib/platform'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert02Icon, FileValidationIcon } from '@hugeicons/core-free-icons'
import { ClawMuseLogo, GhostButton, GradientButton } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { ProgressSteps } from '@/components/patterns'
import { useGatewayStore } from '@/stores/gateway.store'
import { useRuntimeStore } from '@/stores/runtime.store'
import type { LocalRuntimeStep } from '@shared/ipc'

/**
 * Boot screen for local mode.
 *
 * Unlike the cloud sandbox boot, every step here happens on this machine, so
 * the failure modes are things the user can actually fix: no Node, no network
 * for the runtime download, a port already taken. Each error therefore carries
 * a hint and a link to the gateway log rather than a generic retry.
 */

type StepStatus = 'pending' | 'loading' | 'done' | 'error'

/** Maps the fine-grained runtime steps onto the five shown to the user. */
const STEPS: { label: string; covers: LocalRuntimeStep[] }[] = [
  { label: 'Checking your machine', covers: ['checking-node', 'checking-cli'] },
  { label: 'Installing the local agent', covers: ['installing-cli'] },
  { label: 'Writing your profile', covers: ['writing-config'] },
  { label: 'Starting the agent service', covers: ['installing-service', 'starting'] },
  { label: 'Connecting', covers: ['health', 'ready'] },
]

function indexOfStep(step: LocalRuntimeStep): number {
  const found = STEPS.findIndex((entry) => entry.covers.includes(step))
  return found < 0 ? 0 : found
}

export default function LocalBootScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const requestedRoute: unknown = location.state?.returnTo
  const returnTo = typeof requestedRoute === 'string' && requestedRoute.startsWith('/') && !requestedRoute.startsWith('//') && !requestedRoute.startsWith('/local-boot') ? requestedRoute : '/chat'
  const status = useRuntimeStore((state) => state.status)
  const openLogs = useRuntimeStore((state) => state.openLogs)
  const connectionState = useGatewayStore((state) => state.connectionState)
  const errorMessage = useGatewayStore((state) => state.errorMessage)
  const errorHint = useGatewayStore((state) => state.errorHint)
  const bootLocal = useGatewayStore((state) => state.bootLocal)

  const started = useRef(false)

  useEffect(() => {
    if (started.current || connectionState !== 'idle') return
    started.current = true
    void bootLocal()
  }, [connectionState, bootLocal])

  useEffect(() => {
    // A new settings window must return to settings after connecting, not chat.
    if (connectionState === 'connected') navigate(returnTo, { replace: true })
  }, [connectionState, navigate, returnTo])

  const activeIndex =
    status.state === 'starting' || status.state === 'error' ? indexOfStep(status.step) : STEPS.length - 1

  const steps = STEPS.map((entry, index) => {
    let state: StepStatus = 'pending'
    if (status.state === 'error') {
      if (index < activeIndex) state = 'done'
      else if (index === activeIndex) state = 'error'
    } else if (connectionState === 'connected') {
      state = 'done'
    } else if (index < activeIndex) {
      state = 'done'
    } else if (index === activeIndex) {
      state = 'loading'
    }
    return { label: entry.label, status: state }
  })

  const detail = status.state === 'starting' ? status.detail : undefined
  // Covers both "not installed" and "too old": neither is fixed by retrying,
  // and both are fixed by the same download.
  const needsNode = status.state === 'error' && status.step === 'checking-node'
  const failure =
    status.state === 'error'
      ? { message: status.message, hint: status.hint }
      : connectionState === 'error'
        ? { message: errorMessage ?? 'Could not reach the local agent', hint: errorHint ?? undefined }
        : null

  function handleRetry(): void {
    started.current = true
    void bootLocal()
  }

  return (
    <div className="relative flex h-full w-full flex-col bg-bg-base">
      <div className="drag absolute inset-x-0 top-0 h-10" />

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex w-full max-w-form flex-col items-center gap-6">
          <ClawMuseLogo size={56} variant="badge" />
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="text-title-2 font-bold text-content-primary">Starting ClawMuse</h1>
            <p className="text-body-sm text-content-tertiary">
              Your agent runs on this {DEVICE}. Messages go only to the AI model you choose.
            </p>
          </div>

          <ProgressSteps steps={steps} />

          {/* Real progress text from the installer, not a decorative spinner. */}
          {detail && (
            <p className="w-full truncate text-center font-mono text-caption text-content-faint">
              {detail}
            </p>
          )}

          {failure && (
            <div className="flex w-full flex-col items-center gap-3 rounded-box border border-error-border bg-error-bg p-4">
              <div className="flex items-center gap-2 text-center text-body-sm text-error">
                <Icon icon={Alert02Icon} size={15} />
                <span>{failure.message}</span>
              </div>
              {failure.hint && (
                <p className="text-center text-caption text-content-tertiary">{failure.hint}</p>
              )}
              <div className="flex items-center gap-2">
                <GradientButton size="sm" onClick={handleRetry}>
                  Retry
                </GradientButton>
                <GhostButton size="sm" onClick={() => void openLogs()}>
                  <span className="flex items-center gap-1.5">
                    <Icon icon={FileValidationIcon} size={14} />
                    Open log
                  </span>
                </GhostButton>
              </div>
              {needsNode && (
                <p className="text-center text-caption text-content-faint">
                  Press Retry — ClawMuse includes the supported Node runtime it needs.
                </p>
              )}
            </div>
          )}


          {status.state === 'ready' && status.attached && (
            <p className="text-caption text-content-faint">
              Reconnected to the agent that was already running.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
