import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/main.js'
import { DEFAULT_MODEL_BY_PROVIDER, type ProviderChoice } from '@shared/ipc'
import { envVarForProvider } from './config-gen.js'
import { parseEnv } from './env-file.js'
import { CLAWMUSE_HOME } from './paths.js'

/**
 * Adopts the model provider from a plain `openclaw` install already on this Mac.
 *
 * The product requirement is "install and use it immediately" — a machine that
 * already runs OpenClaw has, by definition, answered every question onboarding
 * would ask, so asking again is pure friction.
 *
 * This reads `~/.openclaw` and never writes to it. The app keeps its own profile
 * at `~/.openclaw-clawmuse` (see `paths.ts`): separate gateway, workspace, sessions and
 * cron. Only the credential and the model choice are copied across, once, and
 * only while this app has no provider of its own — so a user who later picks a
 * different model in Settings is not reset to the host's on the next launch.
 *
 * Credentials are read from files, never from `process.env`. A GUI launch
 * inherits no shell, so an exported key would make adoption succeed from a
 * terminal and fail from the Dock — the same install behaving two ways.
 */

/**
 * The default OpenClaw state directory.
 *
 * Deliberately not `process.env.OPENCLAW_STATE_DIR`: inside this app that
 * variable is *our* profile (`openclawEnv()` sets it to `~/.openclaw-clawmuse`), so
 * reading it here would make the app try to adopt from itself.
 */
const HOST_STATE_DIR = join(homedir(), '.openclaw')

/** Providers that need no credential — the key check does not apply to them. */
const LOCAL_PROVIDER_IDS = new Set(['ollama', 'lmstudio'])

/**
 * Mirrors `BUILT_IN_CLOUD_PROVIDER_IDS` in `config-gen.ts`. Kept as its own set
 * because the two answer different questions: that one decides whether to write
 * an overlay, this one decides whether a `baseUrl`/`models` pair is required to
 * express the provider at all.
 */
const BUILT_IN_CLOUD_PROVIDER_IDS = new Set(['anthropic', 'openai', 'openrouter', 'zai', 'google', 'groq'])

export interface HostProfile {
  config: Record<string, unknown>
  env: Record<string, string>
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch (error) {
    log.warn(`[adopt-host] ${path} is unreadable:`, (error as Error).message)
    return null
  }
}

async function readHostProfile(): Promise<HostProfile | null> {
  // A profile pointed at our own home has nothing to teach us, and copying it
  // onto itself would be a no-op at best.
  if (HOST_STATE_DIR === CLAWMUSE_HOME) return null

  const config = await readJson(join(HOST_STATE_DIR, 'openclaw.json'))
  if (!config) return null

  let env: Record<string, string> = {}
  const envPath = join(HOST_STATE_DIR, '.env')
  if (existsSync(envPath)) {
    try {
      env = parseEnv(await readFile(envPath, 'utf8'))
    } catch (error) {
      log.warn('[adopt-host] host .env is unreadable:', (error as Error).message)
    }
  }
  return { config, env }
}

/** Model refs split on the FIRST slash: `openrouter/anthropic/x` → `openrouter`. */
function providerIdOf(modelRef: string): string | null {
  const slash = modelRef.indexOf('/')
  if (slash <= 0) return null
  return modelRef.slice(0, slash)
}

function providerEntry(profile: HostProfile, id: string): Record<string, unknown> | null {
  const models = profile.config.models as { providers?: Record<string, unknown> } | undefined
  const entry = models?.providers?.[id]
  return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
}

/**
 * Finds the credential for a provider, in OpenClaw's own precedence order.
 *
 * `openclaw.json`'s `env` block comes first because that is where the CLI's
 * setup wizard puts a key, and it is what this machine actually runs on.
 */
function credentialFor(profile: HostProfile, id: string): string | null {
  const varName = envVarForProvider(id)

  const configEnv = profile.config.env as Record<string, unknown> | undefined
  const fromConfig = configEnv?.[varName]
  if (typeof fromConfig === 'string' && fromConfig.length > 0) return fromConfig

  const fromDotenv = profile.env[varName]
  if (typeof fromDotenv === 'string' && fromDotenv.length > 0) return fromDotenv

  const fromProvider = providerEntry(profile, id)?.apiKey
  if (typeof fromProvider === 'string' && fromProvider.length > 0) return fromProvider

  return null
}

