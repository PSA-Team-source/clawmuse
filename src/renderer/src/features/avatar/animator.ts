/**
 * The avatar's brain: states, reactions and blending — as pure math.
 *
 * No three.js here. The animator turns (state history, time, inputs) into a
 * `Pose` — a flat record of numbers (joint angles, eye openness, mouth shape,
 * spark glow…) — and the rig (rig.ts) writes that pose onto meshes. Keeping the
 * two apart is what makes the animation testable in jsdom and exportable frame
 * by frame: a pose is a function of time and the events that happened, so
 * stepping the same events at the same times gives the same frames.
 *
 * Blending is time-based, not per-frame lerping: each `setState` opens a layer
 * whose weight ramps 0→1 over `blendSeconds` with smoothstep, and every older
 * layer is scaled by (1 − newer ramps). Weights always sum to 1, a transition
 * in the middle of another is continuous, and the result does not depend on
 * frame rate.
 */
import { hash01, mulberry32 } from '@/features/room3d/engine/rng'

export const AVATAR_STATES = [
  'idle',
  'talking',
  'thinking',
  'working',
  'celebrating',
  'waving',
  'sleeping',
] as const
export type AvatarState = (typeof AVATAR_STATES)[number]

export const AVATAR_REACTIONS = ['poke', 'spin', 'dance'] as const
export type AvatarReaction = (typeof AVATAR_REACTIONS)[number]

export function isAvatarState(value: unknown): value is AvatarState {
  return typeof value === 'string' && (AVATAR_STATES as readonly string[]).includes(value)
}

export const CHANNELS = [
  'bodyY', 'bodyRotX', 'bodyRotY', 'bodyRotZ', 'squash',
  'headRotX', 'headRotY', 'headRotZ',
  'armLX', 'armLZ', 'armRX', 'armRZ',
  'legLX', 'legRX',
  'clawL', 'clawR',
  'eyeOpen', 'pupilX', 'pupilY',
  'browAngle', 'browLift', 'browAsym',
  'mouthOpen', 'mouthWidth', 'mouthSmile',
  'sparkSpin', 'sparkY', 'sparkScale', 'sparkGlow',
  'laptop', 'zzz', 'confetti', 'confettiAge',
] as const
export type Channel = (typeof CHANNELS)[number]
export type Pose = Record<Channel, number>

export function neutralPose(): Pose {
  const p = {} as Pose
  for (const c of CHANNELS) p[c] = 0
  p.squash = 1
  p.eyeOpen = 1
  p.mouthWidth = 1
  p.mouthSmile = 0.3
  p.sparkScale = 1
  p.sparkGlow = 0.3
  p.clawL = 0.2
  p.clawR = 0.2
  p.confettiAge = -1
  return p
}

// ── Mouth shapes ──────────────────────────────────────────────────────────────

export const MOUTH_SHAPES = {
  neutral: { open: 0, width: 1, smile: 0 },
  smile: { open: 0.05, width: 1.15, smile: 1 },
  open: { open: 0.8, width: 1, smile: 0.3 },
  O: { open: 0.65, width: 0.55, smile: 0 },
  frown: { open: 0, width: 0.9, smile: -1 },
  sleep: { open: 0.15, width: 0.5, smile: 0 },
} as const
export type MouthShape = keyof typeof MOUTH_SHAPES

function mouth(out: Pose, shape: MouthShape, amount = 1): void {
  const m = MOUTH_SHAPES[shape]
  out.mouthOpen = m.open * amount
  out.mouthWidth = 1 + (m.width - 1) * amount
  out.mouthSmile = m.smile * amount
}

// ── Math helpers ──────────────────────────────────────────────────────────────

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v)
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const mod = (a: number, n: number): number => ((a % n) + n) % n
const TAU = Math.PI * 2

/**
 * Frame-rate independent exponential approach: after `tau` seconds a value has
 * covered ~63% of the distance to its target, whatever the frame rate.
 */
