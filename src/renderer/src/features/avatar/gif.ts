/**
 * A small animated-GIF encoder (GIF89a), no dependencies.
 *
 * GIF is still the format that plays everywhere a link preview or chat does,
 * which is the point of a shareable mascot clip. It has 256 colours and 1-bit
 * alpha, so this is for small clips; WebM (exporter.ts) is the full-quality path.
 *
 * - One global palette for all frames, by median cut over a 15-bit histogram
 *   (the flat-shaded voxel look quantises cleanly without dithering).
 * - Transparency: pixels under alpha 128 map to a reserved index, and frames
 *   use disposal 2 so a moving figure leaves no trail.
 */

export interface GifFrame {
  /** RGBA, row-major, `width * height * 4` bytes (an ImageData's `data`). */
  data: Uint8ClampedArray | Uint8Array
}

export interface GifOptions {
  width: number
  height: number
  /** Frame duration in ms (GIF stores centiseconds; rounding is spread evenly). */
  frameMs: number
  /** Keep alpha (1-bit). Default true. */
  transparent?: boolean
  /** 0 = loop forever (default). */
  loop?: number
}

const ALPHA_CUTOFF = 128

export function encodeGif(frames: readonly GifFrame[], opts: GifOptions): Uint8Array {
  const { width, height } = opts
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 65535 || height > 65535) {
    throw new RangeError('GIF dimensions must be integers in 1..65535')
  }
  if (frames.length === 0) throw new RangeError('GIF needs at least one frame')
  const transparent = opts.transparent ?? true
  const pixels = width * height
  for (const f of frames) {
    if (f.data.length !== pixels * 4) throw new RangeError('Frame size does not match width × height')
  }

  const { palette, lookup } = buildPalette(frames, transparent ? 255 : 256)
  const transparentIndex = transparent ? 255 : -1

  const out = new ByteWriter(pixels * frames.length * 0.3 + 1024)
  out.str('GIF89a')
  out.u16(width)
  out.u16(height)
  out.byte(0xf7) // global table, 8-bit colour resolution, 256 entries
  out.byte(0)
  out.byte(0)
  for (let i = 0; i < 256; i++) {
    const c = palette[i] ?? 0
    out.byte((c >> 16) & 255)
    out.byte((c >> 8) & 255)
    out.byte(c & 255)
  }
  // NETSCAPE2.0 looping extension.
  out.bytes([0x21, 0xff, 0x0b])
  out.str('NETSCAPE2.0')
  out.bytes([0x03, 0x01])
  out.u16(opts.loop ?? 0)
  out.byte(0)

  const indices = new Uint8Array(pixels)
  let elapsedCs = 0
  for (let f = 0; f < frames.length; f++) {
    const data = frames[f]!.data
    for (let p = 0, i = 0; p < pixels; p++, i += 4) {
      if (transparent && data[i + 3]! < ALPHA_CUTOFF) {
        indices[p] = transparentIndex
      } else {
        indices[p] = lookup(data[i]!, data[i + 1]!, data[i + 2]!)
      }
    }
    // Spread rounding so 15 fps stays 15 fps over the clip (7,7,6,7,7,6…).
    const endCs = Math.round(((f + 1) * opts.frameMs) / 10)
    const delay = Math.max(2, endCs - elapsedCs)
    elapsedCs = endCs
    // Graphic control: disposal 2 (restore to background), transparency flag.
    out.bytes([0x21, 0xf9, 0x04, (2 << 2) | (transparent ? 1 : 0)])
    out.u16(delay)
    out.byte(transparent ? transparentIndex : 0)
    out.byte(0)
    // Image descriptor, full frame, no local table.
    out.byte(0x2c)
    out.u16(0)
    out.u16(0)
    out.u16(width)
    out.u16(height)
    out.byte(0)
    lzwEncode(indices, 8, out)
  }
  out.byte(0x3b)
  return out.result()
}

// ── Palette ───────────────────────────────────────────────────────────────────

interface Box {
  bins: number[]
}

function channel(bin: number, c: number): number {
  return (bin >> (10 - c * 5)) & 31
}

