import { describe, expect, it } from 'vitest'
import { buildDeviceAuthPayloadV3 } from '../../../main/services/device-identity'
import {
  buildConfig,
  buildProviderEntry,
  deriveHooksToken,
  envVarForProvider,
  mergeConfig,
  wireProvider,
} from '../../../main/services/local-runtime/config-gen'
import { parseEnv, serializeEnv } from '../../../main/services/local-runtime/env-file'
import { __testing as pathTesting } from '../../../main/services/local-runtime/shell-path'
import { evaluateNodeVersion } from '../../../main/services/local-runtime/node-check'

/**
 * The signature payload and the generated config are the two places where a
 * silent mistake costs the most: a wrong byte in the payload means every RPC
 * fails with "missing scope" and nothing says why, and a wrong config key means
 * the gateway refuses to start or quietly opens itself to the network.
 */

describe('device auth payload v3', () => {
  const base = {
    deviceId: 'abc123',
    clientId: 'openclaw-macos',
    clientMode: 'ui',
    role: 'operator',
    scopes: ['operator.read', 'operator.write', 'operator.admin'],
    signedAtMs: 1784880000000,
    token: 'tok',
    nonce: 'nonce-1',
    platform: 'darwin',
  }

  it('matches the gateway wire format exactly', () => {
    expect(buildDeviceAuthPayloadV3(base)).toBe(
      'v3|abc123|openclaw-macos|ui|operator|operator.read,operator.write,operator.admin|1784880000000|tok|nonce-1|darwin|',
    )
  })

  it('lowercases platform metadata the way the gateway normalises it', () => {
    // The gateway compares signatures byte-for-byte after normalising these two
    // fields; signing "Darwin" while it verifies "darwin" fails auth.
    const signed = buildDeviceAuthPayloadV3({ ...base, platform: 'Darwin', deviceFamily: 'Mac' })
    expect(signed.endsWith('|darwin|mac')).toBe(true)
  })

  it('keeps scope order, because the gateway does not sort', () => {
    const reordered = buildDeviceAuthPayloadV3({ ...base, scopes: ['operator.write', 'operator.read'] })
    expect(reordered).toContain('|operator.write,operator.read|')
  })
})

