/**
 * ClawMuse avatar engine — public surface.
 *
 * Nothing here imports three.js at module load: the components and export
 * helpers pull the renderer in on first use, so a screen that merely could
 * show an avatar does not pay for the 3D bundle until it does.
 */
import type { AvatarConfig } from './config'
import type { ClipOptions, PngOptions } from './exporter'

export { AvatarStage, type AvatarStageProps } from './AvatarStage'
export { AvatarBadge, type AvatarBadgeProps } from './AvatarBadge'
export {
  AVATAR_ACCESSORIES,
  AVATAR_STYLES,
  CLAWMUSE_CORAL,
  DEFAULT_AVATAR_CONFIG,
  avatarConfigKey,
  resolveAvatarConfig,
  type AvatarAccessory,
  type AvatarColors,
  type AvatarConfig,
  type AvatarStyle,
  type ResolvedAvatarConfig,
} from './config'
export {
  AVATAR_REACTIONS,
  AVATAR_STATES,
  MOUTH_SHAPES,
  createTalkMeter,
  isAvatarState,
  talkLevelFromRate,
  type AvatarReaction,
  type AvatarState,
  type MouthShape,
} from './animator'
export type { AvatarController, StageStats } from './stage-engine'
export type { AvatarFraming } from './scene'
export type { ClipOptions, PngOptions } from './exporter'
export { hasWebGL } from './webgl-support'

/** PNG still of the avatar (transparent by default). */
export async function exportPng(config?: AvatarConfig, options?: PngOptions): Promise<Blob> {
  return (await import('./exporter')).exportPng(config, options)
}

/** WebM clip (VP9/VP8; alpha where the encoder keeps it). Takes `seconds` of real time. */
export async function exportClip(config?: AvatarConfig, options?: ClipOptions): Promise<Blob> {
  return (await import('./exporter')).exportClip(config, options)
}

/** Animated GIF (256 colours, 1-bit alpha), rendered faster than real time. */
export async function exportGif(config?: AvatarConfig, options?: ClipOptions): Promise<Blob> {
  return (await import('./exporter')).exportGif(config, options)
}
