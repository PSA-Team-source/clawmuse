import { describe, expect, it } from 'vitest'
import type { Message } from '@/types'
import { liveAvatarState } from '@/components/chat/MessageList'
import { shareClipLayout } from '@/components/share/share-clip'
import { avatarConfigForAgent, resolveAvatarConfig } from '@/features/avatar'

const msg = (role: Message['role'], extra: Partial<Message> = {}): Message => ({
  id: Math.random().toString(36),
  session_id: 's',
  role,
  content: '',
  status: 'sent',
  created_at: new Date().toISOString(),
  ...extra,
})
const tool = (status: 'running' | 'done') => msg('tool', { tool_calls: [{ id: 't', tool: 'read', input: {}, status }] })

describe('the live face beside a reply', () => {
  it('thinks, works, talks, then rests', () => {
    const asked = [msg('assistant'), msg('user')]
    expect(liveAvatarState(asked, true, '')).toBe('thinking')
    expect(liveAvatarState([...asked, tool('running')], true, '')).toBe('working')
    expect(liveAvatarState([...asked, tool('running')], true, 'Here')).toBe('working')
    expect(liveAvatarState([...asked, tool('done')], true, 'Here')).toBe('talking')
    expect(liveAvatarState([...asked, tool('done')], false, '')).toBe('idle')
    // A tool left running in an earlier turn does not make this one "working".
    expect(liveAvatarState([tool('running'), msg('user')], true, '')).toBe('thinking')
  })
})

describe('avatar per agent', () => {
  it('gives the default agent the muse and every other bot its own stable body', () => {
    expect(resolveAvatarConfig(avatarConfigForAgent({ id: 'main', isDefault: true })).style).toBe('muse')
    expect(resolveAvatarConfig(avatarConfigForAgent(null)).style).toBe('muse')
    const a = resolveAvatarConfig(avatarConfigForAgent({ id: 'inbox-manager', name: 'Inbox' }))
    expect(a.style).not.toBe('muse')
    expect(a.name).toBe('Inbox')
    expect(resolveAvatarConfig(avatarConfigForAgent({ id: 'inbox-manager' }))).toMatchObject({ style: a.style, seed: a.seed, colors: a.colors })
  })
})

describe('share clip layout', () => {
  it('fits any card beside the avatar at even, bounded sizes', () => {
    for (const [cw, ch] of [[1200, 600], [1200, 1400], [1200, 4000]] as const) {
      const l = shareClipLayout(cw, ch)
      expect(l.width % 2).toBe(0)
      expect(l.height % 2).toBe(0)
      expect(l.height).toBeLessThanOrEqual(784)
      expect(l.card.x).toBeGreaterThanOrEqual(l.avatar.x + l.avatar.size)
      expect(l.card.x + l.card.w).toBeLessThanOrEqual(l.width)
      expect(l.card.y + l.card.h).toBeLessThanOrEqual(l.height)
      expect(l.card.w / l.card.h).toBeCloseTo(cw / ch, 1)
      // The credit sits under the avatar, inside the frame, never over the avatar.
      expect(l.credit.y).toBeGreaterThan(l.avatar.y + l.avatar.size)
      expect(l.credit.y).toBeLessThan(l.height)
      expect(l.credit.x).toBe(l.avatar.x + l.avatar.size / 2)
    }
    expect(() => shareClipLayout(0, 10)).toThrow()
  })
})
