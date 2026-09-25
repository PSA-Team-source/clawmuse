import { describe, expect, it } from 'vitest'
import { feedQueriesRequest, feedWriteRequest, mergeNews, parseEdition, parseQueries } from '@shared/assistant'

const goal = { id: 'g', title: 'Grow my online store to $50k a month', completed: false, createdAt: '' }

describe('feed from real headlines', () => {
  it('asks for queries around the open goals and real asks', () => {
    const text = feedQueriesRequest('Keep it short.', [goal], ['Audit Stripe rates'])
    expect(text.startsWith('My feed prompt: Keep it short.')).toBe(true)
    expect(text).toContain('- Grow my online store to $50k a month')
    expect(text).toContain('- Audit Stripe rates')
  })
  it('reads a JSON array of queries, else null', () => {
    expect(parseQueries('Sure: ["Shopify Plus pricing", "Stripe fees", "Shopify Plus pricing", ""]')).toEqual(['Shopify Plus pricing', 'Stripe fees'])
    expect(parseQueries('no list')).toBeNull()
  })
  it('merges round-robin without duplicate links or titles', () => {
    const a = [{ title: 'A1', url: 'u1' }, { title: 'A2', url: 'u2' }]
    const b = [{ title: 'a1', url: 'u9' }, { title: 'B2', url: 'u3' }]
    expect(mergeNews([a, b]).map((item) => item.url)).toEqual(['u1', 'u2', 'u3'])
  })
  it('numbers the headlines with their snippets instead of making the model copy URLs', () => {
    const text = feedWriteRequest('Short.', [goal], [{ title: 'Stripe cuts fees', url: 'https://x.test/a', source: 'Reuters', publishedAt: '2026-09-23T00:00:00Z', summary: 'Stripe lowered Connect fees.' }])
    expect(text).toContain('[1] Stripe cuts fees (Reuters, 2026-09-23)\n    Stripe lowered Connect fees.')
    expect(text).not.toContain('https://x.test/a')
  })
  it('builds units from cited headlines only, with their picture and sources', () => {
    const news = [{ title: 'Stripe cuts fees', url: 'https://x.test/a', source: 'Reuters' }, { title: 'Shop Pay on Muse', url: 'https://x.test/b', image: 'https://www.bing.com/th?id=1' }]
    const reply = '```json\n[{"title":"Stripe cut Connect fees","body":"Cheaper payouts.","sources":[1,2,2]},{"title":"Made up","body":"No source.","sources":[9]},{"title":"","body":"x","sources":[1]}]\n```'
    expect(parseEdition('e', reply, news, 'T')).toEqual([{ id: 'feed-e-0', title: 'Stripe cut Connect fees', body: 'Cheaper payouts.', at: 'T', image: 'https://www.bing.com/th?id=1', sources: [{ title: 'Stripe cuts fees', url: 'https://x.test/a', source: 'Reuters' }, { title: 'Shop Pay on Muse', url: 'https://x.test/b', source: undefined }] }])
    // A Markdown reply still reads, unlinked.
    expect(parseEdition('m', '### A\nBody.', news, 'T').map((unit) => unit.title)).toEqual(['A'])
  })
})
