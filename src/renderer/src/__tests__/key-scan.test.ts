import { describe, expect, it } from 'vitest'
import {
  envFromSettings,
  exportsFromShellFile,
  rankFindings,
} from '../../../main/services/local-runtime/key-scan'

/**
 * "One install and use it" lives or dies here: if the scan misses the key this
 * Mac already has, the user gets a setup wizard instead of a working app.
 */
describe('envFromSettings', () => {
  it('reads the `env` block Claude Code writes', () => {
    expect(envFromSettings({ env: { ANTHROPIC_API_KEY: 'sk-ant-x' } })).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-x',
    })
  })

  it('reads a top-level key too — neither file promises a stable shape', () => {
    expect(envFromSettings({ OPENAI_API_KEY: 'sk-o' })).toEqual({ OPENAI_API_KEY: 'sk-o' })
  })

  it('prefers the `env` block when both carry the same name', () => {
    const settings = { env: { OPENAI_API_KEY: 'from-env' }, OPENAI_API_KEY: 'from-root' }
    expect(envFromSettings(settings).OPENAI_API_KEY).toBe('from-env')
  })

  it('ignores non-strings and a missing file', () => {
    expect(envFromSettings({ env: { A: 1, B: null } })).toEqual({})
    expect(envFromSettings(null)).toEqual({})
  })
})

describe('exportsFromShellFile', () => {
  it('reads an exported key', () => {
    expect(exportsFromShellFile('export ANTHROPIC_API_KEY=sk-ant-x')).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-x',
    })
  })

  it('strips one layer of quotes', () => {
    expect(exportsFromShellFile('export A="v"\nexport B=\'w\'')).toEqual({ A: 'v', B: 'w' })
  })

  it('skips comments and bare assignments', () => {
    // A bare `NAME=value` is not exported, so it never reaches the gateway
    // anyway; treating it as a credential would be a promise we cannot keep.
    expect(exportsFromShellFile('# export A=1\nB=2')).toEqual({})
  })

  it('refuses a value that is really a reference', () => {
    // `$OTHER` and backticks resolve at shell time; copying the literal text
    // into `.env` would write "$OTHER" and fail as a credential.
    expect(exportsFromShellFile('export A=$OTHER\nexport B=`cat key`')).toEqual({})
  })

  it('keeps the first definition when a file sets one twice', () => {
    expect(exportsFromShellFile('export A=first\nexport A=second').A).toBe('first')
  })
})

describe('rankFindings', () => {
  const shellKey = { providerId: 'anthropic', apiKey: 'live', source: 'your shell environment' }
  const staleKey = { providerId: 'anthropic', apiKey: 'stale', source: '~/.zshrc' }

  it('keeps the first source that sees a provider', () => {
    const [best] = rankFindings([shellKey, staleKey], [])
    expect(best?.provider.apiKey).toBe('live')
    expect(best?.source).toBe('your shell environment')
  })

  it('reports one entry per provider, not one per file', () => {
    expect(rankFindings([shellKey, staleKey], [])).toHaveLength(1)
  })

  it('ranks Anthropic above OpenRouter above OpenAI', () => {
    const findings = rankFindings(
      [
        { providerId: 'openai', apiKey: 'o', source: 'a' },
        { providerId: 'anthropic', apiKey: 'a', source: 'b' },
        { providerId: 'openrouter', apiKey: 'r', source: 'c' },
      ],
      [],
    )
    expect(findings.map((finding) => finding.provider.id)).toEqual([
      'anthropic',
      'openrouter',
      'openai',
    ])
  })

  it('attaches a default model, so the choice is usable without a picker', () => {
    const [best] = rankFindings([shellKey], [])
    expect(best?.provider.model).toBe('anthropic/claude-opus-4-8')
  })

  it('carries a base URL alongside its key', () => {
    // A key issued by a proxy is not valid at the provider's own endpoint.
    const [best] = rankFindings(
      [{ providerId: 'anthropic', apiKey: 'k', baseUrl: 'http://127.0.0.1:8080', source: 's' }],
      [],
    )
    expect(best?.provider.baseUrl).toBe('http://127.0.0.1:8080')
  })

  it('drops a provider it has no verified default model for', () => {
    // Adopting a key and guessing a model id produces a gateway that starts
    // cleanly and fails on the first message.
    expect(rankFindings([{ providerId: 'mistral', apiKey: 'k', source: 's' }], [])).toEqual([])
  })

  it('offers a local server last, and marks that it needs no key', () => {
    const findings = rankFindings([shellKey], [
      { id: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: ['qwen3'], model: 'ollama/qwen3' },
    ])
    expect(findings.map((finding) => finding.provider.id)).toEqual(['anthropic', 'ollama'])
    expect(findings.at(-1)?.needsKey).toBe(false)
    expect(findings[0]?.needsKey).toBe(true)
  })

  it('says nothing was found rather than inventing something', () => {
    expect(rankFindings([], [])).toEqual([])
  })
})
