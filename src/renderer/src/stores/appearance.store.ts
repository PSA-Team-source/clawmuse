import type { AvatarPalette } from '@/lib/avatar'
import { create } from 'zustand'

export type Appearance = 'light' | 'dark' | 'system'
export const APPEARANCE_KEY = 'clawmuse:appearance'
export function parseAppearance(value: unknown): Appearance {
  return value === 'dark' || value === 'system' ? value : 'light'
}

function loadAppearance(): Appearance {
  try { return parseAppearance(localStorage.getItem(APPEARANCE_KEY)) } catch { return 'light' }
}

/**
 * Muse's "Theme color": recolours only the user's bubble, its text and the
 * composer's send/stop button. Values measured from Muse 2.2 in both modes.
 * ponytail: Muse fetches this list from its gateway (`chat.themes`); OpenClaw
 * has no such RPC, so the palette lives here until it does. Muse's
 * "Match my avatar" ('avatar') derives its palette from the agent's avatar
 * image (lib/avatar.ts); it is stored so every window paints it at launch.
 */
type ChatPalette = { userBubble: string; userText: string }
export const CHAT_THEMES = [
  { id: 'default', label: 'Default', light: { userBubble: '#e0e5f3', userText: '#111112' }, dark: { userBubble: '#727b96', userText: '#111112' } },
  { id: 'blue', label: 'Blue', light: { userBubble: '#d0e4fd', userText: '#111112' }, dark: { userBubble: '#3172e0', userText: '#ffffff' } },
  { id: 'purple', label: 'Purple', light: { userBubble: '#d7c7ee', userText: '#111112' }, dark: { userBubble: '#8d5bcf', userText: '#ffffff' } },
  { id: 'pink', label: 'Pink', light: { userBubble: '#f3bddd', userText: '#111112' }, dark: { userBubble: '#d12f80', userText: '#ffffff' } },
  { id: 'orange', label: 'Orange', light: { userBubble: '#f9dabc', userText: '#111112' }, dark: { userBubble: '#bb6f27', userText: '#ffffff' } },
  { id: 'green', label: 'Green', light: { userBubble: '#e3efcb', userText: '#111112' }, dark: { userBubble: '#5c8325', userText: '#ffffff' } },
  { id: 'beige', label: 'Beige', light: { userBubble: '#e2dbd3', userText: '#111112' }, dark: { userBubble: '#897259', userText: '#ffffff' } },
  { id: 'monochrome', label: 'Monochrome', light: { userBubble: '#000000', userText: '#ffffff' }, dark: { userBubble: '#ffffff', userText: '#000000' } },
] as const satisfies readonly { id: string; label: string; light: ChatPalette; dark: ChatPalette }[]
export type ChatTheme = (typeof CHAT_THEMES)[number]['id'] | 'avatar'
export const CHAT_THEME_KEY = 'clawmuse:chat-theme'
export const AVATAR_PALETTE_KEY = 'clawmuse:avatar-palette'
export function parseChatTheme(value: unknown): ChatTheme {
  if (value === 'avatar') return 'avatar'
  return CHAT_THEMES.find((theme) => theme.id === value)?.id ?? 'default'
}

function loadAvatarPalette(): AvatarPalette | null {
  try {
    const value = JSON.parse(localStorage.getItem(AVATAR_PALETTE_KEY) ?? 'null') as AvatarPalette | null
    return value?.light?.userBubble && value.dark?.userBubble ? value : null
  } catch {
    return null
  }
}

export function chatPalette(theme: ChatTheme, dark: boolean, avatar: AvatarPalette | null = useAppearanceStore.getState().avatarPalette): ChatPalette {
  // "Match my avatar" with no avatar image falls back to Default, as Muse does.
  if (theme === 'avatar') return avatar ? (dark ? avatar.dark : avatar.light) : chatPalette('default', dark, null)
  const found = CHAT_THEMES.find((t) => t.id === theme) ?? CHAT_THEMES[0]
  return dark ? found.dark : found.light
}

function loadChatTheme(): ChatTheme {
  try { return parseChatTheme(localStorage.getItem(CHAT_THEME_KEY)) } catch { return 'default' }
}

export const useAppearanceStore = create<{
  mode: Appearance
  chatTheme: ChatTheme
  avatarPalette: AvatarPalette | null
  setMode: (mode: Appearance) => void
  setChatTheme: (theme: ChatTheme) => void
  setAvatarPalette: (palette: AvatarPalette | null) => void
}>((set) => ({
  avatarPalette: loadAvatarPalette(),
  setAvatarPalette(avatarPalette) {
    try {
      if (avatarPalette) localStorage.setItem(AVATAR_PALETTE_KEY, JSON.stringify(avatarPalette))
      else localStorage.removeItem(AVATAR_PALETTE_KEY)
    } catch { /* Still apply this window's palette. */ }
    set({ avatarPalette })
  },
  mode: loadAppearance(),
  chatTheme: loadChatTheme(),
  setMode(mode) {
    try { localStorage.setItem(APPEARANCE_KEY, mode) } catch { /* Still apply this window's preference. */ }
    set({ mode })
  },
  setChatTheme(chatTheme) {
    try { localStorage.setItem(CHAT_THEME_KEY, chatTheme) } catch { /* Still apply this window's preference. */ }
    set({ chatTheme })
  },
}))

/** Each renderer follows both OS changes and preferences changed in other windows. */
export function watchAppearance(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const { mode, chatTheme } = useAppearanceStore.getState()
    const resolved = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode
    const root = document.documentElement
    const palette = chatPalette(chatTheme, resolved === 'dark')
    root.dataset.appearance = resolved
    root.style.setProperty('--color-bg-mine', palette.userBubble)
    root.style.setProperty('--color-content-mine', palette.userText)
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_KEY || event.key === CHAT_THEME_KEY || event.key === AVATAR_PALETTE_KEY || event.key === null) {
      useAppearanceStore.setState({ mode: loadAppearance(), chatTheme: loadChatTheme(), avatarPalette: loadAvatarPalette() })
    }
  }
  const unsubscribe = useAppearanceStore.subscribe(apply)
  media.addEventListener('change', apply)
  window.addEventListener('storage', onStorage)
  apply()
  return () => {
    unsubscribe()
    media.removeEventListener('change', apply)
    window.removeEventListener('storage', onStorage)
  }
}
