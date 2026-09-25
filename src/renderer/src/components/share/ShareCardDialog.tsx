import { useEffect, useState } from 'react'
import { ArrowLeft01Icon, Copy01Icon, Download04Icon, Gif01Icon, Share08Icon, Video01Icon } from '@hugeicons/core-free-icons'
import type { ShareCardAction, ShareCardInput, ShareCardRender } from '@shared/share-card'
import { GhostButton, GradientButton, Spinner } from '@/components/brand'
import { Dialog, Icon } from '@/components/primitives'
import { useToast } from '@/components/patterns'
import { hasWebGL } from '@/features/avatar'
import { IS_MAC } from '@/lib/platform'
import { useShareCardStore } from '@/stores/share-card.store'
import { makeShareClip } from './share-clip'

type Busy = 'copy' | 'save' | 'system' | 'video' | null

/** A clip made from one card: the GIF (registered with main), its preview, and the WebM once recorded. */
interface Clip {
  cardId: string
  gifId: string
  /** Object URL of the GIF, or of a still under reduced motion. */
  previewUrl: string
  animated: boolean
  videoId?: string
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

const failure = (error: unknown, fallback: string): string => (error instanceof Error && error.message) || fallback

/** Registers a clip blob with main (validated there) and returns its share id. */
async function registerClip(cardId: string, format: 'gif' | 'webm', blob: Blob): Promise<string> {
  const result = await window.clawmuse.share.clip({ cardId, format, data: new Uint8Array(await blob.arrayBuffer()) })
  if (!result.ok) throw new Error(result.error)
  return result.id
}

/**
 * The Share sheet: main draws the card to a PNG on this computer, the user
 * sees exactly that picture, then copies it, saves it or hands it to the macOS
 * share sheet. "Share as clip" turns the same card into a looping clip with
 * the avatar celebrating beside it (GIF, or WebM on request). Mounted once at
 * the app root; screens open it with `shareCard`.
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
  // The clip view, for the card on screen only (a new card starts back on the image).
  const [clipFor, setClipFor] = useState<string | null>(null)
  const [clip, setClip] = useState<Clip | { cardId: string; error: string } | null>(null)
  const cardId = result?.ok ? result.id : null
  const showClip = Boolean(cardId && clipFor === cardId)
  const currentClip = clip && clip.cardId === cardId ? clip : null
  const canClip = hasWebGL()

  useEffect(() => {
    if (!request) return
    let current = true
    void window.clawmuse.share.render(request)
      .catch((error: unknown): ShareCardRender => ({ ok: false, error: error instanceof Error ? error.message : 'The card could not be made' }))
      .then((next) => { if (current) setRendered({ request, result: next }) })
    return () => { current = false }
  }, [request])

  // Makes the GIF (fast, off the wall clock) the first time the clip view opens for a card.
  useEffect(() => {
    if (!showClip || !result?.ok || currentClip) return
    let current = true
    const card = result
    const animated = !reducedMotion()
    void (async () => {
      try {
        const gif = await makeShareClip(card.dataUrl, 'gif')
        const gifId = await registerClip(card.id, 'gif', gif)
        const preview = animated ? gif : await makeShareClip(card.dataUrl, 'still')
        if (current) setClip({ cardId: card.id, gifId, previewUrl: URL.createObjectURL(preview), animated })
      } catch (error) {
        if (current) setClip({ cardId: card.id, error: failure(error, 'The clip could not be made') })
      }
    })()
    return () => { current = false }
  }, [showClip, result, currentClip])

  // One preview URL alive at a time.
  const previewUrl = clip && 'previewUrl' in clip ? clip.previewUrl : null
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  async function act(kind: 'copy' | 'save' | 'system', id: string, what: 'image' | 'clip' | 'video'): Promise<void> {
    if (busy) return
    setBusy(kind)
    const outcome: ShareCardAction = await window.clawmuse.share[kind](id)
      .catch((error: unknown) => ({ ok: false as const, error: failure(error, 'That did not work') }))
    setBusy(null)
    const noun = what === 'image' ? 'image' : what === 'clip' ? 'GIF' : 'video'
    if (!outcome.ok) {
      if (!outcome.canceled) toast.show({ title: kind === 'save' ? `Could not save the ${noun}` : 'That did not work', description: outcome.error, variant: 'error' })
      return
    }
    if (kind === 'copy') toast.show({ title: `${noun === 'image' ? 'Image' : 'GIF'} copied`, description: 'Paste it anywhere to share.', variant: 'success' })
    if (kind === 'save') toast.show({ title: `${noun === 'image' ? 'Image' : noun === 'GIF' ? 'GIF' : 'Video'} saved`, description: outcome.path, variant: 'success' })
  }

  /** WebM records in real time, so it is made only when asked for, then saved. */
  async function saveVideo(): Promise<void> {
    if (busy || !result?.ok || !currentClip || !('gifId' in currentClip)) return
    let videoId = currentClip.videoId
    if (!videoId) {
      setBusy('video')
      try {
        videoId = await registerClip(result.id, 'webm', await makeShareClip(result.dataUrl, 'webm'))
        const id = videoId
        setClip((prev) => (prev && 'gifId' in prev && prev.cardId === result.id ? { ...prev, videoId: id } : prev))
      } catch (error) {
        toast.show({ title: 'Could not make the video', description: failure(error, 'Recording failed'), variant: 'error' })
        return
      } finally {
        setBusy(null)
      }
    }
    await act('save', videoId, 'video')
  }

