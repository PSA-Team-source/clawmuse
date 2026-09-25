import { describe, expect, it } from 'vitest'
import { clampSideChatWidth } from '@/shell/SideChat'

describe("Muse's side-by-side chat width", () => {
  it('stays between 360px and half the window', () => {
    expect(clampSideChatWidth(200, 1440)).toBe(360)
    expect(clampSideChatWidth(900, 1440)).toBe(720)
    expect(clampSideChatWidth(500, 1440)).toBe(500)
    expect(clampSideChatWidth(500, 600)).toBe(360) // narrow window never squeezes it below the minimum
  })
})
