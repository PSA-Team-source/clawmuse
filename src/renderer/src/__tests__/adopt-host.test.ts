import { describe, expect, it } from 'vitest'
import {
  type HostProfile,
  chooseHostProvider,
  keyRejected,
} from '../../../main/services/local-runtime/adopt-host'
import { PINNED_OPENCLAW_VERSION } from '../../../main/services/local-runtime/install-cli'
import { isOutdatedOpenclaw } from '../../../main/services/local-runtime/resolve'

/**
 * Adoption decides whether a fresh install can chat immediately or stops at
 * onboarding, and it runs against a config this app does not own. The costly
 * mistakes are silent ones: adopting a model whose key is missing (the gateway
 * starts, then every message fails), or inventing a provider entry OpenClaw's
 * strict schema rejects (the whole config is invalid and the agent falls back
 * without saying why).
 */

function profile(config: Record<string, unknown>, env: Record<string, string> = {}): HostProfile {
  return { config, env }
}

describe('adopting the host openclaw provider', () => {
  it('adopts the key from the config env block — where the CLI wizard puts it', () => {
    // This is the real shape on a machine set up by `openclaw doctor`.
    const choice = chooseHostProvider(
      profile({
        env: { OPENROUTER_API_KEY: 'sk-or-v1-secret' },
        agents: { defaults: { model: { primary: 'openrouter/anthropic/claude-sonnet-4' } } },
      }),
    )

    expect(choice).toEqual({
      id: 'openrouter',
      apiKey: 'sk-or-v1-secret',
      model: 'openrouter/anthropic/claude-sonnet-4',
    })
  })

  it('splits the provider id on the FIRST slash, so nested model refs survive', () => {
    // `openrouter/anthropic/claude-sonnet-4` is provider `openrouter`, model
    // `anthropic/claude-sonnet-4`. Splitting on the last slash yields the
    // provider id `openrouter/anthropic`, which is registered nowhere.
    const choice = chooseHostProvider(
      profile({
        env: { OPENROUTER_API_KEY: 'k' },
        agents: { defaults: { model: { primary: 'openrouter/anthropic/claude-sonnet-4' } } },
      }),
    )
    expect(choice?.id).toBe('openrouter')
    expect(choice?.model).toBe('openrouter/anthropic/claude-sonnet-4')
  })

  it('reads a key from the host .env when the config carries none', () => {
    const choice = chooseHostProvider(
      profile(
        { agents: { defaults: { model: { primary: 'anthropic/claude-sonnet-4' } } } },
        { ANTHROPIC_API_KEY: 'sk-ant-secret' },
      ),
    )
    expect(choice).toEqual({
      id: 'anthropic',
      apiKey: 'sk-ant-secret',
      model: 'anthropic/claude-sonnet-4',
    })
  })

  it('skips a model whose provider has no credential and takes the next fallback', () => {
    // Adopting the primary here would produce a gateway that starts cleanly and
    // fails on the first message — the exact failure onboarding exists to prevent.
    const choice = chooseHostProvider(
      profile({
        env: { OPENROUTER_API_KEY: 'k' },
        agents: {
          defaults: {
            model: {
              primary: 'anthropic/claude-sonnet-4',
              fallbacks: ['openrouter/z-ai/glm-5.2'],
            },
          },
        },
      }),
    )
    expect(choice?.id).toBe('openrouter')
    expect(choice?.model).toBe('openrouter/z-ai/glm-5.2')
  })

  it('returns null when nothing on the machine has a usable credential', () => {
    expect(
      chooseHostProvider(
        profile({ agents: { defaults: { model: { primary: 'anthropic/claude-sonnet-4' } } } }),
      ),
    ).toBeNull()
  })

  it('returns null when the host config nominates no model at all', () => {
    expect(chooseHostProvider(profile({ env: { ANTHROPIC_API_KEY: 'k' } }))).toBeNull()
  })

  it('adopts a local server with no credential, declaring the bare model id', () => {
    // Ollama needs no key, but the bare id has to be declared or `models.list`
    // comes back empty and the picker looks broken.
    const choice = chooseHostProvider(
      profile({ agents: { defaults: { model: { primary: 'ollama/qwen3:0.6b' } } } }),
    )
    expect(choice).toEqual({ id: 'ollama', model: 'ollama/qwen3:0.6b', models: ['qwen3:0.6b'] })
  })

  it('refuses a custom provider that cannot be expressed in our config', () => {
    // A non-built-in id needs BOTH a baseUrl and a models list —
    // `ModelProvidersSchema.superRefine` rejects the document otherwise, which
    // invalidates the whole config rather than just this entry.
    expect(
      chooseHostProvider(
        profile({
          env: { MYCORP_API_KEY: 'k' },
          models: { providers: { mycorp: { apiKey: 'k' } } },
          agents: { defaults: { model: { primary: 'mycorp/some-model' } } },
        }),
      ),
    ).toBeNull()
  })

  it('carries baseUrl and models across for a complete custom provider', () => {
    const choice = chooseHostProvider(
      profile({
        env: { MYCORP_API_KEY: 'k' },
        models: {
          providers: {
            mycorp: { baseUrl: 'https://api.mycorp.test/v1', models: [{ id: 'some-model' }] },
          },
        },
        agents: { defaults: { model: { primary: 'mycorp/some-model' } } },
      }),
    )
    expect(choice).toEqual({
      id: 'mycorp',
      apiKey: 'k',
      baseUrl: 'https://api.mycorp.test/v1',
      model: 'mycorp/some-model',
      models: ['some-model'],
    })
  })

  it('does not write an overlay for a built-in provider beyond an explicit baseUrl', () => {
    // Built-in ids own their catalogue upstream; the only thing worth carrying
    // is a deliberate regional endpoint.
    const choice = chooseHostProvider(
      profile({
        env: { ZAI_API_KEY: 'k' },
        models: { providers: { zai: { baseUrl: 'https://api.z.ai/api/coding/paas/v4' } } },
        agents: { defaults: { model: { primary: 'zai/glm-5.2' } } },
      }),
    )
    expect(choice).toEqual({
      id: 'zai',
      apiKey: 'k',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      model: 'zai/glm-5.2',
    })
  })

  it('ignores a bare model ref that names no provider', () => {
    expect(
      chooseHostProvider(
        profile({ env: { ANTHROPIC_API_KEY: 'k' }, agents: { defaults: { model: { primary: 'gpt-5' } } } }),
      ),
    ).toBeNull()
  })
})

