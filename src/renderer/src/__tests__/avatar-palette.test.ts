import { describe, expect, it } from 'vitest'
import { avatarPalette } from '@/lib/avatar'
import { chatPalette, parseChatTheme } from '@/stores/appearance.store'

describe('Match my avatar', () => {
  it('derives a pastel light bubble and a deeper dark bubble in the avatar hue, with legible text', () => {
    const palette = avatarPalette([40, 120, 220]) // a blue avatar
    const hex = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
    const [lr, lg, lb] = hex(palette.light.userBubble)
    const [dr, dg, db] = hex(palette.dark.userBubble)
    expect(lb).toBeGreaterThan(lr!) // still blue
    expect(db).toBeGreaterThan(dr!)
    expect(lr! + lg! + lb!).toBeGreaterThan(dr! + dg! + db!) // light is lighter
    expect(palette.light.userText).toBe('#111112')
    expect(palette.dark.userText).toBe('#ffffff')
  })

  it("is a real theme id and falls back to Default when there is no avatar image", () => {
    expect(parseChatTheme('avatar')).toBe('avatar')
    expect(chatPalette('avatar', false, null)).toEqual(chatPalette('default', false, null))
    const palette = avatarPalette([200, 40, 120])
    expect(chatPalette('avatar', true, palette)).toEqual(palette.dark)
  })
})
