import { describe, expect, it } from 'vitest'
import { resolveAvatarConfig } from '@/features/avatar'
import { withLook } from '@/features/avatar/look'

describe('saved avatar look (workspace avatar.json)', () => {
  const look = { style: 'mage' as const, accessory: 'crown' as const, colors: { outfit: '#2F6BFF' }, name: 'FromFile' }

  it('dresses the default ClawMuse, keeping the caller’s name', () => {
    const out = resolveAvatarConfig(withLook({ name: 'Muse' }, look))
    expect(out.style).toBe('mage')
    expect(out.accessory).toBe('crown')
    expect(out.colors.outfit).toBe(0x2f6bff)
    expect(out.name).toBe('Muse')
    expect(resolveAvatarConfig(withLook(undefined, look)).style).toBe('mage')
  })

  it('leaves other bots (which carry their own style) alone', () => {
    expect(withLook({ style: 'healer', seed: 'bot-2' }, look)).toEqual({ style: 'healer', seed: 'bot-2' })
  })

  it('an empty or broken file falls back to the default look', () => {
    expect(resolveAvatarConfig(withLook(undefined, null)).style).toBe('muse')
    expect(resolveAvatarConfig(withLook(undefined, {})).style).toBe('muse')
    expect(resolveAvatarConfig(withLook(undefined, { style: 'dragon' } as never)).style).toBe('muse')
  })
})

import { dropTurnRecaps } from '@/utils/gateway-normalize'
describe('tool-turn recap', () => {
  const m = (role: 'user' | 'assistant' | 'tool', content: string) => ({ id: content + role, session_id: 's', role, content, status: 'sent', created_at: '' }) as never
  it('drops the final message that only repeats the steps', () => {
    const turn = [m('user', 'go'), m('assistant', 'Step one.'), m('tool', ''), m('assistant', 'Done.'), m('assistant', 'Step one.\n\nDone.')]
    expect(dropTurnRecaps(turn).map((x: { content: string }) => x.content)).toEqual(['go', 'Step one.', '', 'Done.'])
  })
  it('keeps a final message with new words, and single-step turns', () => {
    const a = [m('user', 'go'), m('assistant', 'One.'), m('assistant', 'Two.'), m('assistant', 'One. Two. And a summary.')]
    expect(dropTurnRecaps(a)).toHaveLength(4)
    const b = [m('user', 'hi'), m('assistant', 'Hello'), m('user', 'hi'), m('assistant', 'Hello')]
    expect(dropTurnRecaps(b)).toHaveLength(4)
  })
})