function buildPalette(frames: readonly GifFrame[], maxColors: number) {
  const hist = new Uint32Array(32768)
  for (const f of frames) {
    const d = f.data
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < ALPHA_CUTOFF) continue
      hist[((d[i]! >> 3) << 10) | ((d[i + 1]! >> 3) << 5) | (d[i + 2]! >> 3)]!++
    }
  }
  const used: number[] = []
  for (let b = 0; b < hist.length; b++) if (hist[b]) used.push(b)

  const boxes: Box[] = used.length ? [{ bins: used }] : []
  while (boxes.length < maxColors) {
    // Split the box with the widest population-weighted spread.
    let best = -1
    let bestScore = 0
    let bestChannel = 0
    for (let i = 0; i < boxes.length; i++) {
      const bins = boxes[i]!.bins
      if (bins.length < 2) continue
      let count = 0
      for (const b of bins) count += hist[b]!
      for (let c = 0; c < 3; c++) {
        let lo = 31
        let hi = 0
        for (const b of bins) {
          const v = channel(b, c)
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
        const score = (hi - lo) * Math.sqrt(count)
        if (score > bestScore) {
          bestScore = score
          best = i
          bestChannel = c
        }
      }
    }
    if (best < 0) break
    const bins = boxes[best]!.bins.slice().sort((a, b) => channel(a, bestChannel) - channel(b, bestChannel))
    let total = 0
    for (const b of bins) total += hist[b]!
    let acc = 0
    let cut = 1
    for (let i = 0; i < bins.length - 1; i++) {
      acc += hist[bins[i]!]!
      if (acc >= total / 2) {
        cut = i + 1
        break
      }
      cut = i + 1
    }
    boxes.splice(best, 1, { bins: bins.slice(0, cut) }, { bins: bins.slice(cut) })
  }

  const palette: number[] = boxes.map(({ bins }) => {
    let n = 0
    let r = 0
    let g = 0
    let b = 0
    for (const bin of bins) {
      const w = hist[bin]!
      n += w
      r += ((channel(bin, 0) << 3) | 4) * w
      g += ((channel(bin, 1) << 3) | 4) * w
      b += ((channel(bin, 2) << 3) | 4) * w
    }
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)
  })
  if (palette.length === 0) palette.push(0)

  const cache = new Int16Array(32768).fill(-1)
  const lookup = (r: number, g: number, b: number): number => {
    const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const hit = cache[bin]!
    if (hit >= 0) return hit
    const cr = (channel(bin, 0) << 3) | 4
    const cg = (channel(bin, 1) << 3) | 4
    const cb = (channel(bin, 2) << 3) | 4
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i]!
      const dr = ((c >> 16) & 255) - cr
      const dg = ((c >> 8) & 255) - cg
      const db = (c & 255) - cb
      // Perceptual-ish weights: green matters most, blue least.
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    cache[bin] = best
    return best
  }
  return { palette, lookup }
}

// ── LZW ───────────────────────────────────────────────────────────────────────

function lzwEncode(indices: Uint8Array, minCodeSize: number, out: ByteWriter): void {
  out.byte(minCodeSize)
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  let codeSize = minCodeSize + 1
  let next = eoi + 1
  const dict = new Map<number, number>()

  const block = new Uint8Array(255)
  let blockLen = 0
  let bitBuf = 0
  let bitCount = 0
  const flushBlock = () => {
    if (!blockLen) return
    out.byte(blockLen)
    out.bytes(block.subarray(0, blockLen))
    blockLen = 0
  }
  const emit = (code: number) => {
    bitBuf |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      block[blockLen++] = bitBuf & 255
      if (blockLen === 255) flushBlock()
      bitBuf >>>= 8
      bitCount -= 8
    }
  }

  emit(clear)
  let prefix = indices[0]!
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!
    const key = (prefix << 8) | k
    const found = dict.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    emit(prefix)
    if (next < 4096) {
      dict.set(key, next++)
      // Grow once the next code would not fit; decoders widen on the same code.
      if (next > 1 << codeSize && codeSize < 12) codeSize++
    } else {
      emit(clear)
      dict.clear()
      codeSize = minCodeSize + 1
      next = eoi + 1
    }
    prefix = k
  }
  emit(prefix)
  emit(eoi)
  if (bitCount > 0) {
    block[blockLen++] = bitBuf & 255
    if (blockLen === 255) flushBlock()
  }
  flushBlock()
  out.byte(0)
}

class ByteWriter {
  private buf: Uint8Array
  private len = 0
  constructor(initial: number) {
    this.buf = new Uint8Array(Math.max(1024, Math.floor(initial)))
  }
  private grow(extra: number): void {
    if (this.len + extra <= this.buf.length) return
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + extra))
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
  byte(b: number): void {
    this.grow(1)
    this.buf[this.len++] = b & 255
  }
  u16(v: number): void {
    this.byte(v & 255)
    this.byte((v >> 8) & 255)
  }
  bytes(arr: ArrayLike<number>): void {
    this.grow(arr.length)
    for (let i = 0; i < arr.length; i++) this.buf[this.len++] = arr[i]! & 255
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i))
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}
