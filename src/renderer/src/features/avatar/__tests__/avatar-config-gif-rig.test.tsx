import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import * as THREE from 'three'
import { AVATAR_STATES, AvatarAnimator } from '../animator'
import { avatarConfigKey, resolveAvatarConfig, toHex } from '../config'
import { encodeGif, encodeGifAsync } from '../gif'
import { createAvatarRig } from '../rig'
import { AvatarBadge } from '../AvatarBadge'
import { AvatarStage } from '../AvatarStage'
import { buildCharacter } from '@/features/room3d/engine/character'
import type { CharacterData } from '@/features/room3d/engine/types'

describe('resolveAvatarConfig', () => {
  it('defaults to the ClawMuse muse in brand coral', () => {
    const c = resolveAvatarConfig()
    expect(c.style).toBe('muse')
    expect(toHex(c.colors.outfit)).toBe('#FF5A4E')
    expect(c.accessory).toBe('none')
    expect(c.name).toBe('Muse')
  })

  it('replaces invalid fields with defaults instead of throwing', () => {
    const c = resolveAvatarConfig({
      style: 'wizard',
      accessory: 'monocle',
      seed: '',
      name: 42,
      colors: { outfit: 'red', skin: '#12345', hair: '#00FF00' },
    })
    expect(c.style).toBe('muse')
    expect(c.accessory).toBe('none')
    expect(c.name).toBe('Muse')
    expect(c.colors.hair).toBe(0x00ff00)
    expect(toHex(c.colors.outfit)).toBe('#FF5A4E')
    expect(resolveAvatarConfig('nonsense').style).toBe('muse')
    expect(resolveAvatarConfig(null).seed).toBe(resolveAvatarConfig().seed)
  })

  it('picks palette colours from the seed, deterministically', () => {
    const a = resolveAvatarConfig({ style: 'mage', seed: 'kira' })
    const b = resolveAvatarConfig({ style: 'mage', seed: 'kira' })
    expect(avatarConfigKey(a)).toBe(avatarConfigKey(b))
    const keys = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => avatarConfigKey(resolveAvatarConfig({ style: 'mage', seed: s }))))
    expect(keys.size).toBeGreaterThan(1)
    expect(resolveAvatarConfig({ colors: { outfit: '5b7cff' } }).colors.outfit).toBe(0x5b7cff)
  })
})

describe('character builder', () => {
  const base: CharacterData = { name: 'Blaze', cls: '', accent: '#ff2d78', accentHex: 0xff2d78, skin: 0xd4a574, hair: 0xff4444, style: 'striker', stats: [0, 0, 0] }
  const spikes = (g: THREE.Group) =>
    (g.userData.headGroup as THREE.Group).children
      .filter((c) => (c as THREE.Mesh).geometry instanceof THREE.ConeGeometry)
      .map((c) => [c.position.y, c.position.z, c.rotation.z])

  it('builds striker spikes from the seed, not Math.random', () => {
    const a = spikes(buildCharacter(base, 0, []))
    const b = spikes(buildCharacter(base, 0, []))
    expect(a).toHaveLength(5)
    expect(b).toEqual(a)
    expect(spikes(buildCharacter({ ...base, seed: 99 }, 0, []))).not.toEqual(a)
  })

  it('gives the muse claw mitts and a spark, and keeps the other styles', () => {
    const muse = buildCharacter({ ...base, style: 'muse' }, 0, [])
    expect(muse.userData.claws).toHaveLength(2)
    expect(muse.userData.spark).toBeInstanceOf(THREE.Group)
    for (const style of ['mage', 'striker', 'sentinel', 'healer']) {
      const g = buildCharacter({ ...base, style }, 0, [])
      expect(g.userData.claws).toBeNull()
      expect(g.userData.spark).toBeNull()
      expect(g.userData.eyes).toHaveLength(2)
    }
  })
})

