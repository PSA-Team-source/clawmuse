import { createHash, randomBytes } from 'node:crypto'
import type { ProviderChoice } from '@shared/ipc'
import { DEFAULT_PORT, paths } from './paths.js'

/**
 * Generates `~/.openclaw-clawmuse/openclaw.json`.
 *
 * This is the single-tenant counterpart of the server's `createSandboxConfig`
 * (`_LOCALFANG/server/src/services/sandbox-manager.js`). The differences from the
 * production document are all deliberate:
 *
 * | field                  | prod (EC2)                       | here                    |
 * |------------------------|----------------------------------|-------------------------|
 * | `gateway.bind`         | trustedProxies open to all       | `loopback`, no proxies  |
 * | `gateway.auth.token`   | server-issued, injected by bridge| app-issued, app-sent    |
 * | `models.providers`     | keys from `server/.env`          | BYOK, keys live in .env |
 * | `mcp.servers`          | facebook-ads + platformdtc       | `{}` (both are server   |
 * |                        |                                  | processes; absent local)|
 * | bedrock plugin + ~/.aws| present                          | dropped                 |
 * | `discovery.mdns`       | on                               | **off**                 |
 *
 * The mDNS decision is not cosmetic: with defaults on, the gateway advertises
 * `_openclaw-gw._tcp` on the LAN with the host's name. A local-first app that
 * announces itself to the coffee-shop network by default is not local-first.
 *
 * Kept a pure function so it is testable without touching disk.
 */

export interface ConfigInput {
  port: number
  token: string
  provider?: ProviderChoice
  workspace: string
  /** Skills the user has explicitly toggled; merged over the offline defaults. */
  skillOverrides?: Record<string, boolean>
}

/**
 * Built-in skills that work with no cloud account and no extra credentials.
 * Everything else stays available in the Skills screen but starts disabled, so
 * a fresh profile does not fail health checks for tools it cannot reach.
 */
const OFFLINE_DEFAULT_SKILLS = [
  'healthcheck',
  'skill-creator',
  'summarize',
  'session-logs',
  'model-usage',
  'nano-pdf',
  'coding-agent',
  'diagram-maker',
  'weather',
] as const

/**
 * The `tools` keys that turn one gateway into a roster of bots.
 *
 * `sessions.visibility` defaults to `"tree"` — a bot can only see the sessions
 * it spawned — so without `"all"` a bot cannot even name another bot's thread,
 * and `agentToAgent` gates the actual cross-agent send on top of it. Both are
 * required; either one alone silently does nothing.
 */
const BOT_PLANE_TOOLS = {
  agentToAgent: { enabled: true },
  sessions: { visibility: 'all' },
} as const

export function generateGatewayToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * OpenClaw ≥2026.5.31 rejects a hooks token equal to the gateway token, so it
 * is derived rather than reused — one secret to protect, two distinct values.
 */
export function deriveHooksToken(gatewayToken: string): string {
  return createHash('sha256').update(`${gatewayToken}:hooks`).digest('hex')
}

/** Providers that run on this machine and need no real credential. */
const LOCAL_PROVIDER_IDS = new Set(['ollama', 'lmstudio'])

/**
 * Cloud providers OpenClaw ships built in — it owns their catalogue, endpoint
 * detection and credential lookup, so this app must not overlay them. Mirrors
 * the ids in `BUILT_IN_MODEL_PROVIDER_OVERLAY_IDS`
 * (`_OPENCLAW-MAIN/src/config/zod-schema.core.ts`); kept to the ones
 * `envVarForProvider` knows, which is the set BYOK onboarding can produce.
 */
const BUILT_IN_CLOUD_PROVIDER_IDS = new Set([
  'anthropic',
  'openai',
  'openrouter',
  'zai',
  'google',
  'groq',
])

