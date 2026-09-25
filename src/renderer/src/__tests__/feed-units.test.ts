import { describe, expect, it } from 'vitest'
import { parseFeedUnits } from '@shared/assistant'

describe('parseFeedUnits', () => {
  it('creates one card per Markdown heading', () => {
    const units = parseFeedUnits('m1', '### First signal\nEvidence one.\n\n### Second signal\nEvidence two.', '2026-09-23T12:00:00Z')
    expect(units).toEqual([
      expect.objectContaining({ id: 'feed-m1-0', title: 'First signal', body: 'Evidence one.' }),
      expect.objectContaining({ id: 'feed-m1-1', title: 'Second signal', body: 'Evidence two.' }),
    ])
  })

  it('keeps a real unstructured response as one unit', () => {
    expect(parseFeedUnits('m2', 'A verified local update\nWith supporting detail.', '2026-09-23T12:00:00Z')).toEqual([
      expect.objectContaining({ title: 'A verified local update', body: 'A verified local update\nWith supporting detail.' }),
    ])
  })

  it('does not create empty cards', () => {
    expect(parseFeedUnits('m3', '   ', '2026-09-23T12:00:00Z')).toEqual([])
  })
})
