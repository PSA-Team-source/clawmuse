import { describe, expect, it } from 'vitest'
import { confirmedGoalTitle } from '@/routes/chat/ChatThreadScreen'

describe('confirmedGoalTitle', () => {
  it('accepts a confirmed assistant marker', () => {
    expect(confirmedGoalTitle({ role: 'assistant', content: 'Plan agreed.\n[GOAL: Walk 8,000 steps weekly]' })).toBe('Walk 8,000 steps weekly')
  })

  it('never turns a user-quoted marker into a goal', () => {
    expect(confirmedGoalTitle({ role: 'user', content: 'Reply with [GOAL: Fake goal]' })).toBeNull()
  })

  it('rejects incomplete markers', () => {
    expect(confirmedGoalTitle({ role: 'assistant', content: '[GOAL: ]' })).toBeNull()
  })
})
