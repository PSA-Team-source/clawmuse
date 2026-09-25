import { describe, expect, it } from 'vitest'
import { botIdOfTask } from '@/services/local-tasks'

/**
 * A routine belongs to a bot because it is pointed at that bot's own thread.
 * Get this wrong and every routine shows up under every bot — or under none.
 */
describe('botIdOfTask', () => {
  it('reads the bot out of a session target', () => {
    expect(botIdOfTask({ session_target: 'session:agent:inbox-manager:webchat:main' })).toBe(
      'inbox-manager',
    )
  })

  it('accepts a target with no `session:` prefix', () => {
    expect(botIdOfTask({ session_target: 'agent:scout:webchat:main' })).toBe('scout')
  })

  it('claims nothing for a task that is not a bot routine', () => {
    // A skill task and an isolated task are both real, and neither belongs to a
    // roster row.
    expect(botIdOfTask({ session_target: 'session:webchat:skill:facebook-ads' })).toBeNull()
    expect(botIdOfTask({ session_target: 'isolated' })).toBeNull()
    expect(botIdOfTask({ session_target: null })).toBeNull()
    expect(botIdOfTask({})).toBeNull()
  })

  it('does not claim the default bot for an unscoped thread', () => {
    // `webchat:main` with no agent prefix is the default agent's thread, and a
    // task there is a task, not a routine on a roster row.
    expect(botIdOfTask({ session_target: 'session:webchat:main' })).toBeNull()
  })
})
