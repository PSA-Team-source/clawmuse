import { describe, expect, it } from 'vitest'
import {
  AVATAR_STATES,
  AvatarAnimator,
  CHANNELS,
  REACTION_DURATION,
  blendWeights,
  blinkAmount,
  createTalkMeter,
  neutralPose,
  smoothTalk,
  statePose,
  talkLevelFromRate,
  type AvatarState,
  type Pose,
} from '../animator'
import { mulberry32, seedOf } from '@/features/room3d/engine/rng'

const inputs = { talk: 0, lookX: 0, lookY: 0, phase: 0.7, motion: 1 }

function run(seed: number, script: (a: AvatarAnimator, t: number) => void, seconds = 4, fps = 60): Pose[] {
  const a = new AvatarAnimator({ seed })
  const out: Pose[] = []
  for (let f = 0; f <= seconds * fps; f++) {
    const t = f / fps
    script(a, t)
    out.push({ ...a.sample(t) })
  }
  return out
}

const script = (a: AvatarAnimator, t: number) => {
  if (Math.abs(t - 0.5) < 1e-9) a.setState('talking', t)
  if (Math.abs(t - 1) < 1e-9) a.react('poke', t)
  if (Math.abs(t - 2) < 1e-9) a.setState('celebrating', t)
  a.setTalkLevel(t > 0.5 && t < 2 ? 0.8 : 0)
  a.lookAt(Math.sin(t), Math.cos(t))
}

describe('seeded randomness', () => {
  it('mulberry32 repeats for a seed and differs across seeds', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const c = mulberry32(43)
    const xs = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(xs)
    expect(c()).not.toBe(xs[0])
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true)
  })

  it('seedOf is stable for strings and numbers', () => {
    expect(seedOf('clawmuse')).toBe(seedOf('clawmuse'))
    expect(seedOf('a')).not.toBe(seedOf('b'))
    expect(seedOf(7.9)).toBe(7)
  })
})

describe('blendWeights', () => {
  it('always sums to 1 and ramps the newest layer in', () => {
    const enters = [0, 1, 1.2]
    for (let t = 0; t < 2; t += 0.01) {
      const w = blendWeights(enters, t, 0.35)
      expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10)
      for (const x of w) expect(x).toBeGreaterThanOrEqual(0)
    }
    expect(blendWeights(enters, 0.9, 0.35)).toEqual([1, 0, 0])
    expect(blendWeights(enters, 5, 0.35)[2]).toBe(1)
  })

  it('is continuous through a transition started mid-blend', () => {
    const enters = [0, 1, 1.1]
    let prev = blendWeights(enters, 1.0, 0.35)
    for (let t = 1.001; t < 1.6; t += 0.001) {
      const w = blendWeights(enters, t, 0.35)
      for (let i = 0; i < w.length; i++) expect(Math.abs(w[i]! - prev[i]!)).toBeLessThan(0.02)
      prev = w
    }
  })
})

