import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/main.js'
import { DEFAULT_MODEL_BY_PROVIDER, type CredentialFinding, type ProviderChoice } from '@shared/ipc'
import { hostProvider, keyRejected } from './adopt-host.js'
import { OPENCODE_AUTH_FILE, readOpencodeKey } from './opencode-adopt.js'
import { claudeCliLogin, claudeCliProvider, ensureClaudeOnPath } from './claude-cli.js'
import { envVarForProvider } from './config-gen.js'
import { detectLocalProviders } from './detect-providers.js'
import { parseEnv } from './env-file.js'
import { run } from './exec.js'

/**
 * Finds the model credentials this Mac already has.
 *
 * The product promise is one install and use it. A machine that runs Claude
 * Code, Codex, `openclaw`, or simply exports a key in `.zshrc` has already
 * answered the only question onboarding asks, and asking it again is the
 * difference between an app that works when you open it and an app that wants
 * setup first.
 *
 * Three rules hold everywhere in this file:
 *
 * 1. **Read, never write.** Nothing here modifies `~/.claude`, `~/.codex`,
 *    `~/.openclaw` or any shell file.
 * 2. **Never log a value.** Findings are logged as provider + source only.
 * 3. **Never assume a shell.** A GUI launch inherits no shell environment, so
 *    `process.env` is not consulted — a key exported in `.zshrc` would make the
 *    app work from a terminal and fail from the Dock, which is the same install
 *    behaving two ways.
 */

/**
 * Order of preference when more than one credential is found.
 *
 * Providers the app has no verified default model for are deliberately absent:
 * adopting a key and guessing a model id produces a gateway that starts
 * cleanly and fails on the first message, which reads as a broken app.
 */
// OpenCode last: only adopted when its key can chat (its free tier refuses outside OpenCode).
const PROVIDER_RANK = ['anthropic', 'openrouter', 'openai', 'zai', 'opencode'] as const

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  zai: 'Z.ai',
  opencode: 'OpenCode Zen',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
}

/** Companion variable that redirects a provider at a proxy or gateway. */
const BASE_URL_VARS: Record<string, string> = {
  anthropic: 'ANTHROPIC_BASE_URL',
  openai: 'OPENAI_BASE_URL',
  openrouter: 'OPENROUTER_BASE_URL',
  zai: 'ZAI_BASE_URL',
}

/** Every variable worth asking a login shell about, plus its provider. */
function scannedVars(): { name: string; providerId: string; kind: 'key' | 'baseUrl' }[] {
  const vars: { name: string; providerId: string; kind: 'key' | 'baseUrl' }[] = []
  for (const providerId of PROVIDER_RANK) {
    vars.push({ name: envVarForProvider(providerId), providerId, kind: 'key' })
    const baseUrl = BASE_URL_VARS[providerId]
    if (baseUrl) vars.push({ name: baseUrl, providerId, kind: 'baseUrl' })
  }
  return vars
}

/** One credential, before ranking. */
export interface RawFinding {
  providerId: string
  apiKey: string
  baseUrl?: string
  source: string
}

