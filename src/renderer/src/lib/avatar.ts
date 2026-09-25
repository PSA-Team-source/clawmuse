type Rgb = [number, number, number]

export interface AvatarPalette {
  light: { userBubble: string; userText: string }
  dark: { userBubble: string; userText: string }
}

/** Square-crops and downsizes an image to a PNG data URL small enough for OpenClaw's 700 KB avatar limit. */
export async function squareAvatar(file: Blob, size = 256): Promise<{ mime: 'image/png'; base64: string; dataUrl: string }> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/png')
  return { mime: 'image/png', base64: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl }
}

/** The avatar's characteristic colour: saturated, mid-tone pixels weighted by saturation. */
export async function dominantColor(src: string): Promise<Rgb | null> {
  const image = new Image()
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, 32, 32)
  const { data } = context.getImageData(0, 0, 32, 32)
  let r = 0, g = 0, b = 0, weight = 0
  for (let i = 0; i < data.length; i += 4) {
    const [pr, pg, pb, pa] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
    if (pa < 128) continue
    const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb)
    const saturation = max === 0 ? 0 : (max - min) / max
    if (max < 30 || (min > 235 && saturation < 0.1)) continue // near-black / near-white backgrounds
    const w = 0.05 + saturation
    r += pr * w; g += pg * w; b += pb * w; weight += w
  }
  return weight === 0 ? null : [Math.round(r / weight), Math.round(g / weight), Math.round(b / weight)]
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h / 6, s, l]
}

function toHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(h + 1 / 3)}${channel(h)}${channel(h - 1 / 3)}`
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** Whichever of Muse's two bubble text colours reads better on `bubble`. */
function textOn(bubble: string): string {
  const l = luminance(bubble)
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#111112' : '#ffffff'
}

/**
 * Muse's "Match my avatar": a pastel of the avatar's hue for light mode and a
 * deeper tone for dark mode, the same shape as its fixed palettes (light
 * bubbles ~L 86%, dark ~L 45%), with the more legible text colour.
 */
export function avatarPalette(color: Rgb): AvatarPalette {
  const [h, s] = toHsl(color)
  const light = toHex(h, Math.min(0.75, Math.max(0.35, s)), 0.86)
  const dark = toHex(h, Math.min(0.6, Math.max(0.3, s)), 0.45)
  return { light: { userBubble: light, userText: textOn(light) }, dark: { userBubble: dark, userText: textOn(dark) } }
}