describe('generated gateway config', () => {
  const config = buildConfig({ port: 18789, token: 'tok', workspace: '/tmp/ws' })
  const gateway = config.gateway as Record<string, unknown>

  it('sets gateway.mode=local, without which the gateway refuses to start', () => {
    expect(gateway.mode).toBe('local')
  })

  it('binds loopback only', () => {
    expect(gateway.bind).toBe('loopback')
    expect(gateway).not.toHaveProperty('trustedProxies')
  })

  it('never disables device auth', () => {
    const controlUi = gateway.controlUi as Record<string, unknown>
    expect(controlUi.dangerouslyDisableDeviceAuth).toBeUndefined()
  })

  it('does not advertise the gateway on the local network', () => {
    // `mode: "off"` is the real key. `enabled: false` typechecks, reads fine,
    // and makes the gateway reject the entire config as invalid.
    expect(config.discovery).toEqual({ mdns: { mode: 'off' } })
  })

  it('declares no MCP servers — the production pair is server-side only', () => {
    expect(config.mcp).toEqual({ servers: {} })
  })

  it('derives a hooks token distinct from the gateway token', () => {
    const hooks = config.hooks as Record<string, unknown>
    expect(hooks.token).toBe(deriveHooksToken('tok'))
    expect(hooks.token).not.toBe('tok')
  })

  it('writes nothing at all for a built-in cloud provider', () => {
    // Verified against `openclaw doctor --lint`: adding `apiKeyEnvVar` to
    // `models.providers.anthropic` reports `Invalid input` on that path —
    // `ModelProviderSchema` is strict, so an invented key invalidates the whole
    // document and the gateway keeps running its previous model without saying
    // why. OpenClaw already owns the catalogue for these ids and reads the key
    // from the state dotenv, so the right overlay is no overlay.
    const entry = buildProviderEntry({
      id: 'anthropic',
      apiKey: 'sk-ant-x',
      model: 'anthropic/claude-opus-4-8',
      models: ['claude-opus-4-8'],
    })
    expect(entry).toEqual({})
  })

  it('declares models for a custom OpenAI-compatible endpoint', () => {
    const entry = buildProviderEntry({
      id: 'my-proxy',
      apiKey: 'k',
      baseUrl: 'https://proxy.example/v1',
      model: 'my-proxy/glm-5',
      models: ['glm-5'],
      reasoning: true,
    })
    const models = entry.models as { id: string; api: string; reasoning?: boolean }[]
    expect(models[0]?.id).toBe('glm-5')
    expect(models[0]?.reasoning).toBe(true)
  })

  it('gives local providers their auth marker and catalogue', () => {
    const entry = buildProviderEntry({
      id: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'ollama/qwen3:0.6b',
      models: ['qwen3:0.6b'],
    })
    expect(entry.apiKey).toBe('ollama-local')
    expect(entry.models).toEqual([{ id: 'qwen3:0.6b', name: 'qwen3:0.6b' }])
  })

  it('keeps API keys out of the config document', () => {
    const withKey = buildConfig({
      port: 18789,
      token: 'tok',
      workspace: '/tmp/ws',
      provider: { id: 'anthropic', apiKey: 'sk-ant-secret', model: 'anthropic/claude-opus-4-8' },
    })
    // The key goes to ~/.openclaw-clawmuse/.env and is read from there by the gateway;
    // the config document — the file most likely to end up in a bug report —
    // never sees it, nor a reference to it.
    expect(JSON.stringify(withKey)).not.toContain('sk-ant-secret')
    expect((withKey.models as { providers: Record<string, unknown> }).providers).toEqual({})
    // The model choice itself is not a secret and does belong here.
    expect(JSON.stringify(withKey)).toContain('anthropic/claude-opus-4-8')
  })
})