function shorten(path: string): string {
  const home = homedir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

// ── Sources ─────────────────────────────────────────────────────────────────

/**
 * What the user's login shell would give an interactive session.
 *
 * Deliberately not a full `env` dump: this machine's environment can hold
 * dozens of unrelated secrets, and there is no reason to pull them into this
 * process's memory to answer a question about four variable names. The shell
 * prints `NAME=value` for exactly the names asked for, and nothing else.
 *
 * `-ilc` because Homebrew-style `shellenv` lines live in `.zprofile` for some
 * users and `.zshrc` for others; only an interactive login shell sources both.
 */
async function fromLoginShell(): Promise<RawFinding[]> {
  const shell = process.env.SHELL
  if (!shell) return []

  const names = scannedVars().map((entry) => entry.name)
  // `${VAR+…}` expands only when the variable is *set*, so an unset one prints
  // nothing rather than an empty assignment that later parses as a blank key.
  const script = names.map((name) => `printf '%s' "\${${name}+${name}=$${name}}"; printf '\\n'`).join('; ')

  const result = await run(shell, ['-ilc', script], {
    timeoutMs: 5_000,
    // A clean env would defeat the point: we want what this user's shell builds.
    env: process.env as Record<string, string>,
  }).catch(() => null)
  if (!result || result.code !== 0) return []

  const env = parseEnv(result.stdout)
  return findingsFromEnv(env, 'your shell environment')
}

/** Turns a `NAME=value` map into findings, pairing keys with their base URLs. */
function findingsFromEnv(env: Record<string, string>, source: string): RawFinding[] {
  const found: RawFinding[] = []
  for (const providerId of PROVIDER_RANK) {
    const apiKey = env[envVarForProvider(providerId)]?.trim()
    if (!apiKey) continue
    const baseUrlVar = BASE_URL_VARS[providerId]
    const baseUrl = baseUrlVar ? env[baseUrlVar]?.trim() : undefined
    // Carried, not dropped: a key issued by a proxy is not valid at the
    // provider's own endpoint, so adopting one without the other sends a
    // working credential somewhere it will be rejected — or worse, accepted.
    found.push({ providerId, apiKey, ...(baseUrl ? { baseUrl } : {}), source })
  }
  return found
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch (error) {
    log.warn(`[key-scan] ${shorten(path)} is unreadable:`, (error as Error).message)
    return null
  }
}

/**
 * A JSON settings file that keeps variables under `env`, at the top level, or
 * both — Claude Code and Codex both do a version of this, and neither promises
 * a stable shape, so both places are read and only known names are taken.
 */
export function envFromSettings(settings: Record<string, unknown> | null): Record<string, string> {
  if (!settings) return {}
  const out: Record<string, string> = {}
  const collect = (source: unknown): void => {
    if (!source || typeof source !== 'object') return
    for (const [name, value] of Object.entries(source as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0 && !(name in out)) out[name] = value
    }
  }
  collect(settings.env)
  collect(settings)
  return out
}

async function fromSettingsFile(path: string): Promise<RawFinding[]> {
  const env = envFromSettings(await readJson(path))
  return findingsFromEnv(env, shorten(path))
}

/**
 * `export NAME=value` lines in the files a shell reads at startup.
 *
 * The login-shell probe above already covers everything *exported* into an
 * interactive session, so this is the fallback for the cases it cannot answer:
 * a locked-down or unusual `$SHELL`, a probe that timed out, or a file that
 * guards the export behind a condition the probe did not satisfy.
 */
export function exportsFromShellFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    const name = match[1]!
    let value = match[2]!.trim()
    // Strip one layer of matching quotes; leave anything with a substitution or
    // a command in it alone rather than shipping `$OTHER_VAR` as a credential.
    const quoted = /^"(.*)"$|^'(.*)'$/.exec(value)
    if (quoted) value = quoted[1] ?? quoted[2] ?? ''
    if (!value || value.includes('$') || value.includes('`')) continue
    if (!(name in out)) out[name] = value
  }
  return out
}

const SHELL_FILES = ['.zshrc', '.zprofile', '.zshenv', '.bash_profile', '.bashrc', '.profile']

async function fromShellFiles(): Promise<RawFinding[]> {
  const found: RawFinding[] = []
  for (const file of SHELL_FILES) {
    const path = join(homedir(), file)
    if (!existsSync(path)) continue
    const contents = await readFile(path, 'utf8').catch(() => '')
    if (!contents) continue
    found.push(...findingsFromEnv(exportsFromShellFile(contents), `~/${file}`))
  }
  return found
}

/** Model servers already running on this machine — no key, nothing leaves it. */
async function fromLocalServers(): Promise<ProviderChoice[]> {
  const detected = await detectLocalProviders()
  return detected
    .filter((server) => server.models.length > 0)
    .map((server) => ({
      id: server.id,
      baseUrl: server.baseUrl,
      models: server.models,
      model: `${server.id}/${server.models[0]}`,
    }))
}

// ── Ranking ─────────────────────────────────────────────────────────────────

function toChoice(finding: RawFinding): ProviderChoice | null {
  const model = DEFAULT_MODEL_BY_PROVIDER[finding.providerId]
  if (!model) return null
  return {
    id: finding.providerId,
    apiKey: finding.apiKey,
    model,
    ...(finding.baseUrl ? { baseUrl: finding.baseUrl } : {}),
  }
}

