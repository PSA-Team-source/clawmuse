/**
 * Share cards: a PNG of something ClawMuse did for the user (a Feed story, an
 * Idea, a chat answer, a Weekly Recap), drawn locally by the main process. Nothing is uploaded.
 *
 * This file is the trust boundary's rulebook — the renderer sends whatever the
 * model wrote, and main accepts it only through `parseShareCardInput`. Pure, so
 * it is tested without Electron.
 */

export type ShareCardKind = 'feed' | 'idea' | 'answer' | 'recap'

const KINDS: readonly ShareCardKind[] = ['feed', 'idea', 'answer', 'recap']

/** A counted number on a Weekly Recap card, e.g. 12 "messages sent". */
export interface ShareCardStat {
  value: number
  label: string
}

export interface ShareCardInput {
  kind: ShareCardKind
  /** Markdown from the model; rendered as text only, never as HTML. */
  body: string
  title?: string
  /** An Idea's emoji. */
  emoji?: string
  /** `https:` URL or a `data:image/…;base64` URI; anything else is dropped. */
  image?: string
  /** Byline, e.g. "The Verge · Reuters". */
  source?: string
  /** A recap's numbers: whole, positive counts only. */
  stats?: ShareCardStat[]
}

export type ShareCardRender =
  | { ok: true; id: string; dataUrl: string; width: number; height: number }
  | { ok: false; error: string }

export type ShareCardAction = { ok: true; path?: string } | { ok: false; error: string; canceled?: boolean }

export const SHARE_CARD_LIMITS = {
  title: 200,
  body: 20_000,
  emoji: 16,
  source: 160,
  imageUrl: 2048,
  /** Base64 length of an inline image (~6 MB decoded). */
  imageDataUri: 8 * 1024 * 1024,
  stats: 6,
  statLabel: 40,
  statValue: 1_000_000,
} as const

/** What fits on the card before it stops reading like a card. */
export const CARD_BODY_CHARS = { withImage: 520, withoutImage: 900 } as const

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim()
  return text ? text.slice(0, max) : undefined
}

/** Only pictures a card can safely hold: https, or an inline raster image (never SVG, never file/http). */
export function isAllowedCardImage(value: string): boolean {
  if (value.startsWith('data:')) return value.length <= SHARE_CARD_LIMITS.imageDataUri && DATA_IMAGE.test(value)
  if (value.length > SHARE_CARD_LIMITS.imageUrl) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

/** Validates what the renderer sent. Throws on a request that cannot make a card. */
export function parseShareCardInput(raw: unknown): ShareCardInput {
  if (!raw || typeof raw !== 'object') throw new Error('Nothing to share')
  const value = raw as Record<string, unknown>
  const kind = value.kind
  if (!KINDS.includes(kind as ShareCardKind)) throw new Error('Unknown share card kind')
  const title = clean(value.title, SHARE_CARD_LIMITS.title)
  const body = clean(value.body, SHARE_CARD_LIMITS.body) ?? ''
  if (!title && !body) throw new Error('Nothing to share')
  const image = typeof value.image === 'string' && isAllowedCardImage(value.image.trim()) ? value.image.trim() : undefined
  const input: ShareCardInput = { kind: kind as ShareCardKind, body }
  if (title) input.title = title
  const emoji = clean(value.emoji, SHARE_CARD_LIMITS.emoji)
  if (emoji) input.emoji = emoji
  if (image) input.image = image
  const source = clean(value.source, SHARE_CARD_LIMITS.source)
  if (source) input.source = source
  const stats = (Array.isArray(value.stats) ? value.stats : []).flatMap((stat): ShareCardStat[] => {
    const { value: count, label } = (stat ?? {}) as Record<string, unknown>
    const text = clean(label, SHARE_CARD_LIMITS.statLabel)
    return text && Number.isInteger(count) && (count as number) > 0 && (count as number) <= SHARE_CARD_LIMITS.statValue ? [{ value: count as number, label: text }] : []
  }).slice(0, SHARE_CARD_LIMITS.stats)
  if (stats.length) input.stats = stats
  return input
}

/**
 * Shortens markdown to `max` characters at the most natural break before it —
 * a paragraph, then a sentence, then a word — and marks the cut with "…".
 * A code fence left open by the cut is closed so the rest never renders as code.
 */
export function trimForCard(markdown: string, max: number): string {
  const text = markdown.replace(/\n{3,}/g, '\n\n').trim()
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const floor = Math.floor(max * 0.5)
  let cut = head.lastIndexOf('\n\n')
  if (cut < floor) {
    const sentence = Math.max(...['. ', '! ', '? ', '.\n', '!\n', '?\n'].map((end) => head.lastIndexOf(end)))
    cut = sentence >= floor ? sentence + 1 : head.lastIndexOf(' ')
  }
  if (cut < floor) cut = max
  let out = head.slice(0, cut).replace(/[\s,;:–—-]+$/, '')
  if (((out.match(/^```/gm) ?? []).length) % 2 === 1) out += '\n```\n\n…'
  else out += /[.!?]$/.test(out) ? ' …' : '…'
  return out
}

/**
 * A share clip: the card's avatar clip, made in the renderer (which has the
 * WebGL avatar), registered with main so the card's Copy / Save / Share work
 * on it. `cardId` is the card it was made from — a clip of a card main never
 * drew is refused.
 */
export type ShareClipFormat = 'gif' | 'webm'
export interface ShareClipInput {
  cardId: string
  format: ShareClipFormat
  data: Uint8Array
}
export type ShareClipResult = { ok: true; id: string } | { ok: false; error: string }

/** A 3–4 s clip is a few MB at most; anything near this is not one of ours. */
export const SHARE_CLIP_MAX_BYTES = 40 * 1024 * 1024

const CLIP_MAGIC: Record<ShareClipFormat, readonly number[]> = {
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // "GIF89a"
  webm: [0x1a, 0x45, 0xdf, 0xa3], // EBML header
}

/** Validates a clip at the trust boundary: known format, bytes that are that format, bounded size. */
export function parseShareClipInput(raw: unknown): ShareClipInput {
  if (!raw || typeof raw !== 'object') throw new Error('Nothing to share')
  const value = raw as Record<string, unknown>
  const { cardId, format, data } = value
  if (typeof cardId !== 'string' || !cardId || cardId.length > 64) throw new Error('Unknown card')
  if (format !== 'gif' && format !== 'webm') throw new Error('Unknown clip format')
  if (!(data instanceof Uint8Array) || data.length === 0) throw new Error('The clip is empty')
  if (data.length > SHARE_CLIP_MAX_BYTES) throw new Error('The clip is too large')
  if (!CLIP_MAGIC[format].every((byte, i) => data[i] === byte)) throw new Error('That is not a clip')
  return { cardId, format, data }
}

/** A file name for the saved PNG: "ClawMuse - <title>.png", safe on every OS. */
export function shareCardFileName(input: Pick<ShareCardInput, 'kind' | 'title'>): string {
  const label = (input.title ?? { feed: 'Feed story', idea: 'Idea', answer: 'Answer', recap: 'Weekly recap' }[input.kind])
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=\u0000-\u001F]/g, '') // eslint-disable-line no-control-regex
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
  return `ClawMuse - ${label || 'Share'}.png`
}