/**
 * Config keys are added to OpenClaw over time, so an older CLI rejects a
 * document this app generates correctly. The symptom is maximally misleading —
 * "Generated an invalid gateway config (gateway: Invalid input)" accuses the
 * config, not the binary reading it — so the version gate is what keeps a stale
 * Homebrew `openclaw` from bricking every launch.
 */
describe('rejecting an outdated openclaw', () => {
  it('rejects a CLI from an older release line', () => {
    // Measured: 2026.6.11 rejects `gateway.terminal`, 2026.7.1-2 accepts it.
    expect(isOutdatedOpenclaw('2026.6.11')).toBe(true)
  })

  it('accepts the pinned version itself', () => {
    expect(isOutdatedOpenclaw(PINNED_OPENCLAW_VERSION)).toBe(false)
  })

  it('accepts anything newer', () => {
    expect(isOutdatedOpenclaw('2026.10.0')).toBe(false)
    expect(isOutdatedOpenclaw('2027.1.1')).toBe(false)
  })

  it('compares numerically, not lexically', () => {
    // '2026.6.11' > '2026.6.2' as strings sort, but 2 < 11 as versions.
    expect(isOutdatedOpenclaw('2026.6.2')).toBe(true)
  })

  it('ignores the build suffix rather than ordering it', () => {
    // Same release line as the pin, so it is not "older" — the suffix is an
    // increment within a release, not a semver prerelease.
    expect(isOutdatedOpenclaw('2026.9.5')).toBe(false)
    expect(isOutdatedOpenclaw('2026.9.5-9')).toBe(false)
  })

  it('treats an unparseable version as outdated rather than trusting it', () => {
    expect(isOutdatedOpenclaw('dev')).toBe(true)
  })
})

describe('adopted keys are checked with the provider first', () => {
  const answer = (status: number) => (async () => new Response('', { status })) as unknown as typeof fetch
  it('refuses a key the provider rejects, keeps it on success, offline or unknown providers', async () => {
    expect(await keyRejected('openrouter', 'k', answer(401))).toBe(true)
    expect(await keyRejected('anthropic', 'k', answer(403))).toBe(true)
    expect(await keyRejected('openrouter', 'k', answer(200))).toBe(false)
    expect(await keyRejected('openrouter', 'k', (async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBe(false)
    expect(await keyRejected('zai', 'k', answer(401))).toBe(false)
  })
})
