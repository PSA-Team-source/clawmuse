import { describe, expect, it } from 'vitest'
import { GOAL_PACKS, goalsFromPack } from '@/lib/goal-packs'

describe('starter goal packs', () => {
  it('offers six packs of 1–3 distinct, concrete goals', () => {
    expect(GOAL_PACKS).toHaveLength(6)
    expect(new Set(GOAL_PACKS.map((pack) => pack.id)).size).toBe(6)
    for (const pack of GOAL_PACKS) {
      expect(pack.goals.length).toBeGreaterThanOrEqual(1)
      expect(pack.goals.length).toBeLessThanOrEqual(3)
      for (const goal of pack.goals) expect(goal.length).toBeGreaterThan(10)
    }
  })

  it('turns a pack into open goals, skipping ones already open', () => {
    const pack = GOAL_PACKS.find((item) => item.id === 'get-fit')!
    const now = new Date('2026-09-25T10:00:00Z')
    const fresh = goalsFromPack(pack, [], now)
    expect(fresh.map((goal) => goal.title)).toEqual(pack.goals)
    expect(fresh.every((goal) => !goal.completed && goal.createdAt === now.toISOString())).toBe(true)
    expect(new Set(fresh.map((goal) => goal.id)).size).toBe(fresh.length)

    const existing = [
      { id: 'a', title: ` ${pack.goals[0]!.toUpperCase()} `, completed: false, createdAt: now.toISOString() },
      { id: 'b', title: pack.goals[1]!, completed: true, createdAt: now.toISOString() },
    ]
    // An open duplicate is skipped; a completed one can be taken on again.
    expect(goalsFromPack(pack, existing, now).map((goal) => goal.title)).toEqual(pack.goals.slice(1))
    expect(goalsFromPack(pack, [...existing, ...fresh], now)).toEqual([])
  })
})