  const ready = currentClip && 'gifId' in currentClip ? currentClip : null

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => { if (!open) close() }}
      title={showClip ? 'Share as clip' : 'Share'}
      description="Made on this computer. Nothing is uploaded."
      className="w-[480px]"
    >
      {showClip ? (
        <div data-share-clip-state={!currentClip ? 'rendering' : ready ? 'ready' : 'failed'} className="flex max-h-[58vh] min-h-40 items-center justify-center overflow-y-auto rounded-2xl">
          {!currentClip ? (
            <div role="status" className="flex items-center gap-2.5 py-10 text-body-sm text-content-secondary"><Spinner size={16} />Making your clip…</div>
          ) : ready ? (
            <img src={ready.previewUrl} alt={ready.animated ? 'Share clip preview' : 'Share clip preview (still — reduced motion is on)'} className="h-auto w-full rounded-2xl shadow-composer" />
          ) : (
            <p role="alert" className="py-10 text-center text-body-sm text-content-secondary">{'error' in currentClip ? currentClip.error : ''}</p>
          )}
        </div>
      ) : (
        <div data-share-card-state={!result ? 'rendering' : result.ok ? 'ready' : 'failed'} className="flex max-h-[58vh] min-h-40 items-center justify-center overflow-y-auto rounded-2xl">
          {!result ? (
            <div role="status" className="flex items-center gap-2.5 py-10 text-body-sm text-content-secondary"><Spinner size={16} />Making your card…</div>
          ) : result.ok ? (
            <img src={result.dataUrl} width={result.width / 2} height={result.height / 2} alt="Share card preview" className="h-auto w-full rounded-2xl shadow-composer" />
          ) : (
            <p role="alert" className="py-10 text-center text-body-sm text-content-secondary">{result.error}</p>
          )}
        </div>
      )}
      {result?.ok && !showClip && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {canClip && (
            <GhostButton size="sm" disabled={Boolean(busy)} onClick={() => {
              // A clip that failed is made again, not shown failing again.
              if (clip && 'error' in clip) setClip(null)
              setClipFor(result.id)
            }} className="mr-auto">
              <Icon icon={Gif01Icon} size={16} className="text-current" />Share as clip
            </GhostButton>
          )}
          {IS_MAC && (
            <GhostButton size="sm" disabled={Boolean(busy)} onClick={() => void act('system', result.id, 'image')}>
              <Icon icon={Share08Icon} size={16} className="text-current" />Share…
            </GhostButton>
          )}
          <GhostButton size="sm" disabled={Boolean(busy)} onClick={() => void act('save', result.id, 'image')}>
            <Icon icon={Download04Icon} size={16} className="text-current" />Save…
          </GhostButton>
          <GradientButton size="sm" loading={busy === 'copy'} disabled={Boolean(busy)} onClick={() => void act('copy', result.id, 'image')}>
            <Icon icon={Copy01Icon} size={16} className="text-current" />Copy image
          </GradientButton>
        </div>
      )}
      {showClip && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <GhostButton size="sm" disabled={Boolean(busy)} onClick={() => setClipFor(null)} className="mr-auto">
            <Icon icon={ArrowLeft01Icon} size={16} className="text-current" />Image
          </GhostButton>
          {ready && (
            <>
              {IS_MAC && (
                <GhostButton size="sm" disabled={Boolean(busy)} onClick={() => void act('system', ready.gifId, 'clip')}>
                  <Icon icon={Share08Icon} size={16} className="text-current" />Share…
                </GhostButton>
              )}
              <GhostButton size="sm" disabled={Boolean(busy)} onClick={() => void saveVideo()}>
                {busy === 'video' ? <Spinner size={16} /> : <Icon icon={Video01Icon} size={16} className="text-current" />}
                {busy === 'video' ? 'Recording…' : 'Save video…'}
              </GhostButton>
              {IS_MAC ? (
                <>
                  <GhostButton size="sm" disabled={Boolean(busy)} onClick={() => void act('save', ready.gifId, 'clip')}>
                    <Icon icon={Download04Icon} size={16} className="text-current" />Save GIF…
                  </GhostButton>
                  <GradientButton size="sm" loading={busy === 'copy'} disabled={Boolean(busy)} onClick={() => void act('copy', ready.gifId, 'clip')}>
                    <Icon icon={Copy01Icon} size={16} className="text-current" />Copy GIF
                  </GradientButton>
                </>
              ) : (
                <GradientButton size="sm" loading={busy === 'save'} disabled={Boolean(busy)} onClick={() => void act('save', ready.gifId, 'clip')}>
                  <Icon icon={Download04Icon} size={16} className="text-current" />Save GIF…
                </GradientButton>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}
