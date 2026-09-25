import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { gatewayWS } from '@/services/gateway-ws.service'
import { useAppearanceStore } from '@/stores/appearance.store'
import { avatarPalette, dominantColor } from '@/lib/avatar'
import { exportPng, hasWebGL, type AvatarConfig } from '@/features/avatar'
import { startAvatarLookSync, useAvatarLook, withLook } from '@/features/avatar/look'

/** The local agent's identity (IDENTITY.md) as the gateway resolves it. */
export interface AgentIdentity {
  agentId: string
  name?: string
  avatar?: string
  emoji?: string
}

/** The gateway owner's profile — ClawMuse's equivalent of Muse's account. */
export interface OwnerProfile {
  id: string
  displayName?: string | null
  hasAvatar?: boolean
  updatedAt?: number
}

export const AGENT_ID = 'main'
export const agentIdentityKey = ['agent-identity', AGENT_ID] as const
export const ownerProfileKey = ['owner-profile'] as const

/** An avatar value is only drawable when it is an image URL; otherwise it is an emoji or a workspace path. */
export function avatarImage(identity: AgentIdentity | undefined): string | null {
  const value = identity?.avatar?.trim()
  return value && /^(data:image\/(png|jpe?g|webp|gif);base64,|https?:\/\/)/i.test(value) ? value : null
}

async function gatewayImage(path: string): Promise<string | null> {
  const credentials = await window.clawmuse.runtime.credentials()
  if (!credentials) return null
  const response = await fetch(`http://127.0.0.1:${credentials.port}${path}`, { headers: { Authorization: `Bearer ${credentials.token}` } })
  if (!response.ok) return null
  return blobToDataUrl(await response.blob())
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

let portrait: { key: string; face: Promise<string | null> } | null = null
/**
 * The floating pill's face when the agent has no avatar image: a still of the
 * ClawMuse avatar, head and shoulders, drawn once per window.
 *
 * A still rather than a live badge, measured: the pill is its own window (a
 * `data:` page with an inline-only CSP), so a live avatar there means a second
 * copy of the three.js chunk and a WebGL context held for as long as the pill
 * floats over other apps — to animate a 36 px circle. The still is one frame
 * rendered here (~3 KB PNG, measured); without WebGL the pill keeps the app icon.
 */
function avatarPortrait(look: AvatarConfig | null): Promise<string | null> {
  const key = JSON.stringify(look)
  if (portrait?.key !== key) {
    portrait = {
      key,
      face: hasWebGL()
        ? exportPng(withLook(undefined, look), { framing: 'bust', size: 96, state: 'idle' }).then(blobToDataUrl).catch(() => null)
        : Promise.resolve(null),
    }
  }
  return portrait.face
}

/** A workspace-path avatar (what set-identity writes) is served by the gateway at /avatar/<agent>. */
function isAvatarPath(value: string | undefined): boolean {
  return Boolean(value && /^[\w./-]+\.(png|jpe?g|webp|gif)$/i.test(value) && !value.includes('..'))
}

/** The agent avatar as a drawable URL, or null when it is an emoji or unset. */
export function useAgentAvatar(identity: AgentIdentity | undefined): string | null {
  const direct = avatarImage(identity)
  const path = !direct && isAvatarPath(identity?.avatar) ? identity!.avatar! : null
  const served = useQuery({
    queryKey: ['agent-avatar', identity?.agentId, path],
    enabled: Boolean(path),
    staleTime: Infinity,
    queryFn: () => gatewayImage(`/avatar/${encodeURIComponent(identity!.agentId)}?v=${Date.now()}`),
  })
  return direct ?? (path ? served.data ?? null : null)
}

export function useAgentIdentity() {
  return useQuery({
    queryKey: agentIdentityKey,
    queryFn: () => gatewayWS.call<AgentIdentity>('agent.identity.get', { agentId: AGENT_ID }),
    staleTime: 60_000,
  })
}

export function useOwnerProfile() {
  return useQuery({
    queryKey: ownerProfileKey,
    queryFn: async () => (await gatewayWS.call<{ profile: OwnerProfile }>('users.self', {})).profile,
    staleTime: 60_000,
  })
}

/** The owner avatar is served by the gateway over HTTP and needs its token. */
export function useOwnerAvatarUrl(profile: OwnerProfile | undefined): string | null {
  const avatar = useQuery({
    queryKey: ['owner-avatar', profile?.id, profile?.updatedAt],
    enabled: Boolean(profile?.hasAvatar),
    staleTime: Infinity,
    queryFn: () => gatewayImage(`/api/users/${encodeURIComponent(profile!.id)}/avatar?v=${profile!.updatedAt ?? 0}`),
  })
  return profile?.hasAvatar ? avatar.data ?? null : null
}

/**
 * Keeps "Match my avatar" and the floating button in step with the agent's
 * avatar: derives the palette from the image and hands name + image to main.
 * Mounted once per window.
 */
export function useAgentIdentitySync(): void {
  const identity = useAgentIdentity()
  const setAvatarPalette = useAppearanceStore((state) => state.setAvatarPalette)
  const image = useAgentAvatar(identity.data)
  const name = identity.data?.name
  const look = useAvatarLook((state) => state.look)

  useEffect(startAvatarLookSync, [])

  useEffect(() => {
    if (identity.isPending) return
    if (!image) { setAvatarPalette(null); return }
    let cancelled = false
    void dominantColor(image).then((color) => { if (!cancelled) setAvatarPalette(color ? avatarPalette(color) : null) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [identity.isPending, image, setAvatarPalette])

  useEffect(() => {
    if (identity.isPending) return
    if (image) {
      window.clawmuse.floating.setIdentity(name ?? null, image)
      return
    }
    let cancelled = false
    void avatarPortrait(look).then((face) => {
      if (!cancelled) window.clawmuse.floating.setIdentity(name ?? null, face)
    })
    return () => { cancelled = true }
  }, [identity.isPending, name, image, look])
}
