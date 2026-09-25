import { describe, expect, it } from 'vitest'
import { recentTotals } from '@/routes/settings/UsageCard'

describe('usage totals', () => {
  it('sums only the most recent seven days, regardless of input order', () => {
    const daily = Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(10 + i).padStart(2, '0')}`, totalTokens: 100, totalCost: 0.01 })).reverse()
    const totals = recentTotals({ daily })
    expect(totals.tokens).toBe(700)
    expect(totals.cost).toBeCloseTo(0.07)
    expect(recentTotals(undefined)).toEqual({ tokens: 0, cost: 0 })
  })
})
