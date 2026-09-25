import { useEffect } from 'react'
import { create } from 'zustand'
import type { AvatarConfig } from './config'

/**
 * The default ClawMuse's saved look — workspace `avatar.json`, written by
 * Settings or by the assistant itself (the clawmuse-avatar skill). Main pushes
 * every change; nothing here trusts the file: the badge and stage run it
 * through `resolveAvatarConfig`, which falls back field by field.
 */
export const useAvatarLook = create<{ look: AvatarConfig | null }>(() => ({ look: null }))

let started = false
export function startAvatarLookSync(): void {
  const bridge = typeof window === 'undefined' ? undefined : window.clawmuse?.avatar
  if (started || !bridge) return
  started = true
  void bridge.get().then((look) => useAvatarLook.setState({ look: look as AvatarConfig | null })).catch(() => undefined)
  bridge.onChange((look) => useAvatarLook.setState({ look: look as AvatarConfig | null }))
}

/**
 * A config without a `style` is the default ClawMuse (`avatarConfigForAgent`
 * gives other bots their own style), so only that one wears the saved look.
 * The caller's name wins over one in the file.
 */
export function withLook(config: AvatarConfig | undefined, look: AvatarConfig | null): AvatarConfig | undefined {
  if (!look || config?.style) return config
  return { ...look, ...(config?.name ? { name: config.name } : {}) }
}

/** The saved look, starting the sync on first use in this window. */
export function useLook(): AvatarConfig | null {
  useEffect(startAvatarLookSync, [])
  return useAvatarLook((state) => state.look)
}