export function buildProviderEntry(provider: ProviderChoice): Record<string, unknown> {
  const entry: Record<string, unknown> = {}
  if (provider.baseUrl) entry.baseUrl = provider.baseUrl

  if (LOCAL_PROVIDER_IDS.has(provider.id)) {
    // Loopback Ollama takes the `ollama-local` marker instead of a real bearer
    // token; LM Studio ignores the value entirely. Without something here the
    // provider is treated as missing a credential and never loads.
    entry.apiKey = provider.id === 'ollama' ? 'ollama-local' : 'lmstudio'
    if (provider.id === 'lmstudio') entry.api = 'openai-responses'
    // OpenClaw does not enumerate a local catalogue, so the models have to be
    // declared or `models.list` returns nothing and the picker looks empty.
    if (provider.models?.length) {
      entry.models = provider.models.map((id) => ({ id, name: id }))
    }
  } else if (BUILT_IN_CLOUD_PROVIDER_IDS.has(provider.id)) {
    // Nothing to declare. OpenClaw ships the catalogue for these ids and probes
    // the right endpoint from the key itself (`docs/providers/zai.md`), and it
    // reads the credential from the state dotenv under the conventional name in
    // `envVarForProvider` — so the key never has to enter this document.
    //
    // Writing an overlay here is actively harmful: it freezes a catalogue that
    // upstream maintains, and `ModelProviderSchema` is `.strict()`, so any
    // invented key (an `apiKeyEnvVar`, say) makes the whole config invalid and
    // the gateway falls back to its previous model without saying why.
  } else if (provider.models?.length) {
    // A custom OpenAI-compatible endpoint. `ModelProvidersSchema.superRefine`
    // *requires* both baseUrl and models for a non-built-in id, so a provider
    // that reaches here without them cannot be expressed at all.
    entry.models = provider.models.map((id) => ({
      id,
      name: id,
      api: 'openai-completions',
      input: ['text'],
      // Load-bearing for reasoning models: the provider only sends the thinking
      // flag when the model declares it, otherwise the chain of thought arrives
      // inline as the answer.
      ...(provider.reasoning ? { reasoning: true } : {}),
      ...(provider.contextWindow ? { contextWindow: provider.contextWindow } : {}),
      ...(provider.maxTokens ? { maxTokens: provider.maxTokens } : {}),
    }))
  }

  return entry
}

function providerBlock(provider: ProviderChoice | undefined): Record<string, unknown> {
  if (!provider) return {}
  const entry = buildProviderEntry(provider)
  return Object.keys(entry).length > 0 ? { [provider.id]: entry } : {}
}

/** Env var name a provider's key is published under. Mirrors OpenClaw defaults. */
export function envVarForProvider(providerId: string): string {
  const known: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    zai: 'ZAI_API_KEY',
    google: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
  }
  return known[providerId] ?? `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}

export function buildConfig(input: ConfigInput): Record<string, unknown> {
  const skills: Record<string, { enabled: boolean }> = {}
  for (const key of OFFLINE_DEFAULT_SKILLS) skills[key] = { enabled: true }
  for (const [key, enabled] of Object.entries(input.skillOverrides ?? {})) skills[key] = { enabled }

  return {
    gateway: {
      mode: 'local',
      bind: 'loopback',
      port: input.port,
      auth: { mode: 'token', token: input.token },
      controlUi: {
        // The Advanced tab opens the gateway's own Control UI in a separate
        // window, so its origin has to be allowed. Device auth stays ON —
        // `dangerouslyDisableDeviceAuth` is a critical finding in OpenClaw's
        // own audit checks and has no place in a shipping config.
        allowedOrigins: [`http://127.0.0.1:${input.port}`, `http://localhost:${input.port}`],
      },
      // Off by default in OpenClaw; `terminal.open` answers "terminal is
      // disabled" until this is set. Safe to enable here because the gateway
      // is loopback-only and single-user — the shell it opens is the user's
      // own, on their own machine, which is the whole point of local mode.
      terminal: { enabled: true },
    },
    // `mode: "off"` suppresses LAN multicast without touching plugin
    // enablement. (`enabled: false` is not a real key — the gateway rejects the
    // whole document as invalid and then refuses to restart.)
    discovery: { mdns: { mode: 'off' } },
    // Bots hand work to each other without the user relaying it. `allow` is
    // deliberately absent: an empty/omitted list means "any agent", so the
    // policy never has to be rewritten as the roster grows
    // (`createAgentToAgentPolicy`, openclaw `src/plugin-sdk/session-visibility.ts`
    // — `allowPatterns.length === 0` returns true).
    agents: {
      ownership: 'explicit',
      defaults: {
        maxConcurrent: 4,
        // A chief-of-staff bot delegating to a specialist: `sessions_spawn`
        // rejects a cross-agent target unless the requester allows it, and the
        // default is same-agent-only.
        subagents: { allowAgents: ['*'] },
        // Written explicitly rather than left to `OPENCLAW_WORKSPACE_DIR`: that
        // variable is not persisted into the launchd service environment, so
        // the daemon would fall back to `~/.openclaw/workspace-clawmuse` and the
        // profile would end up split across two directories.
        workspace: input.workspace,
        ...(input.provider ? { model: { primary: input.provider.model } } : {}),
      },
      entries: {
        main: {
          identity: {
            name: 'ClawMuse',
            theme: 'helpful AI agent that works directly on this machine',
            emoji: '🦞',
          },
        },
      },
    },
    models: {
      mode: 'merge',
      providers: providerBlock(input.provider),
    },
    tools: { web: { fetch: { enabled: true } }, media: {}, ...BOT_PLANE_TOOLS },
    // The shared computer's browser.
    //
    // No `profiles` entry on purpose: a declared profile must carry its own
    // `cdpPort` and a hex `color` (`browser.profiles` is `.strict()` with a
    // required colour and a "must set cdpPort or cdpUrl" refinement), so
    // inventing one buys a port collision and an invalid-document risk for
    // nothing. The built-in managed profile already keeps its Chrome user-data
    // at `<state dir>/browser/openclaw/user-data` — inside `~/.openclaw-clawmuse`, one per
    // machine, shared by every bot. That IS the "log in once, all bots inherit
    // the session" behaviour, and it costs one key.
    browser: { enabled: true },
    // Seeded empty, then never touched again — see `mergeConfig`.
    //
    // Empty is the honest starting point, not a limitation: OpenClaw runs the
    // servers itself (spawning stdio processes, handling OAuth for HTTP ones),
    // so this machine can host any MCP server the ecosystem offers as soon as
    // one is registered. The production pair (facebook-ads, platformdtc) are
    // absent because they are server-side processes that read a multi-tenant
    // Postgres, not because local mode cannot host connectors.
    mcp: { servers: {} },
    cron: { enabled: true },
    hooks: {
      enabled: true,
      token: deriveHooksToken(input.token),
      path: '/hooks',
    },
    skills: { entries: skills, load: { watch: true } },
    commands: { native: 'auto', text: true, config: true, debug: false, restart: true },
    messages: { responsePrefix: '🦞' },
    logging: { level: 'info', consoleLevel: 'info' },
    meta: {
      lastTouchedVersion: 'clawmuse',
    },
  }
}

