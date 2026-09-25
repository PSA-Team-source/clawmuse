/**
 * Avatar configuration — what a ClawMuse avatar looks like.
 *
 * Pure data, no three.js: this is what gets stored, synced and shared, so it is
 * validated like any other untrusted input. A bad field falls back to its
 * default instead of throwing — an avatar that renders with the house colours
 * is always better than one that does not render.
 */
import * as z from 'zod'
import { ACCENT_COLORS, HAIR_PALETTE, SKIN_PALETTE } from '@/features/room3d/engine/constants'
import { seedOf } from '@/features/room3d/engine/rng'

export const AVATAR_STYLES = ['muse', 'mage', 'striker', 'sentinel', 'healer'] as const
export type AvatarStyle = (typeof AVATAR_STYLES)[number]

export const AVATAR_ACCESSORIES = ['none', 'cap', 'glasses', 'crown', 'headphones'] as const
export type AvatarAccessory = (typeof AVATAR_ACCESSORIES)[number]

/** Brand coral — the app icon's background, and the muse's outfit. */
export const CLAWMUSE_CORAL = '#FF5A4E'
const MUSE_HAIR = 0x2b2233
const MUSE_SKIN = 0xf5d6c0

export interface AvatarColors {
  /** Outfit / accent: torso, mitts, feet. `#RRGGBB`. */
  outfit?: string
  skin?: string
  hair?: string
}

export interface AvatarConfig {
  style?: AvatarStyle
  colors?: AvatarColors
  accessory?: AvatarAccessory
  /** Everything random about the avatar (idle phase, blink rhythm, spikes, confetti) derives from this. */
  seed?: string | number
  name?: string
}

/** A config with every field decided — what the renderer consumes. */
export interface ResolvedAvatarConfig {
  style: AvatarStyle
  colors: { outfit: number; skin: number; hair: number }
  accessory: AvatarAccessory
  seed: number
  name: string
}

export const DEFAULT_AVATAR_CONFIG: Readonly<Required<Omit<AvatarConfig, 'colors'>>> = {
  style: 'muse',
  accessory: 'none',
  seed: 'clawmuse',
  name: 'Muse',
}

const HEX = /^#?([0-9a-fA-F]{6})$/
const hexColor = z
  .string()
  .regex(HEX)
  .transform((value) => parseInt(value.replace('#', ''), 16))

const Schema = z.object({
  style: z.enum(AVATAR_STYLES).catch(DEFAULT_AVATAR_CONFIG.style),
  accessory: z.enum(AVATAR_ACCESSORIES).catch(DEFAULT_AVATAR_CONFIG.accessory),
  seed: z
    .union([z.string().trim().min(1).max(128), z.number().finite()])
    .catch(DEFAULT_AVATAR_CONFIG.seed),
  name: z.string().trim().min(1).max(40).catch(DEFAULT_AVATAR_CONFIG.name),
  colors: z
    .object({
      outfit: hexColor.optional().catch(undefined),
      skin: hexColor.optional().catch(undefined),
      hair: hexColor.optional().catch(undefined),
    })
    .catch({}),
})

/**
 * Fills in and validates a config. Accepts anything (a stored JSON blob, a
 * partial from a settings form); unknown or invalid fields take defaults.
 * Colours that are not given are picked from the room palettes by seed, so two
 * agents with different seeds look different without anyone choosing colours —
 * except the muse, whose defaults are the brand's.
 */
export function resolveAvatarConfig(input?: unknown): ResolvedAvatarConfig {
  const raw = input && typeof input === 'object' ? input : {}
  const parsed = Schema.parse({
    style: undefined,
    accessory: undefined,
    seed: undefined,
    name: undefined,
    colors: undefined,
    ...raw,
  })
  const seed = seedOf(parsed.seed)
  const isMuse = parsed.style === 'muse'
  const accent = ACCENT_COLORS[seed % ACCENT_COLORS.length]!
  return {
    style: parsed.style,
    accessory: parsed.accessory,
    seed,
    name: parsed.name,
    colors: {
      outfit: parsed.colors.outfit ?? parseInt((isMuse ? CLAWMUSE_CORAL : accent).slice(1), 16),
      skin: parsed.colors.skin ?? (isMuse ? MUSE_SKIN : SKIN_PALETTE[seed % SKIN_PALETTE.length]!),
      hair: parsed.colors.hair ?? (isMuse ? MUSE_HAIR : HAIR_PALETTE[(seed + 3) % HAIR_PALETTE.length]!),
    },
  }
}

/**
 * The avatar an agent gets when nobody has designed one: the default agent is
 * the ClawMuse muse, every other bot a non-muse body picked from its id, so
 * two bots in a roster never look alike and one bot looks the same everywhere.
 */
export function avatarConfigForAgent(agent: { id: string; name?: string | null; isDefault?: boolean } | null | undefined): AvatarConfig {
  const name = agent?.name?.trim() || undefined
  if (!agent || agent.isDefault) return { name }
  const styles = AVATAR_STYLES.filter((style) => style !== 'muse')
  return { style: styles[seedOf(agent.id) % styles.length], seed: agent.id, name }
}

/** Stable identity of a resolved config — equal keys render identical meshes. */
export function avatarConfigKey(config: ResolvedAvatarConfig): string {
  const { style, accessory, seed, colors } = config
  return `${style}|${accessory}|${seed}|${colors.outfit}|${colors.skin}|${colors.hair}`
}

export function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`
}
