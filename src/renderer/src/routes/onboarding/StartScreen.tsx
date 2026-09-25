import { useEffect, useState } from 'react'
import { DEVICE } from '@/lib/platform'
import { useNavigate } from 'react-router-dom'
import { Alert02Icon, CheckmarkCircle02Icon, Key01Icon } from '@hugeicons/core-free-icons'
import type { CredentialFinding } from '@shared/ipc'
import { ClawMuseLogo, GhostButton, GradientButton, Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { cn } from '@/lib/cn'

/**
 * The one screen a new install shows.
 *
 * The product promise is install and use it, so the first launch is not a
 * wizard: this Mac is asked what model credentials it already has — a key in
 * `.zshrc`, Claude Code's settings, an existing `openclaw` profile, an Ollama
 * on loopback — and the best answer is proposed with a single button.
 *
 * It is a *confirm*, not a silent adoption. The card names the exact file the
 * credential came from, because "we found a key" without saying where is a
 * request to trust the app with a credential it will not name — and because the
 * key that gets picked is the one that gets billed.
 *
 * When the scan finds nothing, this screen never renders: the setup wizard is
 * the honest answer and the user goes straight there.
 */
export default function StartScreen() {
  const navigate = useNavigate()

  const [findings, setFindings] = useState<CredentialFinding[] | null>(null)
  const [chosen, setChosen] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.clawmuse.runtime
      .scanCredentials()
      .then((found) => {
        if (cancelled) return
        setFindings(found)
        // Nothing to confirm — do not show an empty card on the way to setup.
        if (found.length === 0) navigate('/local-setup', { replace: true })
      })
      .catch(() => {
        if (!cancelled) navigate('/local-setup', { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  const selected = findings?.[chosen]

  async function start(): Promise<void> {
    if (!selected || starting) return
    setStarting(true)
    setError(null)
    try {
      // Order matters: the provider has to be on disk before the gateway is
      // asked to start, or it comes up with no model and fails on the first
      // message instead of at boot, where the error is legible.
      await window.clawmuse.runtime.applyProvider(selected.provider)
      navigate('/local-boot', { replace: true })
    } catch (cause) {
      setStarting(false)
      setError(cause instanceof Error ? cause.message : 'Could not save that credential')
    }
  }

  if (!findings) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-base">
        <Spinner size={28} />
      </div>
    )
  }
  if (findings.length === 0 || !selected) return null

  return (
    <div className="relative flex h-full w-full flex-col bg-bg-base">
      <div className="drag absolute inset-x-0 top-0 h-10" />

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex w-full max-w-form flex-col items-center gap-6">
          <ClawMuseLogo size={56} variant="badge" />

          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="text-title-2 font-bold text-content-primary">Ready to go</h1>
            <p className="text-body-sm text-content-tertiary">
              Your bots run on this machine, on a model you already pay for.
            </p>
          </div>

          <div className="w-full rounded-box border border-border-subtle bg-bg-raised p-4">
            <p className="mb-3 text-caption font-medium uppercase tracking-wide text-content-faint">
              Found on this {DEVICE}
            </p>

            <div className="flex flex-col gap-1">
              {(expanded ? findings : [selected]).map((finding) => {
                const index = findings.indexOf(finding)
                const active = index === chosen
                return (
                  <button
                    key={`${finding.provider.id}-${finding.source}`}
                    type="button"
                    disabled={starting}
                    onClick={() => {
                      setChosen(index)
                      setExpanded(false)
                    }}
                    className={cn(
                      'flex items-center gap-3 rounded-field px-3 py-2.5 text-left transition-colors',
                      active ? 'bg-fill-accent' : 'hover:bg-fill-raised',
                    )}
                  >
                    <Icon
                      icon={active ? CheckmarkCircle02Icon : Key01Icon}
                      size={17}
                      className={active ? 'text-primary' : 'text-content-tertiary'}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-sm text-content-primary">
                        {finding.label}
                      </span>
                      {/* The exact file, verbatim — this is the whole point of
                          showing a card instead of adopting silently. */}
                      <span className="truncate font-mono text-caption text-content-faint">
                        {finding.source}
                      </span>
                    </span>
                    {!finding.needsKey && (
                      <span className="shrink-0 text-caption text-content-faint">no key needed</span>
                    )}
                  </button>
                )
              })}
            </div>

            {findings.length > 1 && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="mt-2 px-3 text-caption text-content-tertiary underline-offset-2 hover:underline"
              >
                Change — {findings.length - 1} other
                {findings.length - 1 === 1 ? '' : 's'} on this {DEVICE}
              </button>
            )}
          </div>

          {error && (
            <div className="flex w-full items-center gap-2 rounded-box border border-error-border bg-error-bg p-3 text-body-sm text-error">
              <Icon icon={Alert02Icon} size={15} />
              <span>{error}</span>
            </div>
          )}

          <GradientButton className="w-full" disabled={starting} onClick={() => void start()}>
            {starting ? 'Starting…' : 'Start'}
          </GradientButton>

          <GhostButton size="sm" onClick={() => navigate('/local-setup')}>
            Use a different key
          </GhostButton>

          <p className="text-center text-caption text-content-faint">
            The key stays on this machine, in <span className="font-mono">~/.openclaw-clawmuse/.env</span>.
            Nothing is uploaded.
          </p>
        </div>
      </div>
    </div>
  )
}