/**
 * Wires a provider into an already-merged config and makes it the default model.
 *
 * Needed because model selection lives in the user-owned half of the document,
 * which `mergeConfig` deliberately preserves — so a provider added after first
 * run has to be written in explicitly rather than relying on the generated
 * defaults winning.
 */
export function wireProvider(
  config: Record<string, unknown>,
  provider: ProviderChoice,
): Record<string, unknown> {
  const agents = (config.agents ?? {}) as Record<string, unknown>
  const defaults = (agents.defaults ?? {}) as Record<string, unknown>
  const models = (config.models ?? {}) as Record<string, unknown>
  const providers = (models.providers ?? {}) as Record<string, unknown>

  const entry = buildProviderEntry(provider)
  const nextProviders = { ...providers }
  if (Object.keys(entry).length > 0) {
    nextProviders[provider.id] = {
      ...((providers[provider.id] as Record<string, unknown>) ?? {}),
      ...entry,
    }
  } else {
    // A built-in provider needs no overlay, and an empty `{}` is just noise.
    // Deleting also repairs a stale or invalid overlay left by an older build —
    // one bad entry invalidates the whole document and silently pins the agent
    // to its previous model.
    delete nextProviders[provider.id]
  }

  // Rebuilt rather than mutated in place. `mergeConfig` returns a shallow copy,
  // so `config.models` is the *same object* as the on-disk config's — editing it
  // would also edit the value callers diff against, the change would compare
  // equal, and the new provider would silently never be written.
  // A CLI runtime is per-model policy: `agents.defaults.models[ref].agentRuntime`
  // (docs/providers/anthropic.md). Any other provider clears a stale one, so a
  // user who switches away from Claude Code is not left routed through it.
  const modelPolicy = { ...((defaults.models ?? {}) as Record<string, Record<string, unknown>>) }
  const { agentRuntime: _previous, ...rest } = modelPolicy[provider.model] ?? {}
  modelPolicy[provider.model] = provider.runtime ? { ...rest, agentRuntime: { id: provider.runtime } } : rest
  if (Object.keys(modelPolicy[provider.model]!).length === 0) delete modelPolicy[provider.model]

  return {
    ...config,
    agents: {
      ...agents,
      defaults: {
        ...Object.fromEntries(Object.entries(defaults).filter(([key]) => key !== 'models')),
        model: { primary: provider.model },
        ...(Object.keys(modelPolicy).length ? { models: modelPolicy } : {}),
      },
    },
    models: { ...models, mode: 'merge', providers: nextProviders },
  }
}

/**
 * Keys this app owns. Everything else in an existing config belongs to the user
 * (or to the CLI) and is preserved on regeneration — the app must not stomp a
 * hand-tuned `agents.defaults.sandbox` just because it rewrote the port.
 *
 * `mcp` used to be here, and that was wrong. OpenClaw ships its own registry for
 * MCP servers — `openclaw mcp add|set|unset`, a `/settings/mcp` page in the
 * Control UI — so the moment anyone used either, the next boot silently threw
 * their servers away. Owning a key means "the app is the only editor", and for
 * MCP that was never true. It is seeded once below and left alone after.
 */
