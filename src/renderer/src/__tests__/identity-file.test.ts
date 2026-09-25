import { describe, expect, it } from 'vitest'
import { parseIdentityMarkdown } from '@/routes/status/identity-file'

// Mirrors OpenClaw's parseIdentityMarkdown (src/agents/identity-file.ts).
describe('parseIdentityMarkdown', () => {
  it('reads bold-label bullets and plain lines, last value wins', () => {
    expect(parseIdentityMarkdown([
      '# IDENTITY.md',
      '- **Name:** Clawd',
      '- **Creature:** _a lobster familiar_',
      'Vibe: warm, a little chaotic',
      '- Theme: `helpful space lobster`',
      '- Emoji: 🦞',
      '- Name: Clawdia',
      'Favourite: ignored',
    ].join('\r\n'))).toEqual({ name: 'Clawdia', creature: 'a lobster familiar', vibe: 'warm, a little chaotic', theme: 'helpful space lobster', emoji: '🦞' })
  })

  it('treats the untouched template as empty', () => {
    const template = [
      '- **Name:**',
      '  _(pick something you like)_',
      '- **Creature:** _(AI? robot? familiar? ghost in the machine? something weirder?)_',
      '- **Vibe:** (how do you come across? sharp? warm? chaotic? calm?)',
      '- **Emoji:** _(your signature — pick one that feels right)_',
      '- **Avatar:** _(workspace-relative path, http(s) URL, or data URI)_',
    ].join('\n')
    expect(parseIdentityMarkdown(template)).toEqual({})
  })
})

describe('Muse identity labels', () => {
  it('reads Tagline and Description beside the OpenClaw fields', () => {
    expect(parseIdentityMarkdown('- **Name:** Fang\n- **Tagline:** Your local lobster\n- **Description:** Runs on this Mac')).toEqual({ name: 'Fang', tagline: 'Your local lobster', description: 'Runs on this Mac' })
  })
})