describe('config merge', () => {
  it('overwrites the keys the app owns', () => {
    const merged = mergeConfig(
      { gateway: { port: 1 }, agents: { custom: true } },
      buildConfig({ port: 18789, token: 'tok', workspace: '/tmp/ws' }),
    )
    expect((merged.gateway as Record<string, unknown>).port).toBe(18789)
  })

  it('preserves user-owned sections such as a hand-tuned sandbox', () => {
    const existing = {
      agents: { defaults: { sandbox: { mode: 'all', backend: 'docker' } } },
      skills: { entries: { github: { enabled: true } } },
    }
    const merged = mergeConfig(existing, buildConfig({ port: 18789, token: 'tok', workspace: '/tmp/ws' }))
    // Preserved value-for-value. `agents` is not compared whole because the
    // bot-plane migration below adds `defaults.subagents` to an old profile.
    expect((merged.agents as { defaults: Record<string, unknown> }).defaults.sandbox).toEqual({
      mode: 'all',
      backend: 'docker',
    })
    expect(merged.skills).toEqual(existing.skills)
  })

  /**
   * A profile created before bots existed keeps a `tools` block with no
   * `agentToAgent`, and every handoff then fails with "Agent-to-agent messaging
   * is disabled" on a machine whose config looks perfectly fine.
   */
  describe('bot-plane migration', () => {
    const oldProfile = {
      tools: { web: { fetch: { enabled: true } } },
      agents: { defaults: { workspace: '/tmp/ws' }, list: [{ id: 'main' }] },
    }

    it('adds the multi-bot keys to a profile that predates them', () => {
      const merged = mergeConfig(oldProfile, buildConfig({ port: 18789, token: 'tok', workspace: '/tmp/ws' }))
      const tools = merged.tools as Record<string, Record<string, unknown>>
      expect(tools.agentToAgent).toEqual({ enabled: true })
      // Both are required: visibility alone cannot send, agentToAgent alone
      // cannot even see the target session.
      expect(tools.sessions).toEqual({ visibility: 'all' })
      expect((merged.session as Record<string, unknown>).agentToAgent).toBeUndefined()
      expect((merged.agents as Record<string, unknown>).ownership).toBe('explicit')
      expect((merged.browser as Record<string, unknown>).enabled).toBe(true)
      expect(
        (merged.agents as { defaults: Record<string, unknown> }).defaults.subagents,
      ).toEqual({ allowAgents: ['*'] })
    })

    it('keeps the user-owned half of the same blocks', () => {
      const merged = mergeConfig(oldProfile, buildConfig({ port: 18789, token: 'tok', workspace: '/tmp/ws' }))
      expect((merged.tools as Record<string, unknown>).web).toEqual({ fetch: { enabled: true } })
      expect((merged.agents as { entries: Record<string, unknown> }).entries).toEqual({ main: {} })
      expect((merged.agents as { list?: unknown[] }).list).toBeUndefined()
    })

    it('never overrides a decision the user already made — including "off"', () => {
      const merged = mergeConfig(
        { ...oldProfile, tools: { agentToAgent: { enabled: false } }, browser: { enabled: false } },
        buildConfig({ port: 18789, token: 'tok', workspace: '/tmp/ws' }),
      )
      expect((merged.tools as Record<string, unknown>).agentToAgent).toEqual({ enabled: false })
      expect((merged.browser as Record<string, unknown>).enabled).toBe(false)
    })
  })

  /**
   * MCP servers are the user's, not the app's.
   *
   * `mcp` was in the owned-keys list, which meant the app rewrote it to `{}` on
   * every boot. OpenClaw ships its own registry for these — `openclaw mcp add`,
   * and a `/settings/mcp` page in its Control UI — so anyone who used either
   * would have found their connectors silently gone the next time the app
   * started, with nothing to explain it.
   */
  it('keeps MCP servers the user registered through the CLI or Control UI', () => {
    const existing = {
      mcp: {
        servers: {
          context7: { command: 'uvx', args: ['context7-mcp'] },
          docs: { url: 'https://mcp.example.com/mcp', transport: 'streamable-http' },
        },
      },
    }
    const merged = mergeConfig(existing, buildConfig({ port: 18789, token: 'tok', workspace: '/tmp/ws' }))
    expect(merged.mcp).toEqual(existing.mcp)
  })

  it('still seeds an empty MCP registry on a profile that has none', () => {
    const merged = mergeConfig({ gateway: { port: 1 } }, buildConfig({ port: 18789, token: 'tok', workspace: '/tmp/ws' }))
    expect(merged.mcp).toEqual({ servers: {} })
  })
})

describe('wiring a provider into an existing config', () => {
  const zai = {
    id: 'zai',
    apiKey: 'secret',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'zai/glm-5.2',
    models: ['glm-5.2'],
    reasoning: true,
  }

  it('registers the provider and makes it the default model', () => {
    const wired = wireProvider({ models: { providers: { ollama: {} } } }, zai)
    const models = wired.models as { providers: Record<string, unknown> }
    expect(Object.keys(models.providers)).toEqual(['ollama', 'zai'])
    expect((wired.agents as { defaults: { model: unknown } }).defaults.model).toEqual({
      primary: 'zai/glm-5.2',
    })
  })

  /**
   * The regression that shipped a no-op: `mergeConfig` hands back a shallow
   * copy, so mutating `config.models` in place also mutated the on-disk config
   * the caller diffs against. The two compared equal, "nothing changed" won,
   * and the provider was never written — while its key *was* written to .env,
   * leaving a half-configured profile that looks fine in the logs.
   */
  it('does not mutate the config it is handed', () => {
    const existing = { models: { providers: { ollama: {} } }, agents: { defaults: {} } }
    const before = structuredClone(existing)
    wireProvider({ ...existing }, zai)
    expect(existing).toEqual(before)
  })

  it('produces a config that compares different, so the change gets persisted', () => {
    const existing = { models: { providers: { ollama: {} } } }
    const wired = wireProvider({ ...existing }, zai)
    expect(JSON.stringify(wired)).not.toBe(JSON.stringify(existing))
  })
})

