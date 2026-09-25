import { describe, expect, it } from 'vitest'
import { parseShareCardInput, shareCardFileName, trimForCard } from '@shared/share-card'
import { shareCardHtml } from '../../../main/services/share-card-html'

describe('share card input (trust boundary)', () => {
  it('rejects what cannot make a card and caps what can', () => {
    expect(() => parseShareCardInput(null)).toThrow()
    expect(() => parseShareCardInput({ kind: 'feed', body: '   ' })).toThrow('Nothing to share')
    expect(() => parseShareCardInput({ kind: 'evil', body: 'x' })).toThrow('Unknown')
    const card = parseShareCardInput({ kind: 'answer', title: 'T'.repeat(500), body: `a\u0000b\u202E${'x'.repeat(30_000)}` })
    expect(card.title).toHaveLength(200)
    expect(card.body.startsWith('ab')).toBe(true)
    expect(card.body).toHaveLength(20_000)
  })

  it('keeps only https or inline raster pictures', () => {
    const image = (value: string) => parseShareCardInput({ kind: 'feed', body: 'x', image: value }).image
    expect(image('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg')
    expect(image('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    for (const bad of ['http://example.com/a.jpg', 'file:///etc/passwd', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,"><script>', 'https://user:pw@example.com/a.png']) {
      expect(image(bad)).toBeUndefined()
    }
  })

  it('trims at a paragraph or sentence and closes a cut code fence', () => {
    const paragraphs = `${'First paragraph sentence. '.repeat(20)}\n\n${'Second one goes on. '.repeat(40)}`
    const trimmed = trimForCard(paragraphs, 900)
    expect(trimmed.length).toBeLessThanOrEqual(903)
    expect(trimmed).not.toContain('Second')
    expect(trimmed.endsWith('…')).toBe(true)
    expect(trimForCard('Short and sweet.', 900)).toBe('Short and sweet.')
    const fenced = trimForCard(`Intro.\n\n\`\`\`js\n${'const a = 1\n'.repeat(200)}\`\`\``, 300)
    expect((fenced.match(/^```/gm) ?? []).length % 2).toBe(0)
  })

  it('renders model text as escaped text, never as HTML', () => {
    const html = shareCardHtml(parseShareCardInput({
      kind: 'answer',
      title: '<img src=x onerror=alert(1)>',
      body: 'Hi <script>alert(1)</script> **bold** [link](javascript:alert(1)) ![pic](https://evil.example/p.png)\n\n<iframe src="https://evil.example"></iframe>',
      source: '"><b>x</b>',
    }))
    expect(html).not.toMatch(/<script>alert|<iframe|<img src=x|javascript:|evil\.example|<b>x<\/b>/)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<span class="link">link</span>')
    expect(html).toContain('Made with <b>ClawMuse</b> · clawmuse.app')
    expect(html).not.toContain('class="hero"') // no picture, no picture frame
  })

  it('names the saved file safely', () => {
    expect(shareCardFileName({ kind: 'feed', title: 'AI: what/next? <now>' })).toBe('ClawMuse - AI whatnext now.png')
    expect(shareCardFileName({ kind: 'answer' })).toBe('ClawMuse - Answer.png')
  })
})