describe('avatar rig', () => {
  it('applies every state for every style and disposes cleanly', () => {
    for (const style of ['muse', 'mage', 'striker', 'sentinel', 'healer'] as const) {
      for (const accessory of ['none', 'cap', 'glasses', 'crown', 'headphones'] as const) {
        const rig = createAvatarRig(resolveAvatarConfig({ style, accessory, seed: style }))
        const anim = new AvatarAnimator({ seed: 1 })
        let t = 0
        for (const state of AVATAR_STATES) {
          anim.setState(state, t)
          for (let i = 0; i < 40; i++, t += 1 / 30) rig.apply(anim.sample(t), t)
        }
        anim.react('dance', t)
        rig.apply(anim.sample(t + 0.5), t + 0.5)
        rig.root.updateMatrixWorld(true)
        rig.root.traverse((o) => {
          for (const v of [o.position.x, o.position.y, o.rotation.x, o.scale.y]) expect(Number.isFinite(v)).toBe(true)
        })
        rig.dispose()
      }
    }
  })

  it('renders brand coral regardless of the room turning colour management off', () => {
    const prev = THREE.ColorManagement.enabled
    THREE.ColorManagement.enabled = false
    const rig = createAvatarRig(resolveAvatarConfig())
    const torso = (rig.root.userData.bodyGroup as THREE.Group).children[0] as THREE.Mesh
    const c = (torso.material as THREE.MeshStandardMaterial).color.clone().convertLinearToSRGB()
    expect(THREE.ColorManagement.enabled).toBe(false)
    expect(Math.round(c.r * 255)).toBe(0xff)
    expect(Math.round(c.g * 255)).toBe(0x5a)
    THREE.ColorManagement.enabled = prev
    rig.dispose()
  })
})

/** Minimal GIF decoder for the round-trip check: first frame's colours + alpha. */
function decodeFirstFrame(bytes: Uint8Array) {
  let p = 6
  const w = bytes[p]! | (bytes[p + 1]! << 8)
  const h = bytes[p + 2]! | (bytes[p + 3]! << 8)
  const packed = bytes[p + 4]!
  p += 7
  const tableSize = 2 << (packed & 7)
  const table = bytes.slice(p, p + tableSize * 3)
  p += tableSize * 3
  let transparentIndex = -1
  let frames = 0
  let first: Uint8Array | null = null
  while (p < bytes.length) {
    const b = bytes[p++]!
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = bytes[p++]!
      if (label === 0xf9 && bytes[p + 1]! & 1) transparentIndex = bytes[p + 4]!
      while (bytes[p]) p += bytes[p]! + 1
      p++
      continue
    }
    if (b !== 0x2c) throw new Error('bad block ' + b)
    p += 9
    const min = bytes[p++]!
    const data: number[] = []
    while (bytes[p]) {
      const n = bytes[p++]!
      for (let i = 0; i < n; i++) data.push(bytes[p++]!)
    }
    p++
    frames++
    if (!first) first = lzwDecode(data, min, w * h)
  }
  return { w, h, table, transparentIndex, frames, indices: first! }
}

/** Every frame composed onto the canvas (disposal 1: frames draw over the last), plus each frame's rectangle. */
function decodeAllFrames(bytes: Uint8Array) {
  const w = bytes[6]! | (bytes[7]! << 8)
  const h = bytes[8]! | (bytes[9]! << 8)
  const tableSize = 2 << (bytes[10]! & 7)
  let p = 13
  const table = bytes.slice(p, p + tableSize * 3)
  p += tableSize * 3
  const canvas = new Uint8Array(w * h)
  const canvases: Uint8Array[] = []
  const rects: { x: number; y: number; w: number; h: number }[] = []
  const u16 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8)
  while (p < bytes.length) {
    const b = bytes[p++]!
    if (b === 0x3b) break
    if (b === 0x21) {
      p++
      while (bytes[p]) p += bytes[p]! + 1
      p++
      continue
    }
    const rect = { x: u16(p), y: u16(p + 2), w: u16(p + 4), h: u16(p + 6) }
    p += 9
    const min = bytes[p++]!
    const data: number[] = []
    while (bytes[p]) {
      const n = bytes[p++]!
      for (let i = 0; i < n; i++) data.push(bytes[p++]!)
    }
    p++
    const pixels = lzwDecode(data, min, rect.w * rect.h)
    for (let y = 0; y < rect.h; y++) canvas.set(pixels.subarray(y * rect.w, (y + 1) * rect.w), (rect.y + y) * w + rect.x)
    rects.push(rect)
    canvases.push(canvas.slice())
  }
  return { rects, canvases, table }
}

