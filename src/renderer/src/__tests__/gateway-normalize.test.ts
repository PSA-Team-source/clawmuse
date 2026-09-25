import { describe, expect, it } from 'vitest'
import {
  applyCumulativeDelta,
  modelRef,
  normalizeHistory,
  normalizeSessions,
  prettySessionName,
  textFromContent,
} from '@/utils/gateway-normalize'

/**
 * `applyCumulativeDelta` is the single most bug-prone rule in the protocol:
 * every delta carries the whole text so far, so appending would duplicate
 * output exponentially. These tests pin the contract.
 */
describe('applyCumulativeDelta', () => {
  it('replaces with the longer incoming text', () => {
    expect(applyCumulativeDelta('Hel', 'Hello')).toBe('Hello')
  })

  it('replaces when lengths are equal (later frame wins)', () => {
    expect(applyCumulativeDelta('Hell', 'Help')).toBe('Help')
  })

  it('ignores a shorter out-of-order frame instead of truncating', () => {
    expect(applyCumulativeDelta('Hello world', 'Hello')).toBe('Hello world')
  })

  it('never concatenates', () => {
    const first = applyCumulativeDelta('', 'The')
    const second = applyCumulativeDelta(first, 'The quick')
    const third = applyCumulativeDelta(second, 'The quick brown')
    expect(third).toBe('The quick brown')
  })

  it('handles the empty-start case', () => {
    expect(applyCumulativeDelta('', '')).toBe('')
    expect(applyCumulativeDelta('', 'a')).toBe('a')
  })
})

describe('textFromContent', () => {
  it('joins text blocks and drops non-text ones', () => {
    expect(
      textFromContent([
        { type: 'text', text: 'Hello ' },
        { type: 'image', text: undefined },
        { type: 'text', text: 'world' },
      ]),
    ).toBe('Hello world')
  })

  it('returns empty string for missing content', () => {
    expect(textFromContent(undefined)).toBe('')
    expect(textFromContent([])).toBe('')
  })
})

describe('prettySessionName', () => {
  it('names the main session', () => {
    expect(prettySessionName('webchat:main')).toBe('Main')
  })

  it('strips the agent:main: prefix the container adds', () => {
    expect(prettySessionName('agent:main:webchat:main')).toBe('Main')
  })

  it('title-cases a skill key', () => {
    expect(prettySessionName('webchat:skill:create-store')).toBe('Create Store')
  })

  it('labels a skill sub-conversation', () => {
    expect(prettySessionName('webchat:skill:facebook-ads:conv:abc')).toBe('Facebook Ads · conversation')
  })

  it('falls back to the raw key when unrecognised', () => {
    expect(prettySessionName('something:else')).toBe('something:else')
  })
})

describe('normalizeSessions', () => {
  it('accepts a bare array', () => {
    const result = normalizeSessions([{ key: 'webchat:main', name: 'Main' }])
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('webchat:main')
  })

  it('accepts a { sessions } envelope and strips the container prefix', () => {
    const result = normalizeSessions({ sessions: [{ id: 'agent:main:webchat:skill:x' }] })
    expect(result[0]?.id).toBe('webchat:skill:x')
  })

  it('derives a name when the server sends none', () => {
    const result = normalizeSessions([{ key: 'webchat:main' }])
    expect(result[0]?.name).toBe('Main')
  })

  it('reads lastMessage in both string and object form', () => {
    const result = normalizeSessions([
      { key: 'a', lastMessage: 'plain' },
      { key: 'b', lastMessage: { text: 'nested' } },
    ])
    expect(result[0]?.last_message).toBe('plain')
    expect(result[1]?.last_message).toBe('nested')
  })

  it('drops entries with no usable key', () => {
    expect(normalizeSessions([{ foo: 'bar' }, null, 'nope'])).toHaveLength(0)
  })

  it('returns empty for garbage input', () => {
    expect(normalizeSessions(null)).toEqual([])
    expect(normalizeSessions(42)).toEqual([])
  })

  /**
   * `sessions.list` splits the model across two fields (`zai` + `glm-5.2`)
   * while config defaults, `models.list` and `sessions.patch` all speak the
   * `provider/id` ref. Returning the bare id made every session look like it
   * had drifted from the default.
   */
  it('joins the split provider and model into one ref', () => {
    const sessions = normalizeSessions([
      { key: 'agent:main:webchat:main', modelProvider: 'zai', model: 'glm-5.2' },
    ])
    expect(sessions[0]?.model).toBe('zai/glm-5.2')
  })
})

describe('modelRef', () => {
  it('qualifies a bare id with its provider', () => {
    expect(modelRef('ollama', 'qwen3:0.6b')).toBe('ollama/qwen3:0.6b')
  })

  it('leaves an already-qualified ref alone', () => {
    // Guards against `zai/zai/glm-5.2` if the gateway starts sending full refs.
    expect(modelRef('zai', 'zai/glm-5.2')).toBe('zai/glm-5.2')
    // A vendor path inside a router is not a provider prefix.
    expect(modelRef('openrouter', 'anthropic/claude-sonnet-4')).toBe('openrouter/anthropic/claude-sonnet-4')
  })

  it('falls back to the bare id when no provider is reported', () => {
    expect(modelRef(undefined, 'glm-5.2')).toBe('glm-5.2')
  })

  it('is undefined when there is no model', () => {
    expect(modelRef('zai', undefined)).toBeUndefined()
    expect(modelRef('zai', '')).toBeUndefined()
  })
})

describe('normalizeHistory', () => {
  it('reads content from string, text, or block array', () => {
    const result = normalizeHistory(
      {
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', text: 'hello' },
          { role: 'assistant', content: [{ type: 'text', text: 'blocks' }] },
        ],
      },
      'webchat:main',
    )
    expect(result.map((m) => m.content)).toEqual(['hi', 'hello', 'blocks'])
  })

  it('defaults an unknown role to assistant', () => {
    const result = normalizeHistory([{ role: 'system', content: 'x' }], 's')
    expect(result[0]?.role).toBe('assistant')
  })

  it('generates stable ids when the server omits them', () => {
    const result = normalizeHistory([{ content: 'a' }, { content: 'b' }], 'sess')
    expect(result[0]?.id).toBe('hist_sess_0')
    expect(result[1]?.id).toBe('hist_sess_1')
  })
})
