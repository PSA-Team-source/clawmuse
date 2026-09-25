import { afterEach, describe, expect, it, vi } from 'vitest'
import { APPEARANCE_KEY, parseAppearance, useAppearanceStore, watchAppearance } from '@/stores/appearance.store'

afterEach(() => {
  localStorage.removeItem(APPEARANCE_KEY)
  useAppearanceStore.setState({ mode: 'light' })
  delete document.documentElement.dataset.appearance
  vi.unstubAllGlobals()
})

describe('appearance', () => {
  it('validates persisted values', () => {
    expect(parseAppearance('dark')).toBe('dark')
    expect(parseAppearance('system')).toBe('system')
    expect(parseAppearance('invalid')).toBe('light')
    expect(parseAppearance(null)).toBe('light')
  })

  it('applies and persists explicit modes, follows the OS only in System, and cleans up', () => {
    const media = new EventTarget() as EventTarget & { matches: boolean }
    media.matches = true
    vi.stubGlobal('matchMedia', () => media)
    const stop = watchAppearance()
    expect(document.documentElement.dataset.appearance).toBe('light')
    useAppearanceStore.getState().setMode('dark')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.appearance).toBe('dark')
    media.matches = false
    media.dispatchEvent(new Event('change'))
    expect(document.documentElement.dataset.appearance).toBe('dark')
    useAppearanceStore.getState().setMode('system')
    expect(document.documentElement.dataset.appearance).toBe('light')
    media.matches = true
    media.dispatchEvent(new Event('change'))
    expect(document.documentElement.dataset.appearance).toBe('dark')
    stop()
    useAppearanceStore.getState().setMode('light')
    expect(document.documentElement.dataset.appearance).toBe('dark')
  })

  it('receives another window preference and handles cleared storage', () => {
    vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }))
    const stop = watchAppearance()
    localStorage.setItem(APPEARANCE_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY }))
    expect(useAppearanceStore.getState().mode).toBe('dark')
    expect(document.documentElement.dataset.appearance).toBe('dark')
    localStorage.removeItem(APPEARANCE_KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(useAppearanceStore.getState().mode).toBe('light')
    stop()
  })
})

describe('theme color', () => {
  it('persists the choice and paints the user bubble for the resolved mode', async () => {
    const { CHAT_THEME_KEY, parseChatTheme } = await import('@/stores/appearance.store')
    const media = new EventTarget() as EventTarget & { matches: boolean }
    media.matches = false
    vi.stubGlobal('matchMedia', () => media)
    expect(parseChatTheme('pink')).toBe('pink')
    expect(parseChatTheme('nonsense')).toBe('default')
    const stop = watchAppearance()
    const style = document.documentElement.style
    useAppearanceStore.getState().setChatTheme('pink')
    expect(localStorage.getItem(CHAT_THEME_KEY)).toBe('pink')
    expect(style.getPropertyValue('--color-bg-mine')).toBe('#f3bddd')
    useAppearanceStore.getState().setMode('dark')
    expect(style.getPropertyValue('--color-bg-mine')).toBe('#d12f80')
    expect(style.getPropertyValue('--color-content-mine')).toBe('#ffffff')
    stop()
    localStorage.removeItem(CHAT_THEME_KEY)
    useAppearanceStore.setState({ chatTheme: 'default' })
  })
})