function declaredModelIds(entry: Record<string, unknown> | null): string[] {
  const models = entry?.models
  if (!Array.isArray(models)) return []
  return models
    .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/** Every model ref the host config nominates, best first. */
function candidateModelRefs(config: Record<string, unknown>): string[] {
  const agents = config.agents as { defaults?: { model?: unknown } } | undefined
  const model = agents?.defaults?.model
  if (!model || typeof model !== 'object') return []

  const { primary, fallbacks } = model as { primary?: unknown; fallbacks?: unknown }
  const refs: string[] = []
  if (typeof primary === 'string' && primary.length > 0) refs.push(primary)
  if (Array.isArray(fallbacks)) {
    for (const ref of fallbacks) if (typeof ref === 'string' && ref.length > 0) refs.push(ref)
  }
  return refs
}

/**
 * Builds the choice for one model ref, or null when this machine cannot serve it.
 *
 * A ref whose provider has no credential is skipped rather than adopted: the
 * gateway would start cleanly and then fail on the first message, which reads as
 * a broken app rather than a missing key.
 */
function choiceFor(profile: HostProfile, ref: string): ProviderChoice | null {
  const id = providerIdOf(ref)
  if (!id) return null

  const entry = providerEntry(profile, id)
  const baseUrl = typeof entry?.baseUrl === 'string' ? entry.baseUrl : undefined

  if (LOCAL_PROVIDER_IDS.has(id)) {
    // No credential to carry. The bare model id has to be declared or
    // `models.list` comes back empty and the picker looks broken.
    const bare = ref.slice(id.length + 1)
    return { id, model: ref, ...(baseUrl ? { baseUrl } : {}), ...(bare ? { models: [bare] } : {}) }
  }

  const apiKey = credentialFor(profile, id)
  if (!apiKey) return null

  if (BUILT_IN_CLOUD_PROVIDER_IDS.has(id)) {
    // OpenClaw owns the catalogue and endpoint detection for these ids, so the
    // choice carries nothing but the key and the ref.
    return { id, apiKey, model: ref, ...(baseUrl ? { baseUrl } : {}) }
  }

  // A custom OpenAI-compatible endpoint. `ModelProvidersSchema.superRefine`
  // requires both a baseUrl and a models list for a non-built-in id, so a
  // provider missing either cannot be expressed in our config at all.
  const models = declaredModelIds(entry)
  if (!baseUrl || models.length === 0) return null
  return { id, apiKey, baseUrl, model: ref, models }
}

/**
 * Picks the provider to adopt from an already-read profile.
 *
 * Split from the IO so the decision — which is where the traps are — is
 * testable without a home directory or a real OpenClaw install.
 */
export function chooseHostProvider(profile: HostProfile): ProviderChoice | null {
  for (const ref of candidateModelRefs(profile.config)) {
    const choice = choiceFor(profile, ref)
    if (choice) return choice
  }
  return null
}

/**
 * The provider this machine's existing OpenClaw install is already using.
 *
 * Returns null when there is no install, no model chosen, or no credential for
 * any model it nominates — in which case onboarding applies as before.
 */
export async function hostProvider(): Promise<ProviderChoice | null> {
  const profile = await readHostProfile()
  if (!profile) return null
  const choice = chooseHostProvider(profile)
  if (choice?.apiKey && (await keyRejected(choice.id, choice.apiKey))) {
    log.info(`[adopt-host] the ${choice.id} key in ${HOST_STATE_DIR} is rejected by ${choice.id} — not adopting it; onboarding applies`)
    return null
  }
  return choice
}

/**
 * Where a provider says whether a key is valid, without spending tokens.
 * Providers not listed are adopted unchecked, as before.
 */
const KEY_CHECKS: Record<string, (key: string) => { url: string; init: RequestInit }> = {
  openrouter: (key) => ({ url: 'https://openrouter.ai/api/v1/auth/key', init: { headers: { authorization: `Bearer ${key}` } } }),
  openai: (key) => ({ url: 'https://api.openai.com/v1/models', init: { headers: { authorization: `Bearer ${key}` } } }),
  anthropic: (key) => ({ url: 'https://api.anthropic.com/v1/models', init: { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } } }),
  // OpenCode Zen accepts the key on /models yet answers every chat on its free
  // models with 403 FreeTierError ("only from within OpenCode"). Only a
  // one-token chat on the model we would default to tells the truth.
  opencode: (key) => ({
    url: 'https://opencode.ai/zen/v1/chat/completions',
    init: {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: DEFAULT_MODEL_BY_PROVIDER.opencode!.split('/')[1], max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    },
  }),
}

/**
 * True only when the provider itself answers 401/403: a dead key in the host
 * profile would otherwise be copied in and every first message would fail
 * ("401 User not found") in an app that looks set up. Offline or a slow
 * provider is not a verdict — the key is adopted and the chat reports any
 * error, as it would have before this check.
 */
export async function keyRejected(providerId: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const check = KEY_CHECKS[providerId]
  if (!check) return false
  const { url, init } = check(apiKey)
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(8_000) })
    return response.status === 401 || response.status === 403
  } catch {
    return false
  }
}

/**
 * Logs what was adopted, without ever printing the key.
 *
 * `adopting` is passed in rather than inferred: a host provider is looked up on
 * every launch, but only seeded on the first, and a log line that says
 * "adopting" every time would misreport a profile that is merely being read.
 */
export function logHostProvider(provider: ProviderChoice | null, adopting: boolean): void {
  if (!provider) {
    log.info(`[adopt-host] no usable provider in ${HOST_STATE_DIR} — onboarding applies`)
    return
  }
  if (!adopting) {
    log.info(`[adopt-host] this profile is already configured — leaving ${provider.id} in ${HOST_STATE_DIR} alone`)
    return
  }
  log.info(`[adopt-host] adopting ${provider.id} (${provider.model}) from ${HOST_STATE_DIR}`)
}
