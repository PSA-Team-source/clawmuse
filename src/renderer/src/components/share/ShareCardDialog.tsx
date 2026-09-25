import { useEffect, useState } from 'react'
import { Copy01Icon, Download04Icon, Share08Icon } from '@hugeicons/core-free-icons'
import type { ShareCardAction, ShareCardInput, ShareCardRender } from '@shared/share-card'
import { GhostButton, GradientButton, Spinner } from '@/components/brand'
import { Dialog, Icon } from '@/components/primitives'
import { useToast } from '@/components/patterns'
import { IS_MAC } from '@/lib/platform'
import { useShareCardStore } from '@/stores/share-card.store'

type Busy = 'copy' | 'save' | 'system' | null

/**
 * The Share sheet: main draws the card to a PNG on this computer, the user
 * sees exactly that picture, then copies it, saves it or hands it to the macOS
 * share sheet. Mounted once at the app root; screens open it with `shareCard`.
 */
export function ShareCardDialog() {
  const request = useShareCardStore((state) => state.request)
  const close = useShareCardStore((state) => state.close)
  const toast = useToast()
  // Keyed by the request it answers, so a new request shows "Making…" at once
  // and a slow render for an earlier one can never land on a later card.
  const [rendered, setRendered] = useState<{ request: ShareCardInput; result: ShareCardRender } | null>(null)
  const result = rendered && rendered.request === request ? rendered.result : null
  const [busy, setBusy] = useState<Busy>(null)

  useEffect(() => {
    if (!request) return
    let current = true
    void window.clawmuse.share.render(request)
      .catch((error: unknown): ShareCardRender => ({ ok: false, error: error instanceof Error ? error.message : 'The card could not be made' }))
      .then((next) => { if (current) setRendered({ request, result: next }) })
    return () => { current = false }
  }, [request])

  async function act(kind: Exclude<Busy, null>): Promise<void> {
    if (!result?.ok || busy) return
    setBusy(kind)
    const outcome: ShareCardAction = await window.clawmuse.share[kind](result.id)
      .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : 'That did not work' }))
    setBusy(null)
    if (!outcome.ok) {
      if (!outcome.canceled) toast.show({ title: kind === 'save' ? 'Could not save the image' : 'That did not work', description: outcome.error, variant: 'error' })
      return
    }
    if (kind === 'copy') toast.show({ title: 'Image copied', description: 'Paste it anywhere to share.', variant: 'success' })
    if (kind === 'save') toast.show({ title: 'Image saved', description: outcome.path, variant: 'success' })
  }

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => { if (!open) close() }}
      title="Share"
      description="Made on this computer. Nothing is uploaded."
      className="w-[480px]"
    >
      <div data-share-card-state={!result ? 'rendering' : result.ok ? 'ready' : 'failed'} className="flex max-h-[58vh] min-h-40 items-center justify-center overflow-y-auto rounded-2xl">
        {!result ? (
          <div role="status" className="flex items-center gap-2.5 py-10 text-body-sm text-content-secondary"><Spinner size={16} />Making your card…</div>
        ) : result.ok ? (
          <img src={result.dataUrl} width={result.width / 2} height={result.height / 2} alt="Share card preview" className="h-auto w-full rounded-2xl shadow-composer" />
        ) : (
          <p role="alert" className="py-10 text-center text-body-sm text-content-secondary">{result.error}</p>
        )}
      </div>
      {result?.ok && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {IS_MAC && (
            <GhostButton size="sm" disabled={Boolean(busy)} onClick={() => void act('system')}>
              <Icon icon={Share08Icon} size={16} className="text-current" />Share…
            </GhostButton>
          )}
          <GhostButton size="sm" disabled={Boolean(busy)} onClick={() => void act('save')}>
            <Icon icon={Download04Icon} size={16} className="text-current" />Save…
          </GhostButton>
          <GradientButton size="sm" loading={busy === 'copy'} disabled={Boolean(busy)} onClick={() => void act('copy')}>
            <Icon icon={Copy01Icon} size={16} className="text-current" />Copy image
          </GradientButton>
        </div>
      )}
    </Dialog>
  )
}