export function rankFindings(raw: RawFinding[], local: ProviderChoice[]): CredentialFinding[] {
  const bestPerProvider = new Map<string, RawFinding>()
  // Sources arrive in precedence order, so the first sighting of a provider is
  // the one to keep — a stale copy in `.zshrc` must not beat the live shell.
  for (const finding of raw) {
    if (!bestPerProvider.has(finding.providerId)) bestPerProvider.set(finding.providerId, finding)
  }

  const ranked: CredentialFinding[] = []
  for (const providerId of PROVIDER_RANK) {
    const finding = bestPerProvider.get(providerId)
    if (!finding) continue
    const provider = toChoice(finding)
    if (!provider) continue
    ranked.push({
      provider,
      label: PROVIDER_LABELS[providerId] ?? providerId,
      source: finding.source,
      needsKey: true,
    })
  }

  // Local servers rank last but are never dropped: they are the only option
  // that costs nothing and sends nothing off the machine, and a user with both
  // should still be able to see and pick one.
  for (const provider of local) {
    ranked.push({
      provider,
      label: PROVIDER_LABELS[provider.id] ?? provider.id,
      source: provider.baseUrl ?? 'this machine',
      needsKey: false,
    })
  }
  return ranked
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Every model credential this Mac can offer, best first.
 *
 * The first entry is what the confirm card proposes; the rest are what "Change"
 * shows. An empty result is the only case that still needs the setup wizard.
 */
export async function scanForCredentials(): Promise<CredentialFinding[]> {
  const home = homedir()

  // A machine that already runs OpenClaw has answered every question this app
  // would ask, so its own profile is consulted first and in its own precedence
  // order (config `env` block, then `.env`, then the provider entry).
  const adopted = await hostProvider().catch(() => null)

  const [shell, claudeSettings, claudeJson, codex, shellFiles, local] = await Promise.all([
    fromLoginShell(),
    fromSettingsFile(join(home, '.claude', 'settings.json')),
    fromSettingsFile(join(home, '.claude.json')),
    fromSettingsFile(join(home, '.codex', 'auth.json')),
    fromShellFiles(),
    fromLocalServers(),
  ])

  // OpenCode keeps its key in its own auth store, which the env-var sources
  // above never see — yet it is often the one credential a new user has.
  const opencodeKey = await readOpencodeKey().catch(() => null)
  const opencode: RawFinding[] = opencodeKey ? [{ providerId: 'opencode', apiKey: opencodeKey, source: shorten(OPENCODE_AUTH_FILE) }] : []

  // A key the provider rejects is not an offer: proposing it puts a new user
  // one click away from a chat that fails every message.
  const candidates = [...shell, ...claudeSettings, ...claudeJson, ...codex, ...shellFiles, ...opencode]
  const verdicts = await Promise.all(candidates.map((finding) => keyRejected(finding.providerId, finding.apiKey)))
  const raw = candidates.filter((finding, index) => {
    if (verdicts[index]) log.info(`[key-scan] skipping the ${finding.providerId} key in ${finding.source}: the provider rejects it`)
    return !verdicts[index]
  })
  const findings = rankFindings(raw, local)

  // Claude Code signed in on this Mac: no key at all, and OpenClaw's
  // preferred path for a desktop app. Ranked above every API key.
  const claudeBin = await claudeCliLogin().catch(() => null)
  if (claudeBin) {
    ensureClaudeOnPath(claudeBin)
    findings.unshift({ provider: claudeCliProvider(), label: 'Claude (your Claude Code login)', source: 'Claude Code on this Mac', needsKey: false })
  }

  if (adopted) {
    // Put the adopted profile first without losing the alternatives behind it.
    const rest = findings.filter((finding) => finding.provider.id !== adopted.id)
    findings.length = 0
    findings.push(
      {
        provider: adopted,
        label: PROVIDER_LABELS[adopted.id] ?? adopted.id,
        source: '~/.openclaw',
        needsKey: Boolean(adopted.apiKey),
      },
      ...rest,
    )
  }

  log.info(
    findings.length > 0
      ? `[key-scan] found ${findings.map((f) => `${f.provider.id} (${f.source})`).join(', ')}`
      : '[key-scan] no model credential on this machine — the setup wizard applies',
  )
  return findings
}

let bestCache: { at: number; value: Promise<ProviderChoice | null> } | null = null

/**
 * The credential a first launch uses without asking: the best one this Mac
 * already has that its provider accepts (see `scanForCredentials`). Asking a
 * user to paste a key that is sitting in their own OpenCode, Claude Code or
 * shell config is friction with no decision in it. Memoised briefly because
 * the setup gate and the first boot both ask within seconds.
 */
export function bestLocalCredential(): Promise<ProviderChoice | null> {
  if (bestCache && Date.now() - bestCache.at < 60_000) return bestCache.value
  const value = scanForCredentials().then((found) => found[0]?.provider ?? null).catch(() => null)
  bestCache = { at: Date.now(), value }
  return value
}