describe('AvatarAnimator', () => {
  it('is deterministic: same seed + same events = same frames', () => {
    const a = run(1234, script)
    const b = run(1234, script)
    expect(b).toEqual(a)
  })

  it('differs between seeds (phase and blink rhythm are seeded)', () => {
    const a = run(1, script)
    const b = run(2, script)
    expect(a.some((p, i) => Math.abs(p.bodyY - b[i]!.bodyY) > 1e-3)).toBe(true)
  })

  it('never pops on a state change', () => {
    for (const from of AVATAR_STATES) {
      for (const to of AVATAR_STATES) {
        const a = new AvatarAnimator({ seed: 9, initialState: from })
        a.sample(0)
        a.sample(1)
        let prev = { ...a.sample(1) }
        a.setState(to, 1)
        for (let t = 1 + 1 / 120; t < 1.6; t += 1 / 120) {
          const p = a.sample(t)
          for (const c of CHANNELS) {
            if (c === 'confettiAge' || c === 'confetti' || c === 'eyeOpen') continue // a burst and a blink are events, not blended motion
            expect(Math.abs(p[c] - prev[c]), `${from}→${to} ${c} @${t.toFixed(3)}`).toBeLessThan(0.45)
          }
          prev = { ...p }
        }
      }
    }
  })

  it('settles exactly on the target state pose after the blend', () => {
    const a = new AvatarAnimator({ seed: 5 })
    a.sample(0)
    a.setState('thinking', 0.1)
    const t = 0.1 + a.blendSeconds + 0.5
    for (let s = 0.1; s < t; s += 1 / 60) a.sample(s)
    const got = a.sample(t)
    const want = statePose('thinking', t, t - 0.1, { ...inputs, phase: (a as unknown as { phase: number }).phase }, neutralPose())
    expect(got.armRX).toBeCloseTo(want.armRX, 6)
    expect(got.sparkGlow).toBeCloseTo(want.sparkGlow, 6)
    expect(a.state).toBe('thinking')
  })

  it('ignores unknown states and supports an immediate cut', () => {
    const a = new AvatarAnimator({ seed: 5 })
    a.setState('dancing' as AvatarState, 0)
    expect(a.state).toBe('idle')
    a.setState('sleeping', 1, true)
    expect(a.state).toBe('sleeping')
    expect(a.sample(1).zzz).toBe(1)
  })

  it('reactions play out and end, and a spin leaves the avatar facing front', () => {
    const a = new AvatarAnimator({ seed: 5 })
    a.sample(0)
    a.react('spin', 0, 1)
    expect(a.isReacting(0.2)).toBe(true)
    let maxTurn = 0
    for (let t = 0; t < REACTION_DURATION.spin + 0.1; t += 1 / 60) maxTurn = Math.max(maxTurn, a.sample(t).bodyRotY)
    expect(maxTurn).toBeGreaterThan(5)
    expect(a.isReacting(REACTION_DURATION.spin + 0.01)).toBe(false)
    expect(Math.abs(a.sample(REACTION_DURATION.spin + 0.2).bodyRotY)).toBeLessThan(1e-9)
  })

  it('a poke squashes then recovers', () => {
    const a = new AvatarAnimator({ seed: 5 })
    a.sample(0)
    a.react('poke', 0)
    expect(a.sample(0.06).squash).toBeLessThan(0.95)
    expect(a.sample(2).squash).toBeCloseTo(1, 6)
  })

  it('sleeping keeps the eyes shut and blinks happen while awake', () => {
    const sleeper = new AvatarAnimator({ seed: 3, initialState: 'sleeping' })
    const awake = new AvatarAnimator({ seed: 3 })
    let minOpen = 1
    for (let t = 0; t < 8; t += 1 / 60) {
      expect(sleeper.sample(t).eyeOpen).toBe(0)
      minOpen = Math.min(minOpen, awake.sample(t).eyeOpen)
    }
    expect(minOpen).toBeLessThan(0.2)
  })

  it('reduced motion keeps the face but drops the big moves', () => {
    const a = new AvatarAnimator({ seed: 3, initialState: 'celebrating', reducedMotion: true })
    for (let t = 0; t < 3; t += 1 / 30) {
      const p = a.sample(t)
      expect(p.bodyY).toBe(0)
      expect(p.confetti).toBe(0)
      expect(p.mouthSmile).toBe(1)
    }
  })

  it('celebrating bursts confetti with a running age', () => {
    const a = new AvatarAnimator({ seed: 3, initialState: 'celebrating' })
    expect(a.sample(0.1).confettiAge).toBe(-1)
    const p = a.sample(0.5)
    expect(p.confetti).toBe(1)
    expect(p.confettiAge).toBeCloseTo(0.22, 5)
  })
})

describe('talk level', () => {
  it('opens faster than it closes and clamps', () => {
    const up = smoothTalk(0, 1, 0.05)
    const down = 1 - smoothTalk(1, 0, 0.05)
    expect(up).toBeGreaterThan(down)
    expect(smoothTalk(0, 5, 1)).toBeLessThanOrEqual(1)
    expect(smoothTalk(0.5, -1, 1)).toBeGreaterThanOrEqual(0)
  })

  it('is frame-rate independent', () => {
    let a = 0
    let b = 0
    for (let i = 0; i < 30; i++) a = smoothTalk(a, 1, 1 / 60)
    for (let i = 0; i < 15; i++) b = smoothTalk(b, 1, 1 / 30)
    expect(a).toBeCloseTo(b, 10)
  })

  it('drives the mouth only while talking', () => {
    const a = new AvatarAnimator({ seed: 1, initialState: 'talking' })
    a.setTalkLevel(1)
    let open = 0
    for (let t = 0; t < 1; t += 1 / 60) open = Math.max(open, a.sample(t).mouthOpen)
    expect(open).toBeGreaterThan(0.6)
    a.setTalkLevel(0)
    for (let t = 1; t < 2; t += 1 / 60) a.sample(t)
    expect(a.sample(2).mouthOpen).toBeLessThan(0.01)
  })

  it('maps a text stream rate to a level and falls silent after a stall', () => {
    expect(talkLevelFromRate(0)).toBe(0)
    expect(talkLevelFromRate(NaN)).toBe(0)
    expect(talkLevelFromRate(1000)).toBe(1)
    let now = 0
    const meter = createTalkMeter(300, () => now)
    for (let i = 0; i < 10; i++) {
      now += 30
      meter.push(3)
    }
    expect(meter.level()).toBeGreaterThan(0.4)
    now += 400
    expect(meter.level()).toBe(0)
  })
})

describe('blink', () => {
  it('is deterministic and brief', () => {
    let closedFrames = 0
    for (let t = 0; t < 40; t += 1 / 60) {
      const b = blinkAmount(t, 77)
      expect(b).toBe(blinkAmount(t, 77))
      if (b > 0.5) closedFrames++
    }
    // ~10 buckets × 1–2 blinks × ~4 frames each — never a long shut-eye.
    expect(closedFrames).toBeGreaterThan(20)
    expect(closedFrames).toBeLessThan(120)
  })
})
