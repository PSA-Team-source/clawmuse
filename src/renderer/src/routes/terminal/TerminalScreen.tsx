import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { EmptyState } from '@/components/patterns'
import { cssColor } from '@/design/tokens'
import {
  closeTerminal,
  openTerminal,
  resizeTerminal,
  subscribeTerminal,
  writeTerminal,
  type TerminalSession,
} from '@/services/terminal'
import { useGatewayStore } from '@/stores/gateway.store'

/**
 * A real shell, in the agent's own workspace.
 *
 * The PTY lives in the gateway, so this is the same environment the agent runs
 * tools in — `cd` here and the agent sees the same tree. The session is closed
 * on unmount rather than left running: an orphaned shell would keep whatever it
 * was doing (a build, a watcher) alive with nothing displaying its output.
 */
export default function TerminalScreen() {
  const connectionState = useGatewayStore((state) => state.connectionState)
  const hostRef = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState<TerminalSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState<number | null>(null)

  useEffect(() => {
    if (connectionState !== 'connected') return
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let sessionId: string | null = null
    let unsubscribe: (() => void) | null = null

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      // Match the app rather than xterm's default black-on-white. Read from the
      // stylesheet, so the terminal follows the tokens instead of holding a
      // copy of them that goes stale the next time the palette changes.
      theme: {
        background: cssColor('bg-base', '#050810'),
        foreground: cssColor('content-primary', '#ffffff'),
        cursor: cssColor('primary-light', '#818cf8'),
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    /**
     * Only fit once the host has a size.
     *
     * `fit()` on a zero-height box computes a 1-row terminal, and the PTY is
     * then spawned with those dimensions — the shell runs, the header reports
     * it, and the buffer draws nothing anyone can read. The layout settles a
     * frame later, but the geometry the PTY was told about does not.
     */
    const fitWhenSized = () => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fit.fit()
        return true
      }
      return false
    }
    if (!fitWhenSized()) requestAnimationFrame(fitWhenSized)

    void (async () => {
      try {
        fitWhenSized()
        const opened = await openTerminal(term.cols, term.rows)
        if (disposed) {
          void closeTerminal(opened.sessionId)
          return
        }
        sessionId = opened.sessionId
        setSession(opened)

        unsubscribe = subscribeTerminal(opened.sessionId, {
          onData: (data) => term.write(data),
          onExit: (code) => {
            setExited(code ?? 0)
            term.write(`\r\n\x1b[2m[process exited${code ? ` with code ${code}` : ''}]\x1b[0m\r\n`)
          },
        })

        term.onData((data) => {
          void writeTerminal(opened.sessionId, data)
        })
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : 'Could not start a terminal')
        }
      }
    })()

    // Resize both sides together: xterm reflows locally, the PTY needs telling
    // or long lines wrap at the old width.
    const observer = new ResizeObserver(() => {
      fit.fit()
      if (sessionId) void resizeTerminal(sessionId, term.cols, term.rows)
    })
    observer.observe(host)

    return () => {
      disposed = true
      observer.disconnect()
      unsubscribe?.()
      if (sessionId) void closeTerminal(sessionId)
      term.dispose()
    }
  }, [connectionState])

  if (connectionState !== 'connected') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-base">
        <Spinner size={22} />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg-base">
      <div className="drag flex h-11 shrink-0 items-center justify-between px-5">
        <span className="no-drag text-body-sm font-medium text-content-primary">Terminal</span>
        {session && (
          <span className="no-drag truncate text-caption text-content-tertiary" title={session.cwd}>
            {session.shell ?? 'shell'} · {session.cwd ?? 'workspace'}
            {session.confined ? ' · sandboxed' : ''}
            {exited !== null ? ' · exited' : ''}
          </span>
        )}
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <EmptyState
            icon={<Icon icon={Alert02Icon} size={40} className="text-content-disabled" />}
            title="Terminal unavailable"
            description={error}
          />
        </div>
      ) : (
        <div ref={hostRef} className="min-h-0 flex-1 px-3 pb-3" />
      )}
    </div>
  )
}
