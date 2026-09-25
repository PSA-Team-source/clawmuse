import { exportClip, exportGif, exportPng, type AvatarConfig, type ExportCompose } from '@/features/avatar'

/**
 * Share clips: the avatar celebrating beside a share card, as a looping GIF
 * or WebM, drawn by the avatar exporter. The card is the PNG main already drew
 * (the same pixels the user saw), so a clip adds motion, never new content.
 *
 * Deterministic: the exporter replays the animation at fixed steps and the
 * layout is a function of the card's size, so the same card makes the same
 * clip.
 */

/**
 * The celebration jumps every 0.9 s and throws confetti every other jump.
 * Starting one confetti cycle in and running two makes the last frame lead
 * into the first, so the clip loops without a seam.
 */
export const CLIP_TIMING = { offset: 1.8, seconds: 3.6, gifFps: 15, videoFps: 30 } as const
/** Still for reduced motion: the top of a jump, as the confetti bursts. */
const STILL_TIME = CLIP_TIMING.offset + 0.28

const PAD = 32
const GAP = 12
const AVATAR = 288
const CARD_W = 480
const MAX_CARD_H = 720
const BACKGROUND = '#181819'
const GLOW = '255, 90, 78' // brand coral
/**
 * A quiet credit under the avatar. The card's own footer says the same, but a
 * tall card is scaled down so far in the clip that its footer stops being
 * legible; this line stays the same size whatever the card.
 */
export const CLIP_CREDIT = 'ClawMuse · clawmuse.app'
const CREDIT_FONT = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'

const even = (n: number) => Math.ceil(n / 2) * 2 // video encoders want even sizes

/** Where everything goes, from the card PNG's pixel size. */
export function shareClipLayout(cardWidth: number, cardHeight: number) {
  if (!(cardWidth > 0 && cardHeight > 0)) throw new RangeError('The card has no size')
  const scale = Math.min(CARD_W / cardWidth, MAX_CARD_H / cardHeight)
  const w = Math.round(cardWidth * scale)
  const h = Math.round(cardHeight * scale)
  const width = even(PAD + AVATAR + GAP + CARD_W + PAD)
  const height = even(Math.max(AVATAR, h) + 2 * PAD)
  return {
    width,
    height,
    avatar: { x: PAD, y: Math.round((height - AVATAR) / 2), size: AVATAR },
    card: { x: PAD + AVATAR + GAP + Math.round((CARD_W - w) / 2), y: Math.round((height - h) / 2), w, h },
    /** Centre-baseline of the credit, inside the bottom padding under the avatar column. */
    credit: { x: PAD + AVATAR / 2, y: height - Math.round(PAD / 2) + 4 },
  }
}

async function loadCard(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  return image
}

/** The still parts (background, glow, card) drawn once; each frame adds only the avatar. */
async function composeFor(cardDataUrl: string): Promise<ExportCompose> {
  const card = await loadCard(cardDataUrl)
  const layout = shareClipLayout(card.naturalWidth, card.naturalHeight)
  const base = document.createElement('canvas')
  base.width = layout.width
  base.height = layout.height
  const ctx = base.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, layout.width, layout.height)
  const { x, y, size } = layout.avatar
  const glow = ctx.createRadialGradient(x + size / 2, y + size * 0.55, 0, x + size / 2, y + size * 0.55, size * 0.6)
  glow.addColorStop(0, `rgba(${GLOW}, 0.32)`)
  glow.addColorStop(1, `rgba(${GLOW}, 0)`)
  ctx.fillStyle = glow
  ctx.fillRect(x - size * 0.1, y - size * 0.1, size * 1.2, size * 1.2)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(layout.card.x, layout.card.y, layout.card.w, layout.card.h, 18)
  ctx.clip()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(card, layout.card.x, layout.card.y, layout.card.w, layout.card.h)
  ctx.restore()
  ctx.font = CREDIT_FONT
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
  ctx.fillText(CLIP_CREDIT, layout.credit.x, layout.credit.y)
  return {
    width: layout.width,
    height: layout.height,
    draw(out, avatar) {
      out.drawImage(base, 0, 0)
      out.drawImage(avatar, x, y, size, size)
    },
  }
}

export type ShareClipKind = 'gif' | 'webm' | 'still'

/**
 * A share clip of `cardDataUrl`. GIF renders faster than real time; WebM
 * records in real time (≈3.6 s, keep the window visible); `still` is the
 * reduced-motion preview (PNG).
 */
export async function makeShareClip(cardDataUrl: string, kind: ShareClipKind, config?: AvatarConfig): Promise<Blob> {
  const compose = await composeFor(cardDataUrl)
  const common = { state: 'celebrating', size: AVATAR, compose } as const
  if (kind === 'still') return exportPng(config, { ...common, time: STILL_TIME })
  const { offset, seconds } = CLIP_TIMING
  return kind === 'gif'
    ? exportGif(config, { ...common, offset, seconds, fps: CLIP_TIMING.gifFps })
    : exportClip(config, { ...common, offset, seconds, fps: CLIP_TIMING.videoFps })
}