const OWNED_KEYS = ['gateway', 'discovery', 'hooks', 'meta'] as const

export function mergeConfig(
  existing: Record<string, unknown> | null,
  generated: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing) return generated
  const merged: Record<string, unknown> = { ...existing }
  for (const key of OWNED_KEYS) merged[key] = generated[key]
  // First-run-only sections: seed them if absent, never overwrite. `mcp` belongs
  // here rather than above precisely because the user is expected to edit it.
  for (const key of ['agents', 'models', 'skills', 'cron', 'tools', 'commands', 'messages', 'logging', 'mcp', 'session', 'browser']) {
    if (merged[key] === undefined) merged[key] = generated[key]
  }
  return fillBotPlaneGaps(merged)
}

/** Reads one level of a plain object without inventing a branch for `null`. */
function subObject(value: unknown, key: string): Record<string, unknown> | null {
  const parent = value as Record<string, unknown> | null | undefined
  const child = parent?.[key]
  return child && typeof child === 'object' && !Array.isArray(child)
    ? (child as Record<string, unknown>)
    : null
}

/**
 * Adds the multi-bot keys to a profile that predates them.
 *
 * The sections above are seeded **once**, which is right — they are the user's
 * to edit — but it also means a profile created before bots existed keeps a
 * `tools` block with no `agentToAgent`, and every handoff fails with "Agent-to-
 * agent messaging is disabled" on a machine that looks correctly configured.
 *
 * So this fills gaps and only gaps: a key the user (or the CLI) has already set
 * to anything, including `false`, is left exactly as it is. It is a migration,
 * not ownership — which is why `tools` stays out of `OWNED_KEYS`.
 */
export function fillBotPlaneGaps(config: Record<string, unknown>): Record<string, unknown> {
  const tools = (subObject(config, 'tools') ?? {}) as Record<string, unknown>
  const sourceAgents = (subObject(config, 'agents') ?? {}) as Record<string, unknown>
  const legacyList = Array.isArray(sourceAgents.list) ? sourceAgents.list : []
  const existingEntries = subObject(sourceAgents, 'entries') ?? {}
  const migratedEntries: Record<string, unknown> = { ...existingEntries }
  for (const raw of legacyList) {
    if (!raw || typeof raw !== 'object') continue
    const { id, default: _retiredDefault, ...entry } = raw as Record<string, unknown>
    if (typeof id === 'string' && id.length > 0 && migratedEntries[id] === undefined) {
      migratedEntries[id] = entry
    }
  }
  for (const [id, raw] of Object.entries(migratedEntries)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const { default: _retiredDefault, id: _retiredId, ...entry } = raw as Record<string, unknown>
    migratedEntries[id] = entry
  }
  const { list: _retiredList, ...agents } = sourceAgents
  const defaults = (subObject(agents, 'defaults') ?? {}) as Record<string, unknown>
  const sourceSession = (subObject(config, 'session') ?? {}) as Record<string, unknown>
  const { agentToAgent: _retiredSessionPolicy, ...session } = sourceSession
  const browser = (subObject(config, 'browser') ?? {}) as Record<string, unknown>
  const sourceCron = (subObject(config, 'cron') ?? {}) as Record<string, unknown>
  const { maxConcurrentRuns: _retiredCronConcurrency, ...cron } = sourceCron
  const sourceSkills = (subObject(config, 'skills') ?? {}) as Record<string, unknown>
  const sourceSkillsLoad = (subObject(sourceSkills, 'load') ?? {}) as Record<string, unknown>
  const { watchDebounceMs: _retiredWatchDebounce, ...skillsLoad } = sourceSkillsLoad
  const skills = sourceSkills.load === undefined ? sourceSkills : { ...sourceSkills, load: skillsLoad }

  return {
    ...config,
    tools: {
      ...tools,
      agentToAgent: tools.agentToAgent ?? BOT_PLANE_TOOLS.agentToAgent,
      sessions: tools.sessions ?? BOT_PLANE_TOOLS.sessions,
    },
    agents: {
      ...agents,
      ownership: agents.ownership ?? 'explicit',
      entries: migratedEntries,
      defaults: { ...defaults, subagents: defaults.subagents ?? { allowAgents: ['*'] } },
    },
    session,
    cron,
    skills,
    browser: { ...browser, enabled: browser.enabled ?? true },
  }
}

export const DEFAULTS = { port: DEFAULT_PORT, workspace: paths.workspace }
