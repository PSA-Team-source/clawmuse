import { describe, expect, it, vi } from 'vitest'

vi.mock('electron-log/main.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))

const { opencodeKeyFrom } = await import('../../../main/services/local-runtime/opencode-adopt')

describe('opencodeKeyFrom (OpenCode auth.json)', () => {
  it('takes the API key OpenCode stored for Zen or Go', () => {
    expect(opencodeKeyFrom({ openrouter: { type: 'api', key: 'or' }, 'opencode-go': { type: 'api', key: ' sk-oc ' } })).toBe('sk-oc')
    expect(opencodeKeyFrom({ opencode: { type: 'api', key: 'sk-zen' }, 'opencode-go': { type: 'api', key: 'sk-go' } })).toBe('sk-zen')
  })
  it('ignores OAuth entries, other providers and junk', () => {
    expect(opencodeKeyFrom({ opencode: { type: 'oauth', access: 'x' } })).toBeNull()
    expect(opencodeKeyFrom({ openrouter: { type: 'api', key: 'or' } })).toBeNull()
    expect(opencodeKeyFrom(null)).toBeNull()
    expect(opencodeKeyFrom({ opencode: { type: 'api', key: '  ' } })).toBeNull()
  })
})
