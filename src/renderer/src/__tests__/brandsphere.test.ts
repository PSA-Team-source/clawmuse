import { describe, expect, it } from 'vitest'
import { brandFeedResponseSchema, brandPostSchema } from '@/types'

/**
 * The feed is assembled from a scraped store table, so missing columns are the
 * norm rather than the exception: growth, traffic and creatives are frequently
 * absent. A schema that insists on them turns a partly-populated feed into an
 * empty screen.
 */
describe('brandPostSchema', () => {
  it('accepts a fully populated row', () => {
    const parsed = brandPostSchema.parse({
      id: 42,
      brand: 'pilates.com',
      emoji: '🧘',
      category: 'Fitness',
      rank: '#1 Trending',
      revenue: '$1.2M',
      visitors: '340K',
      growth: '+12.4%',
      description: 'Trending right now',
      images: ['https://cdn/1.jpg'],
      likes: 120,
      comments: 8,
    })

    // Ids arrive as numbers from Postgres and as strings elsewhere.
    expect(parsed.id).toBe('42')
    expect(parsed.growth).toBe('+12.4%')
  })

  it('survives a row where every optional column is null', () => {
    const parsed = brandPostSchema.parse({
      id: '7',
      brand: 'store.com',
      emoji: null,
      logo: null,
      category: null,
      rank: null,
      revenue: null,
      visitors: null,
      growth: null,
      description: null,
      images: [],
      likes: null,
      comments: null,
    })

    expect(parsed.brand).toBe('store.com')
    expect(parsed.images).toEqual([])
  })

  it('falls back to a readable name when the store has none', () => {
    expect(brandPostSchema.parse({ id: '1', brand: null }).brand).toBe('Unknown store')
  })

  it('tolerates a malformed images field instead of failing the row', () => {
    expect(brandPostSchema.parse({ id: '1', brand: 'x', images: 'oops' }).images).toEqual([])
  })
})

describe('brandFeedResponseSchema', () => {
  it('drops only the broken rows, keeping the rest of the feed', () => {
    const parsed = brandFeedResponseSchema.parse({
      success: true,
      data: [{ id: '1', brand: 'good' }, { nope: true }, { id: '2', brand: 'also good' }],
    })

    expect(parsed.data.map((post) => post.brand)).toEqual(['good', 'also good'])
  })

  it('returns an empty feed rather than throwing when data is missing', () => {
    expect(brandFeedResponseSchema.parse({ success: true }).data).toEqual([])
  })
})