export function smoothToward(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return dt <= 0 ? current : target
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

/** Mouth-driving level: opens fast (syllable attack), closes slower (no chatter). */
export const TALK_ATTACK = 0.05
export const TALK_RELEASE = 0.16
export function smoothTalk(current: number, target: number, dt: number): number {
  const t = clamp(target)
  return clamp(smoothToward(current, t, dt, t > current ? TALK_ATTACK : TALK_RELEASE))
}

/**
 * Crossfade weights for a stack of layers entered at `enterTimes` (oldest
 * first). The oldest layer is treated as fully in. Sums to 1.
 */
export function blendWeights(enterTimes: readonly number[], t: number, blendSeconds: number): number[] {
  const n = enterTimes.length
  const w = new Array<number>(n).fill(0)
  let remaining = 1
  for (let i = n - 1; i >= 0; i--) {
    const ramp = i === 0 ? 1 : blendSeconds <= 0 ? 1 : smoothstep(0, 1, (t - enterTimes[i]!) / blendSeconds)
    w[i] = ramp * remaining
    remaining *= 1 - ramp
  }
  return w
}

/**
 * Blink closedness (0 open … 1 shut) at time t. One blink per 4-second bucket
 * at a seeded offset, with an occasional double blink — deterministic, so a
 * blink lands on the same frame of every export.
 */
export function blinkAmount(t: number, seed: number): number {
  const BUCKET = 4
  const HALF = 0.075
  let closed = 0
  const b = Math.floor(t / BUCKET)
  for (let k = b - 1; k <= b; k++) {
    const at = k * BUCKET + 0.4 + hash01(seed, k) * 3.0
    const d = Math.abs(t - at)
    if (d < HALF) closed = Math.max(closed, 1 - d / HALF)
    if (hash01(seed ^ 0x5bd1e995, k) < 0.25) {
      const d2 = Math.abs(t - (at + 0.24))
      if (d2 < HALF) closed = Math.max(closed, 1 - d2 / HALF)
    }
  }
  return closed
}

/**
 * A speech-like talk level for when there is no live source (exports, demos):
 * words of ~0.2–0.5s with short gaps. Deterministic in (t, seed).
 */
export function syntheticTalk(t: number, seed: number): number {
  const WORD = 0.36
  const k = Math.floor(t / WORD)
  const phase = (t - k * WORD) / WORD
  const gap = hash01(seed, k * 7 + 1) < 0.18
  if (gap) return 0
  const loud = 0.55 + 0.45 * hash01(seed, k * 7 + 2)
  return loud * Math.sin(Math.PI * phase)
}

/** Maps a streaming-text rate (characters/second) to a 0..1 talk level. */
export function talkLevelFromRate(charsPerSecond: number): number {
  if (!Number.isFinite(charsPerSecond) || charsPerSecond <= 0) return 0
  // ~15 chars/s is relaxed reading pace; ~60+ is a fast token stream.
  return clamp(0.25 + (charsPerSecond / 60) * 0.75)
}

/**
 * Turns a stream of text deltas into a talk level: `push(text.length)` on each
 * delta, read `level()` per frame. The rate is measured over a short window so
 * a stall closes the mouth within ~a third of a second.
 */
export function createTalkMeter(windowMs = 320, now: () => number = () => performance.now()) {
  const samples: { at: number; chars: number }[] = []
  return {
    push(chars: number): void {
      if (chars > 0 && Number.isFinite(chars)) samples.push({ at: now(), chars })
    },
    level(): number {
      const t = now()
      while (samples.length && t - samples[0]!.at > windowMs) samples.shift()
      if (!samples.length) return 0
      const total = samples.reduce((sum, s) => sum + s.chars, 0)
      return talkLevelFromRate((total * 1000) / windowMs)
    },
    reset(): void {
      samples.length = 0
    },
  }
}

// ── State poses ───────────────────────────────────────────────────────────────

export interface PoseInputs {
  /** Smoothed talk level 0..1. */
  talk: number
  /** Smoothed look target, −1..1 (x right, y up) relative to the avatar. */
  lookX: number
  lookY: number
  /** Seeded phase so two avatars never sway in lockstep. */
  phase: number
  /** 1 = full motion, 0 = prefers-reduced-motion (face only, no big moves). */
  motion: number
}

/** Where the eyes go when the state is not following the cursor. */
function look(out: Pose, inp: PoseInputs, follow: number, ownX = 0, ownY = 0): void {
  const lx = follow * inp.lookX + (1 - follow) * ownX
  const ly = follow * inp.lookY + (1 - follow) * ownY
  out.pupilX = lx
  out.pupilY = ly
  out.headRotY += follow * inp.lookX * 0.32
  out.headRotX -= follow * inp.lookY * 0.16
}

function idleBody(out: Pose, t: number, inp: PoseInputs): void {
  const m = inp.motion
  const φ = inp.phase
  // Coefficients are the room engine's standing idle (engine.ts), so an avatar
  // and its room counterpart breathe the same way.
  out.bodyY = Math.sin(t * 1.8 + φ * 1.5) * 0.03 * m
  out.headRotY = Math.sin(t * 0.7 + φ * 2) * 0.1 * m
  out.headRotX = Math.sin(t * 0.5 + φ * 1.3) * 0.05 * m
  out.armLX = Math.sin(t + φ) * 0.1 * m
  out.armRX = Math.sin(t + φ + Math.PI) * 0.1 * m
  out.armLZ = -0.08
  out.armRZ = 0.08
  out.legLX = Math.sin(t * 0.8 + φ) * 0.05 * m
  out.legRX = Math.sin(t * 0.8 + φ + Math.PI) * 0.05 * m
  // A rocking turn, never edge-on for long: the spark is the brand mark.
  out.sparkSpin = Math.sin(t * 1.1 + φ) * 0.55 * m
  out.sparkY = Math.sin(t * 2) * 0.05 * m
  out.sparkGlow = 0.35 + Math.sin(t * 1.5) * 0.1
}

function sit(out: Pose, t: number, inp: PoseInputs): void {
  // Sitting on the floor, legs out: hips (0.55) drop to just above the floor.
  out.bodyY = -0.47 + Math.sin(t * 1.2 + inp.phase * 1.5) * 0.01 * inp.motion
  out.legLX = -1.5
  out.legRX = -1.5
}

export function statePose(state: AvatarState, t: number, local: number, inp: PoseInputs, out: Pose): Pose {
  Object.assign(out, NEUTRAL)
  const m = inp.motion
  switch (state) {
    case 'idle': {
      idleBody(out, t, inp)
      out.clawL = out.clawR = 0.15 + 0.2 * Math.pow(Math.max(0, Math.sin(t * 0.9 + inp.phase)), 12)
      mouth(out, 'smile', 0.35)
      look(out, inp, 1)
      break
    }
    case 'talking': {
      idleBody(out, t, inp)
      const talk = inp.talk
      // A steady stream still needs syllables, so the level is modulated.
      const syll = 0.35 + 0.65 * Math.abs(Math.sin(t * 11.5 + Math.sin(t * 3.1) * 1.2))
      out.mouthOpen = talk * syll * 0.9
      out.mouthWidth = 1 - out.mouthOpen * 0.3
      out.mouthSmile = 0.3 * (1 - talk * 0.5)
      out.headRotX += talk * Math.sin(t * 7) * 0.05 * m
      out.armRX = (-0.35 + Math.sin(t * 3) * 0.15) * talk * m + out.armRX * (1 - talk)
      out.armRZ = 0.08 + 0.25 * talk * m
      out.clawR = 0.2 + talk * 0.5 * Math.abs(Math.sin(t * 5))
      out.browLift = talk * 0.6 * Math.abs(Math.sin(t * 2.3))
      out.sparkGlow = 0.4 + talk * 0.5
      look(out, inp, 0.7)
      break
    }
    case 'thinking': {
      out.bodyY = Math.sin(t * 1.2 + inp.phase) * 0.02 * m
      out.bodyRotZ = Math.sin(t * 0.6) * 0.02 * m
      // Right mitt to the chin (solved from shoulder → chin: x −0.35, y +0.3, z +0.22).
      out.armRX = -2.5
      out.armRZ = -0.76
      // Left arm folded across, propping the right elbow.
      out.armLX = -0.9
      out.armLZ = 0.55
      out.headRotZ = 0.12 + Math.sin(t * 0.8) * 0.03 * m
      out.headRotX = -0.1
      out.clawR = 0.3 + 0.3 * Math.max(0, Math.sin(t * 6)) * m
      out.clawL = 0.1
      out.browAngle = 0.1
      out.browAsym = 0.6
      out.mouthWidth = 0.6
      out.mouthSmile = -0.15
      out.sparkSpin = t * (1.5 + 4.5 * m)
      out.sparkGlow = 0.8 + Math.sin(t * 8) * 0.2
      out.sparkScale = 1.15 + Math.sin(t * 5) * 0.1 * m
      out.sparkY = 0.06 + Math.sin(t * 2.5) * 0.04 * m
      look(out, inp, 0, 0.55, 0.7)
      break
    }
    case 'working': {
      sit(out, t, inp)
      // The room's sitting/typing pose, arms reaching further to a lap laptop.
      out.armLX = -0.85 + Math.sin(t * 14 + inp.phase) * 0.07 * m
      out.armRX = -0.85 + Math.sin(t * 14 + inp.phase + 1.5) * 0.07 * m
      out.armLZ = 0.12
      out.armRZ = -0.12
      out.headRotY = Math.sin(t * 0.5 + inp.phase * 2) * 0.05 * m
      out.headRotX = 0.22 + Math.sin(t * 0.8 + inp.phase) * 0.03 * m
      out.clawL = 0.25 + 0.25 * Math.max(0, Math.sin(t * 14)) * m
      out.clawR = 0.25 + 0.25 * Math.max(0, Math.sin(t * 14 + 1.5)) * m
      out.browAngle = -0.15
      mouth(out, 'smile', 0.15)
      out.laptop = 1
      out.sparkSpin = t * 2.5 * (0.25 + 0.75 * m)
      out.sparkGlow = 0.5 + Math.sin(t * 3) * 0.1
      look(out, inp, 0, 0, -0.6)
      break
    }
    case 'celebrating': {
      const P = 0.9
      const τ = mod(local, P)
      const airT = 0.62 * P
      const air = τ < airT ? Math.sin((Math.PI * τ) / airT) : 0
      const land = τ >= airT ? Math.sin((Math.PI * (τ - airT)) / (P - airT)) : 0
      out.bodyY = 0.42 * air * m
      out.squash = 1 + (0.1 * air - 0.16 * land) * m
      out.armLZ = -2.7 + Math.sin(t * 12) * 0.15 * m
      out.armRZ = 2.7 - Math.sin(t * 12 + 1) * 0.15 * m
      out.legLX = -0.35 * air * m
      out.legRX = 0.35 * air * m
      out.eyeOpen = 0.32
      out.mouthOpen = 0.7
      out.mouthWidth = 1.15
      out.mouthSmile = 1
      out.browLift = 0.8
      out.clawL = out.clawR = 0.6 + 0.4 * Math.sin(t * 14)
      out.sparkGlow = 1
      out.sparkSpin = t * (1.5 + 3.5 * m)
      out.sparkY = 0.1 + air * 0.1 * m
      // A burst every other jump, first one at the top of the first jump.
      const age = local - 0.28
      out.confetti = m > 0 && age >= 0 ? 1 : 0
      out.confettiAge = age >= 0 ? mod(age, 2 * P) : -1
      look(out, inp, 0.3)
      break
    }
    case 'waving': {
      idleBody(out, t, inp)
      out.armRZ = 2.5 + Math.sin(t * 9) * 0.35 * m
      out.armRX = -0.2
      out.clawR = 0.45 + 0.4 * Math.sin(t * 9)
      out.headRotZ = -0.08
      out.bodyRotZ = Math.sin(t * 2) * 0.04 * m
      out.browLift = 0.5
      mouth(out, 'smile')
      out.mouthOpen = 0.25
      look(out, inp, 0.9)
      break
    }
    case 'sleeping': {
      sit(out, t, inp)
      const breath = Math.sin(t * 1.6)
      out.squash = 1 + breath * 0.018
      out.headRotX = 0.35 + breath * 0.03 * m
      out.headRotZ = 0.18
      out.armLX = -0.35
      out.armRX = -0.35
      out.armLZ = -0.05
      out.armRZ = 0.05
      out.clawL = out.clawR = 0
      out.eyeOpen = 0
      mouth(out, 'sleep')
      out.mouthOpen = 0.12 + 0.08 * breath
      out.browAngle = 0.1
      out.browLift = -0.3
      out.zzz = 1
      out.sparkGlow = 0.1
      out.sparkScale = 0.85
      out.sparkSpin = Math.sin(t * 0.5) * 0.25 * m
      out.sparkY = -0.05 + Math.sin(t * 1.2) * 0.03 * m
      break
    }
  }
  return out
}
const NEUTRAL = neutralPose()

// ── Reactions ─────────────────────────────────────────────────────────────────

export const REACTION_DURATION: Record<AvatarReaction, number> = { poke: 0.9, spin: 1.1, dance: 2.64 }
const REACTION_FADE: Record<AvatarReaction, [number, number]> = {
  poke: [0.05, 0.25],
  spin: [0.01, 0.3],
  dance: [0.15, 0.3],
}

export function reactionEnvelope(kind: AvatarReaction, age: number): number {
  const dur = REACTION_DURATION[kind]
  const [fadeIn, fadeOut] = REACTION_FADE[kind]
  if (age < 0 || age >= dur) return 0
  return smoothstep(0, fadeIn, age) * (1 - smoothstep(dur - fadeOut, dur, age))
}

/** Writes the reacting pose (built on top of `base`) into `out`. */
export function reactionPose(kind: AvatarReaction, age: number, dir: number, base: Pose, motion: number, out: Pose): Pose {
  Object.assign(out, base)
  const m = motion
  switch (kind) {
    case 'poke': {
      // Squash on contact, then a damped wobble — the giggle.
      const decay = Math.exp(-5 * age)
      out.squash = base.squash * (1 - 0.22 * decay * Math.cos(20 * age) * m)
      out.bodyRotZ = base.bodyRotZ + Math.sin(age * 25) * 0.12 * Math.exp(-3 * age) * m
      out.headRotZ = base.headRotZ + Math.sin(age * 22) * 0.15 * Math.exp(-3 * age) * m
      out.armLZ = -0.6
      out.armRZ = 0.6
      out.clawL = out.clawR = 1
      out.eyeOpen = 0.3
      out.mouthOpen = 0.55
      out.mouthWidth = 1.1
      out.mouthSmile = 1
      out.browLift = 0.7
      out.sparkGlow = 1
      break
    }
    case 'spin': {
      const x = clamp(age / 0.8)
      const turning = x < 1
      // Exactly 0 once the turn completes, so fading out never unwinds it.
      out.bodyRotY = base.bodyRotY + (turning ? Math.sign(dir || 1) * TAU * easeInOutCubic(x) * m : 0)
      out.bodyY = base.bodyY + Math.sin(Math.PI * x) * 0.1 * m
      out.armLZ = turning ? -1.2 : base.armLZ
      out.armRZ = turning ? 1.2 : base.armRZ
      if (age > 0.55) {
        // Dizzy: pupils circle, mouth goes O.
        out.eyeOpen = 0.55
        out.pupilX = Math.cos(age * 14) * 0.6
        out.pupilY = Math.sin(age * 14) * 0.6
        mouth(out, 'O', 0.8)
      } else {
        mouth(out, 'open', 0.6)
      }
      out.sparkSpin = base.sparkSpin + age * 9
      break
    }
    case 'dance': {
      const beat = (age * Math.PI) / 0.33
      const s = Math.sin(beat)
      out.bodyRotZ = s * 0.18 * m
      out.bodyY = base.bodyY + Math.abs(s) * 0.12 * m
      out.bodyRotY = base.bodyRotY + Math.sin(beat / 2) * 0.35 * m
      out.armLZ = -1.3 - s * 0.9 * m
      out.armRZ = 1.3 - s * 0.9 * m
      out.armLX = out.armRX = -0.2
      out.legLX = s * 0.35 * m
      out.legRX = -s * 0.35 * m
      out.headRotX = base.headRotX + Math.sin(beat * 2) * 0.08 * m
      out.clawL = out.clawR = 0.5 + 0.5 * Math.sin(age * 19)
      out.eyeOpen = 0.35
      mouth(out, 'smile')
      out.mouthOpen = 0.3 + 0.2 * Math.abs(s)
      out.sparkGlow = 0.9
      out.sparkSpin = base.sparkSpin + age * 6
      break
    }
  }
  return out
}

export function lerpPose(a: Pose, b: Pose, w: number, out: Pose): Pose {
  for (const c of CHANNELS) out[c] = a[c] + (b[c] - a[c]) * w
  return out
}

// ── Animator ──────────────────────────────────────────────────────────────────

export interface AnimatorOptions {
  seed: number
  initialState?: AvatarState
  reducedMotion?: boolean
  blendSeconds?: number
}

interface Layer {
  state: AvatarState
  enter: number
}
interface Reaction {
  kind: AvatarReaction
  start: number
  dir: number
}

const MAX_LAYERS = 6

/**
 * Stateful wrapper around the pure pose functions. Every mutating call takes
 * the time it happened at (seconds, the same clock as `sample`), so replaying
 * the same calls at the same times reproduces the same frames.
 */
export class AvatarAnimator {
  private layers: Layer[]
  private reactions: Reaction[] = []
  private talkTarget = 0
  private talk = 0
  private lookTarget = { x: 0, y: 0 }
  private lookNow = { x: 0, y: 0 }
  private lastT: number | null = null
  private phase: number
  private seed: number
  private motion: number
  readonly blendSeconds: number
  private readonly scratch = neutralPose()
  private readonly acc = neutralPose()
  private readonly reacted = neutralPose()
  private readonly out = neutralPose()

  constructor(opts: AnimatorOptions) {
    this.seed = opts.seed >>> 0
    this.phase = mulberry32(this.seed)() * TAU
    this.motion = opts.reducedMotion ? 0 : 1
    this.blendSeconds = opts.blendSeconds ?? 0.35
    // The bottom layer always counts as fully blended in (see blendWeights);
    // its enter time is kept only as the clock for state-local motion.
    this.layers = [{ state: opts.initialState ?? 'idle', enter: 0 }]
  }

  get state(): AvatarState {
    return this.layers[this.layers.length - 1]!.state
  }

  get talkLevel(): number {
    return this.talk
  }

  setSeed(seed: number): void {
    this.seed = seed >>> 0
    this.phase = mulberry32(this.seed)() * TAU
  }

  setReducedMotion(reduced: boolean): void {
    this.motion = reduced ? 0 : 1
  }

  /** Blends to `state` starting at `t`. `immediate` skips the crossfade. */
  setState(state: AvatarState, t: number, immediate = false): void {
    if (!isAvatarState(state)) return
    if (immediate) {
      this.layers = [{ state, enter: t }]
      return
    }
    if (state === this.state) return
    this.layers.push({ state, enter: t })
    if (this.layers.length > MAX_LAYERS) this.layers.splice(0, this.layers.length - MAX_LAYERS)
  }

  setTalkLevel(level: number): void {
    this.talkTarget = Number.isFinite(level) ? clamp(level) : 0
  }

  /** Look target relative to the avatar, each axis −1..1 (x right, y up). */
  lookAt(x: number, y: number): void {
    this.lookTarget.x = Number.isFinite(x) ? clamp(x, -1, 1) : 0
    this.lookTarget.y = Number.isFinite(y) ? clamp(y, -1, 1) : 0
  }

  clearLook(): void {
    this.lookTarget.x = 0
    this.lookTarget.y = 0
  }

  /**
   * Plays a one-shot reaction. A new reaction cuts the previous one short
   * (it fades out rather than popping). `dir` is the spin direction.
   */
  react(kind: AvatarReaction, t: number, dir = 1): void {
    this.reactions = this.reactions.filter((r) => t - r.start < REACTION_DURATION[r.kind])
    const current = this.reactions[this.reactions.length - 1]
    if (current) {
      // Re-time the old one so it is in its fade-out window from now on.
      const [, fadeOut] = REACTION_FADE[current.kind]
      const age = t - current.start
      const fadeFrom = REACTION_DURATION[current.kind] - fadeOut
      if (age < fadeFrom) current.start = t - fadeFrom
    }
    this.reactions.push({ kind, start: t, dir })
    if (this.reactions.length > 3) this.reactions.shift()
  }

  /** True while a reaction is still visibly playing. */
  isReacting(t: number): boolean {
    return this.reactions.some((r) => reactionEnvelope(r.kind, t - r.start) > 0)
  }

  /** The pose at time `t`. The returned object is reused — copy it to keep it. */
  sample(t: number): Pose {
    const dt = this.lastT === null ? 0 : clamp(t - this.lastT, 0, 0.1)
    this.lastT = t
    this.talk = smoothTalk(this.talk, this.talkTarget, dt)
    this.lookNow.x = smoothToward(this.lookNow.x, this.lookTarget.x, dt, 0.12)
    this.lookNow.y = smoothToward(this.lookNow.y, this.lookTarget.y, dt, 0.12)
    const inp: PoseInputs = {
      talk: this.talk,
      lookX: this.lookNow.x,
      lookY: this.lookNow.y,
      phase: this.phase,
      motion: this.motion,
    }

    // Base state layers.
    const weights = blendWeights(
      this.layers.map((l) => l.enter),
      t,
      this.blendSeconds,
    )
    const acc = this.acc
    for (const c of CHANNELS) acc[c] = 0
    let confettiAge = -1
    let confettiW = 0
    for (let i = 0; i < this.layers.length; i++) {
      const w = weights[i]!
      if (w <= 0) continue
      const layer = this.layers[i]!
      const p = statePose(layer.state, t, t - layer.enter, inp, this.scratch)
      for (const c of CHANNELS) acc[c] += p[c] * w
      // Confetti age is a clock, not a quantity — take it from whichever
      // celebrating layer dominates rather than averaging it.
      if (p.confettiAge >= 0 && w > confettiW) {
        confettiW = w
        confettiAge = p.confettiAge
      }
    }
    acc.confettiAge = confettiAge
    // Drop layers that no longer contribute (newest has fully blended in).
    const newest = weights.length - 1
    if (newest > 0 && weights[newest]! >= 1) this.layers = [this.layers[newest]!]

    // Reactions on top.
    let pose = acc
    for (const r of this.reactions) {
      const age = t - r.start
      const env = reactionEnvelope(r.kind, age)
      if (env <= 0) continue
      reactionPose(r.kind, age, r.dir, pose, this.motion, this.reacted)
      pose = lerpPose(pose, this.reacted, env, this.out)
    }
    if (pose === acc) Object.assign(this.out, acc)
    this.reactions = this.reactions.filter((r) => t - r.start < REACTION_DURATION[r.kind])

    // Blink over whatever the eyes are doing (sleeping stays shut).
    this.out.eyeOpen *= 1 - blinkAmount(t, this.seed)
    return this.out
  }
}