function lzwDecode(data: number[], min: number, count: number): Uint8Array {
  const out = new Uint8Array(count)
  const clear = 1 << min
  let size = min + 1
  let dict: number[][] = []
  const reset = () => {
    dict = []
    for (let i = 0; i < clear; i++) dict[i] = [i]
    dict[clear] = []
    dict[clear + 1] = []
    size = min + 1
  }
  reset()
  let bit = 0
  let o = 0
  let prev: number[] | null = null
  while (o < count) {
    let code = 0
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i
    if (code === clear) {
      reset()
      prev = null
      continue
    }
    if (code === clear + 1) break
    let entry = dict[code]
    if (!entry) entry = [...prev!, prev![0]!]
    for (const v of entry) out[o++] = v
    if (prev) dict.push([...prev, entry[0]!])
    prev = entry
    if (dict.length === 1 << size && size < 12) size++
  }
  return out
}

describe('encodeGif', () => {
  it('round-trips colours and transparency', () => {
    const w = 40
    const h = 30
    const frames = [0, 1, 2].map((f) => {
      const data = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const inside = (x - 20) ** 2 + (y - 15) ** 2 < 100
          data[i] = inside ? 0xff : (x * 6) & 255
          data[i + 1] = inside ? 0x5a : (y * 8) & 255
          data[i + 2] = inside ? 0x4e : (f * 80) & 255
          data[i + 3] = x < 4 ? 0 : 255
        }
      }
      return { data }
    })
    const gif = encodeGif(frames, { width: w, height: h, frameMs: 1000 / 15 })
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a')
    expect(gif[gif.length - 1]).toBe(0x3b)
    const dec = decodeFirstFrame(gif)
    expect([dec.w, dec.h, dec.frames]).toEqual([w, h, 3])
    let maxErr = 0
    for (let p = 0; p < w * h; p++) {
      const idx = dec.indices[p]!
      const src = frames[0]!.data
      if (src[p * 4 + 3] === 0) {
        expect(idx).toBe(dec.transparentIndex)
        continue
      }
      expect(idx).not.toBe(dec.transparentIndex)
      for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(dec.table[idx * 3 + c]! - src[p * 4 + c]!))
    }
    expect(maxErr).toBeLessThan(24)
  })

  it('stores only what changed in opaque clips, and replays to the same frames (sync and async alike)', async () => {
    const w = 60
    const h = 40
    // A still coral card with a small square moving across it.
    const frames = [0, 1, 2, 3].map((f) => {
      const data = new Uint8ClampedArray(w * h * 4)
      for (let p = 0; p < w * h; p++) {
        const x = p % w
        const y = Math.floor(p / w)
        const box = x >= 5 + f * 6 && x < 12 + f * 6 && y >= 10 && y < 17
        data.set(box ? [0x20, 0x30, 0xe0, 255] : [0xff, 0x5a, 0x4e, (x * y) % 7 === 0 ? 200 : 255], p * 4)
      }
      return { data }
    })
    const opts = { width: w, height: h, frameMs: 1000 / 15, transparent: false }
    const gif = encodeGif(frames, opts)
    expect(await encodeGifAsync(frames, opts)).toEqual(gif)
    const { rects, canvases, table } = decodeAllFrames(gif)
    expect(rects[0]).toEqual({ x: 0, y: 0, w, h })
    // Frame 1 covers only the square's old and new place: x 5..17, y 10..16.
    expect(rects[1]).toEqual({ x: 5, y: 10, w: 13, h: 7 })
    for (let f = 0; f < frames.length; f++) {
      for (let p = 0; p < w * h; p++) {
        const idx = canvases[f]![p]!
        for (let c = 0; c < 3; c++) expect(Math.abs(table[idx * 3 + c]! - frames[f]!.data[p * 4 + c]!)).toBeLessThan(12)
      }
    }
  })

  it('rejects bad input', () => {
    expect(() => encodeGif([], { width: 1, height: 1, frameMs: 100 })).toThrow()
    expect(() => encodeGif([{ data: new Uint8ClampedArray(3) }], { width: 1, height: 1, frameMs: 100 })).toThrow()
  })
})

describe('without WebGL (jsdom)', () => {
  it('the badge and the stage fall back to the logo badge, never an empty box', () => {
    const badge = render(<AvatarBadge size={40} />)
    expect(badge.container.querySelector('canvas')).toBeNull()
    expect(badge.container.querySelector('svg')).not.toBeNull()
    const stage = render(<AvatarStage />)
    expect(stage.container.querySelector('canvas')).toBeNull()
    expect(stage.container.querySelector('svg')).not.toBeNull()
  })
})