/**
 * A GUI launch inherits `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else, so
 * Homebrew/nvm Node is invisible and the app reports "Node is not installed" on
 * a machine where it is installed. Verified against the packaged build.
 */
describe('PATH repair for GUI launches', () => {
  const { mergePaths, commonBinDirs } = pathTesting

  it('puts the login shell PATH ahead of the fallbacks', () => {
    const merged = mergePaths('/shell/bin', '/usr/bin', '/opt/homebrew/bin')
    expect(merged.split(':')[0]).toBe('/shell/bin')
  })

  it('keeps the inherited PATH even when the shell probe fails', () => {
    expect(mergePaths(null, '/usr/bin:/bin', '/opt/homebrew/bin')).toBe(
      '/usr/bin:/bin:/opt/homebrew/bin',
    )
  })

  it('does not duplicate directories', () => {
    expect(mergePaths('/usr/bin:/opt/homebrew/bin', '/usr/bin', '/opt/homebrew/bin')).toBe(
      '/usr/bin:/opt/homebrew/bin',
    )
  })

  it('drops empty segments rather than emitting a bare colon', () => {
    // A stray `::` in PATH means "current directory" to some tools — a real
    // security footgun, not just cosmetic.
    expect(mergePaths('/usr/bin::/bin', '', null)).toBe('/usr/bin:/bin')
  })

  it('offers the locations Node actually installs to on macOS', () => {
    const dirs = commonBinDirs()
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs).toContain('/usr/local/bin')
  })
})

describe('env file', () => {
  it('round-trips values that contain shell-significant characters', () => {
    const map = { ANTHROPIC_API_KEY: "sk-ant-a#b c'd", BASE: 'http://127.0.0.1:1234/v1' }
    expect(parseEnv(serializeEnv(map))).toEqual(map)
  })

  it('reads the `export KEY=value` form launchd writes', () => {
    expect(parseEnv("export OPENCLAW_STATE_DIR='/Users/x/.openclaw-clawmuse'\n")).toEqual({
      OPENCLAW_STATE_DIR: '/Users/x/.openclaw-clawmuse',
    })
  })

  it('maps providers to their conventional key names', () => {
    expect(envVarForProvider('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(envVarForProvider('my-proxy')).toBe('MY_PROXY_API_KEY')
  })
})

describe('node version gate', () => {
  it('rejects versions below the OpenClaw floor', () => {
    expect(evaluateNodeVersion('v20.11.0').ok).toBe(false)
    expect(evaluateNodeVersion('v22.18.0').ok).toBe(false)
  })

  it('accepts the supported range', () => {
    expect(evaluateNodeVersion('v24.16.0').ok).toBe(true)
    expect(evaluateNodeVersion('v26.1.0').ok).toBe(true)
  })

  it('rejects unsupported majors and warns above the verified range', () => {
    expect(evaluateNodeVersion('v25.9.0').ok).toBe(false)
    expect(evaluateNodeVersion('v26.0.0').ok).toBe(false)
    const result = evaluateNodeVersion('v27.0.0')
    expect(result.ok).toBe(true)
    expect(result.warning).toBeDefined()
  })
})

describe('Claude Code as the model (claude-cli runtime)', () => {
  it('routes the model through the CLI runtime, and clears it on a switch', () => {
    const claude = wireProvider({}, { id: 'anthropic', model: 'anthropic/claude-opus-4-8', runtime: 'claude-cli' })
    const defaults = (claude.agents as { defaults: Record<string, unknown> }).defaults
    expect(defaults.model).toEqual({ primary: 'anthropic/claude-opus-4-8' })
    expect(defaults.models).toEqual({ 'anthropic/claude-opus-4-8': { agentRuntime: { id: 'claude-cli' } } })
    const switched = wireProvider(claude, { id: 'anthropic', apiKey: 'k', model: 'anthropic/claude-opus-4-8' })
    expect((switched.agents as { defaults: Record<string, unknown> }).defaults.models).toBeUndefined()
  })
})
