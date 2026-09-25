import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert02Icon,
  ArrowRight02Icon,
  Globe02Icon,
  PlayIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { GhostButton, GradientButton, Spinner } from '@/components/brand'
import { EmptyState, TextField } from '@/components/patterns'
import { Icon } from '@/components/primitives'
import { gatewayWS } from '@/services/gateway-ws.service'
import { TeachPanel } from './TeachPanel'

/**
 * The shared computer's browser.
 *
 * One Chrome profile, managed by the gateway, kept at
 * `<state dir>/browser/openclaw/user-data`. That single fact is what makes the
 * roster work the way Grok Bot's does: sign into a site once here and every bot
 * inherits the session, because there is only one browser.
 *
 * The view is a screenshot on a timer, not a video stream, and it says so. A
 * CDP screencast would be smoother and would also mean holding a second socket
 * open to Chrome for a pane that is usually not on screen; the honest trade is
 * a periodic frame plus a Refresh that is instant.
 *
 * Everything here goes through `browser.request` on the gateway — the same path
 * `openclaw browser` takes — so there is no second port and no second
 * credential.
 */

const POLL_MS = 2_500

interface Frame {
  running: boolean
  url: string | null
  shot: string | null
}

/**
 * Status, then a capture.
 *
 * Query-driven rather than an effect with a timer: the poll has to stop while
 * the pane is off screen, and a slow capture must not stack up behind the next
 * tick. React Query owns both, and it already owns every other periodic read in
 * this app.
 */
async function readFrame(): Promise<Frame> {
  const status = (await gatewayWS.browserRequest({ method: 'GET', path: '/' })) as {
    running?: boolean
    url?: string
  }
  if (status?.running === false) return { running: false, url: null, shot: null }

  const capture = (await gatewayWS.browserRequest({
    method: 'POST',
    path: '/screenshot',
    body: { type: 'jpeg' },
  })) as { path?: string; imagePath?: string; url?: string }

  const path = capture?.imagePath ?? capture?.path
  return {
    running: true,
    url: capture?.url ?? status?.url ?? null,
    // The control API answers with a path to a saved file; main reads it, after
    // checking it really is inside the profile.
    shot: path ? await window.clawmuse.runtime.readShot(path) : null,
  }
}

export function BrowserPane() {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const frame = useQuery({
    queryKey: ['computer', 'browser-frame'],
    queryFn: readFrame,
    refetchInterval: POLL_MS,
    // A capture is a real action on a real browser; retrying a failed one on a
    // timer would hide the failure behind a spinner.
    retry: false,
  })

  async function act(request: Parameters<typeof gatewayWS.browserRequest>[0]): Promise<void> {
    setBusy(true)
    setActionError(null)
    try {
      await gatewayWS.browserRequest(request)
      await frame.refetch()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function navigate(): void {
    const target = url.trim()
    if (target) void act({ method: 'POST', path: '/navigate', body: { url: target } })
  }

  const error =
    actionError ?? (frame.error instanceof Error ? frame.error.message : frame.error ? String(frame.error) : null)
  const running = frame.data?.running ?? true

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line-hairline px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <TextField
            value={url}
            onChange={setUrl}
            placeholder={frame.data?.url ?? 'Open a URL on the shared computer'}
            icon={Globe02Icon}
            onSubmit={navigate}
          />
        </div>
        <GhostButton size="sm" disabled={busy || !url.trim()} onClick={navigate}>
          <Icon icon={ArrowRight02Icon} size={14} />
        </GhostButton>
        <GhostButton size="sm" disabled={busy} onClick={() => void frame.refetch()}>
          <Icon icon={RefreshIcon} size={14} />
        </GhostButton>
        <TeachPanel />
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-bg-surface/40 p-4">
        {error ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Icon icon={Alert02Icon} size={36} className="text-error" />}
              title="The browser did not answer"
              description={error}
              action={
                <GhostButton size="sm" onClick={() => void frame.refetch()}>
                  Try again
                </GhostButton>
              }
            />
          </div>
        ) : !running ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Icon icon={Globe02Icon} size={40} className="text-content-disabled" />}
              title="The browser is not running"
              description="Start it to sign into a site once — every bot then inherits that session, because they share this one browser."
              action={
                <GradientButton
                  size="sm"
                  loading={busy}
                  onClick={() => void act({ method: 'POST', path: '/start' })}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon icon={PlayIcon} size={14} />
                    Start the browser
                  </span>
                </GradientButton>
              }
            />
          </div>
        ) : frame.data?.shot ? (
          <img
            src={frame.data.shot}
            alt="The shared computer's browser"
            className="mx-auto max-w-full rounded-box border border-line shadow-lg"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner size={24} />
          </div>
        )}
      </div>

      <p className="shrink-0 border-t border-line-hairline px-4 py-2 text-caption text-content-faint">
        A frame every {POLL_MS / 1000}s, not a live stream. The real window is on your Mac — take it
        over there whenever you need to.
      </p>
    </div>
  )
}
