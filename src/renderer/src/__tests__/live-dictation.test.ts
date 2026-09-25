import { describe, expect, it } from 'vitest'
import { linearToMulaw } from '@/lib/live-dictation'

describe('G.711 µ-law', () => {
  it('matches the standard encoding at silence and full scale', () => {
    expect(linearToMulaw(0)).toBe(0xff)
    expect(linearToMulaw(32767)).toBe(0x80)
    expect(linearToMulaw(-32768)).toBe(0x00)
    expect(linearToMulaw(1000)).toBe(0xce) // reference value from the G.711 table
    expect(linearToMulaw(-1000)).toBe(0x4e)
  })
})
