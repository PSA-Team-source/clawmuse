import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { BrowserWindow } from 'electron'
import log from 'electron-log/main.js'
import type {
  HandshakeFailureOutcome,
  HandshakeFailureReport,
  LocalRuntimeCredentials,
  LocalRuntimeStatus,
  LocalRuntimeStep,
  OpenclawResolution,
  ProviderChoice,
  RuntimeLogs,
} from '@shared/ipc'
import { hostProvider, keyRejected, logHostProvider } from './adopt-host.js'
import { bestLocalCredential } from './key-scan.js'
import { claudeCliLogin, ensureClaudeOnPath } from './claude-cli.js'
import { seedRoster } from './bots.js'
import { appProvider, logAppProvider } from './app-provider.js'
import {
  buildConfig,
  envVarForProvider,
  generateGatewayToken,
  mergeConfig,
  wireProvider,
} from './config-gen.js'
import { patchEnvFile, readEnvFile } from './env-file.js'
import { installBundledRuntime } from './bundled-runtime.js'
import { ensureAvatarSkill, watchAvatarLook } from '../avatar-look.js'
import { ensureBundledNpm, installOpenclawCli } from './install-cli.js'
import { checkNode } from './node-check.js'
import { DEFAULT_PORT, paths, wsUrlFor } from './paths.js'
import { isPortTaken, pickPort } from './port.js'
import { resolveOpenclaw } from './resolve.js'
import { hydratePath } from './shell-path.js'
import { findLatestGatewayLog, readStartupFailure } from './gateway-log.js'
import { installGatewayOriginStrip } from '../ws-origin.js'
import { type PairingRepair, repairDevicePairing } from './pairing.js'
import { configuredCloudProviderIds, ensureProviderPlugins } from './provider-plugins.js'
import { OPENCODE_ENV_VAR, OPENCODE_PROVIDER_IDS, readOpencodeKey } from './opencode-adopt.js'
import {
  authorizedProviders,
  health,
  installService,
  lintConfig,
  registerProviderAuth,
  restartService,
  startServiceIfStopped,
  stopService,
  waitForHealth,
} from './service.js'

/**
 * Owns the lifecycle of the local gateway.
 *
 * `ensure()` is the single entry point and is idempotent: call it on boot, on
 * "Retry", and after a config change. It attaches to a gateway that is already
 * listening rather than installing a second one — launchd keeps ours alive
 * across app quits, so on the second launch of the day there is normally
 * nothing to do but health-check and connect.
 *
 * There is no path from here to the cloud. If every step fails the status ends
 * as `error` and the UI says so (G6).
 */

let status: LocalRuntimeStatus = { state: 'idle' }
let resolution: OpenclawResolution | null = null
let inFlight: Promise<LocalRuntimeStatus> | null = null

export function getStatus(): LocalRuntimeStatus {
  return status
}

export function getResolution(): OpenclawResolution | null {
  return resolution
}

function setStatus(next: LocalRuntimeStatus): void {
  status = next
  // The renderer must reach the gateway without an `Origin` header — with one,
  // the gateway treats a native app as a browser and refuses to pair it. Register
  // the strip as soon as we know the port, before the renderer is told it may
  // connect.
  if (next.state === 'ready') {
    installGatewayOriginStrip(next.port)
    // The workspace exists by now: keep the avatar skill current and follow avatar.json.
    void ensureAvatarSkill()
    watchAvatarLook()
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('runtime-status', next)
  }
}

/**
 * Publishes a `ready` status and makes sure the roster exists.
 *
 * Every path to ready goes through here, and that is the point: the most common
 * one is **attach-if-running** — launchd keeps the gateway alive across quits,
 * so from the second launch onward the app never reaches the end of the install
 * sequence. Seeding only at the end of that sequence meant a machine that had
 * ever run the agent before never got its starting roster.
 *
 * Not awaited: creating four bots is four CLI calls, and holding `ready` behind
 * them would add seconds to a launch that is otherwise finished. `seedRoster`
 * is a no-op once any bot exists.
 */
function announceReady(next: LocalRuntimeStatus): LocalRuntimeStatus {
  setStatus(next)
  void seedRoster().catch((error: unknown) => {
    log.warn('[local-runtime] could not seed the starting roster:', (error as Error).message)
  })
  return next
}

function progress(step: LocalRuntimeStep, detail?: string): void {
  setStatus({ state: 'starting', step, ...(detail ? { detail } : {}) })
}

function fail(step: LocalRuntimeStep, message: string, hint?: string, recoverable = true): LocalRuntimeStatus {
  const next: LocalRuntimeStatus = { state: 'error', step, message, recoverable, ...(hint ? { hint } : {}) }
  setStatus(next)
  log.error(`[local-runtime] ${step}: ${message}`)
  return next
}

// ── Config on disk ──────────────────────────────────────────────────────────

async function readExistingConfig(): Promise<Record<string, unknown> | null> {
  if (!existsSync(paths.config)) return null
  try {
    return JSON.parse(await readFile(paths.config, 'utf8')) as Record<string, unknown>
  } catch (error) {
    log.warn('[local-runtime] existing config unreadable, regenerating:', (error as Error).message)
    return null
  }
}

/** Reads the token/port the daemon is actually configured with. */
export async function readRuntimeConfig(): Promise<{ port: number; token: string } | null> {
  const existing = await readExistingConfig()
  const gateway = existing?.gateway as { port?: number; auth?: { token?: string } } | undefined
  if (!gateway?.auth?.token) return null
  return { port: gateway.port ?? DEFAULT_PORT, token: gateway.auth.token }
}

/**
 * Compares two config documents, ignoring `meta`.
 *
 * `meta.lastTouchedAt` is a timestamp, so a naive deep-equal says "changed" on
 * every single launch — which meant every launch rewrote the file, spent five
 * seconds linting it and then bounced the gateway the user was already talking
 * to.
 */
function sameConfig(a: Record<string, unknown> | null, b: Record<string, unknown>): boolean {
  if (!a) return false
  const strip = (config: Record<string, unknown>): string => {
    const { meta: _meta, ...rest } = config
    return JSON.stringify(rest)
  }
  return strip(a) === strip(b)
}

/** Puts back the pre-write copy after a failed validation. */
async function restoreConfigBackup(): Promise<void> {
  if (!existsSync(paths.configBackup)) return
  await copyFile(paths.configBackup, paths.config).catch((error: unknown) => {
    log.error('[local-runtime] could not restore config backup:', (error as Error).message)
  })
}

async function writeConfig(config: Record<string, unknown>): Promise<void> {
  await mkdir(paths.home, { recursive: true, mode: 0o700 })
  await mkdir(paths.workspace, { recursive: true })
  // Keep one generation of history: config generation is the step most likely
  // to lose hand-tuning, and `.bak` costs nothing.
  if (existsSync(paths.config)) await copyFile(paths.config, paths.configBackup).catch(() => {})
  await writeFile(paths.config, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
}

// ── Provider (BYOK) ─────────────────────────────────────────────────────────

/**
 * Persists a provider choice: key to `.env`, wiring to `openclaw.json`.
 *
 * The key deliberately never enters the config document — see `env-file.ts`.
 */
export async function applyProvider(provider: ProviderChoice): Promise<void> {
  if (provider.apiKey) {
    await patchEnvFile({ [envVarForProvider(provider.id)]: provider.apiKey })
  }
  const existing = await readExistingConfig()
  const current = await readRuntimeConfig()
  const config = mergeConfig(
    existing,
    buildConfig({
      port: current?.port ?? DEFAULT_PORT,
      token: current?.token ?? generateGatewayToken(),
      provider,
      workspace: paths.workspace,
    }),
  )
  const next = wireProvider(config, provider)
  await writeConfig(next)

  // The key in `.env` is for the gateway process; the agent reads its own auth
  // store. Both have to be written or chat fails on the first message.
  if (provider.apiKey && resolution) {
    await ensureProviderAuth(resolution.bin, next)

    // …and neither of those is what a *running* daemon reads. launchd starts the
    // gateway from the snapshot `gateway install` took of `.env`, and an
    // unforced install is a no-op once the service is loaded, so without this
    // the user changes their key in Settings, the app reports success, and the
    // gateway keeps using the previous one until the service is rebuilt.
    const port = current?.port ?? DEFAULT_PORT
    try {
      await installService(resolution.bin, port, { force: true })
      await restartService(resolution.bin)
    } catch (error) {
      log.warn('[local-runtime] could not refresh the service env:', (error as Error).message)
    }
  }
}

// ── Ensure ──────────────────────────────────────────────────────────────────

/**
 * Makes sure every configured cloud provider has a credential the *agent* can
 * see, not just the gateway process.
 *
 * Self-healing rather than write-once: a profile that was configured by an
 * earlier build (or whose auth store was reset) otherwise stays permanently
 * broken, and the symptom — "Agent failed before reply: No API key found" — says
 * nothing about which of the two stores is empty.
 */
async function ensureProviderAuth(bin: string, config: Record<string, unknown>): Promise<void> {
  const providers = Object.keys(
    ((config.models as { providers?: Record<string, unknown> } | undefined)?.providers ?? {}) as Record<
      string,
      unknown
    >,
  ).filter((id) => id !== 'ollama' && id !== 'lmstudio')
  if (providers.length === 0) return

  const authorized = await authorizedProviders(bin)
  const missing = providers.filter((id) => !authorized.has(id))
  if (missing.length === 0) return

  const bundled = appProvider()
  const env = await readEnvFile()
  for (const id of missing) {
    const key = bundled?.id === id ? bundled.apiKey : env[envVarForProvider(id)]
    if (!key) continue
    progress('writing-config', `Storing the ${id} credential…`)
    await registerProviderAuth(bin, id, key).catch((error: unknown) => {
      log.warn(`[local-runtime] ${id} auth registration failed:`, (error as Error).message)
    })
  }
}

async function ensureInner(): Promise<LocalRuntimeStatus> {
  progress('checking-node')
  // Before anything is spawned: a GUI launch inherits none of the user's shell,
  // so `node` and `npm` are not on PATH even when they are installed.
  await hydratePath()
  const node = await checkNode()
  if (!node.ok) {
    return fail('checking-node', node.warning ?? 'Node is unusable', 'Install Node 24 from nodejs.org', false)
  }
  if (node.warning) log.warn(`[local-runtime] ${node.warning}`)

  progress('checking-cli')
  resolution = await resolveOpenclaw()
  // The installer's own copy first — seconds, no network; npm is the fallback.
  if (!resolution) {
    progress('installing-cli', 'Setting up the OpenClaw runtime…')
    if (await installBundledRuntime()) {
      resolution = await resolveOpenclaw()
      if (!resolution) log.warn('[local-runtime] the bundled runtime did not start, falling back to npm')
    }
  }
  // OpenClaw spawns `npm.cmd` itself on Windows (the gateway crash-looped on
  // "spawn npm.cmd ENOENT" on a clean PC), and only the npm install path wrote
  // the shims — so provide them however the runtime arrived.
  if (process.platform === 'win32') await ensureBundledNpm()
  if (!resolution) {
    progress('installing-cli', 'Downloading the OpenClaw runtime…')
    try {
      await installOpenclawCli((line) => progress('installing-cli', line))
    } catch (error) {
      return fail('installing-cli', (error as Error).message, 'Check your network connection, then retry')
    }
    resolution = await resolveOpenclaw()
    if (!resolution) {
      return fail('installing-cli', 'Runtime installed but could not be started', undefined, false)
    }
  }
  const bin = resolution.bin
  log.info(`[local-runtime] using openclaw ${resolution.version} (${resolution.source})`)

  const existing = await readExistingConfig()
  const previous = await readRuntimeConfig()
  // A provider this build ships with wins: it is an explicit decision made at
  // package time. Adoption is the fallback, so a plain build on a machine that
  // already runs `openclaw` still starts straight into chat.
  const bundled = appProvider()
  // `~/.openclaw` first, then any other working key on this Mac (OpenCode,
  // Claude Code, shell exports, a local Ollama) — never a key its provider rejects.
  const adopted = bundled ? null : ((await hostProvider()) ?? (await bestLocalCredential()))
  const seedCandidate = bundled ?? adopted
  // OpenCode's own key, when OpenCode is set up on this Mac: adds its models
  // alongside the default, when the key can chat — see opencode-adopt.ts.
  // Only a key that can actually chat: OpenCode's free tier refuses every
  // request from outside OpenCode, and listing those models would offer the
  // user a menu of choices that all fail.
  const foundOpencodeKey = await readOpencodeKey()
  const opencodeKey = foundOpencodeKey && !(await keyRejected('opencode', foundOpencodeKey)) ? foundOpencodeKey : null
  if (foundOpencodeKey && !opencodeKey) log.info('[opencode-adopt] OpenCode key found, but OpenCode refuses it outside OpenCode (free tier) — not adding its models')

  /**
   * Fetches provider plugins before the gateway is asked to start, rather than
   * while a health probe is counting — see `provider-plugins.ts` for why a
   * missing one costs four minutes on a cold npm cache.
   *
   * Called under "Installing the local agent" because the step already streams
   * npm output and the progress list stays monotonic; doing it after the config
   * write would send the UI backwards through a step it had already ticked off.
   */
  const ensurePlugins = (): Promise<void> =>
    ensureProviderPlugins(
      bin,
      [...configuredCloudProviderIds(existing), ...(seedCandidate ? [seedCandidate.id] : []), ...(opencodeKey ? OPENCODE_PROVIDER_IDS : [])],
      (line) => progress('installing-cli', line),
    )

  // Skipped when a gateway is already listening: it resolved its providers when
  // it started, so the check would cost a process spawn on every launch to
  // learn something the running process has already proved. The `!healthy`
  // recovery path below re-runs it, so a gateway that is up but broken still
  // gets its plugins repaired.
  if (!previous || !(await isPortTaken(previous.port))) {
    await ensurePlugins()
  }

  progress('writing-config')
  const token = previous?.token ?? generateGatewayToken()
  // Reuse the configured port when there is one: the LaunchAgent was installed
  // against it, and moving ports would orphan the running service.
  const port = previous?.port ?? (await pickPort(DEFAULT_PORT))

  // Reconcile the config every run, before deciding whether to attach. Skipping
  // this when a gateway is already up meant an app upgrade that changes an
  // app-owned key (a new default, a security fix) would never reach a machine
  // that keeps its agent running — which is every machine, since launchd does.
  // Seed the provider this build ships with, once. The test is "is this id
  // already registered", not "is any provider configured": a user who later
  // picks Ollama in Settings must not be reset to the bundled one every launch.
  logAppProvider(bundled)
  const registered =
    (existing?.models as { providers?: Record<string, unknown> } | undefined)?.providers ?? {}
  // Adoption is once-only, and "already registered" cannot be the test for it:
  // a built-in cloud provider never appears in `registered` (`wireProvider`
  // writes no overlay for one), so that test would re-seed on every launch and
  // drag a user who later picked another model in Settings back to the host's.
  const seed = bundled
    ? Object.hasOwn(registered, bundled.id)
      ? null
      : bundled
    : adopted && !(await hasConfiguredProviderOnDisk())
      ? adopted
      : null
  if (!bundled) {
    // Name the real source: Claude Code or another key on this Mac is not ~/.openclaw.
    if (adopted?.runtime === 'claude-cli') log.info(`[adopt] ${seed === adopted ? 'using' : 'found'} Claude Code on this Mac (${adopted.model}, claude-cli runtime)`)
    else logHostProvider(adopted, seed !== null && seed === adopted)
  }

  // Tracked because the daemon does not read `.env` directly: `gateway install`
  // snapshots it into `service-env/`, and a plain `install` is a no-op once the
  // service is loaded. A credential written here therefore never reaches a
  // running gateway unless the install is forced — the symptom being a profile
  // that looks correctly configured while every message fails on the old key.
  let credentialChanged = false
  if (seed?.apiKey) {
    const varName = envVarForProvider(seed.id)
    const before = await readEnvFile()
    if (before[varName] !== seed.apiKey) {
      await patchEnvFile({ [varName]: seed.apiKey })
      credentialChanged = true
    }
  }

  let opencodeAdopted = false
  if (opencodeKey && (await readEnvFile())[OPENCODE_ENV_VAR] !== opencodeKey) {
    await patchEnvFile({ [OPENCODE_ENV_VAR]: opencodeKey })
    credentialChanged = true
    opencodeAdopted = true
    log.info('[opencode-adopt] using the OpenCode key from OpenCode on this Mac')
  }

  let config = mergeConfig(
    existing,
    buildConfig({ port, token, workspace: paths.workspace, provider: seed ?? undefined }),
  )
  if (seed) config = wireProvider(config, seed)
  const configChanged = !sameConfig(existing, config)
  if (configChanged) {
    try {
      await writeConfig(config)
    } catch (error) {
      return fail('writing-config', (error as Error).message, undefined, false)
    }

    // Validate what we just wrote. A bad document does not break the running
    // gateway — it breaks the *next* restart, so without this check the failure
    // surfaces much later and looks unrelated to the app.
    const problems = await lintConfig(resolution.bin)
    if (problems.length > 0) {
      const detail = problems.map((p) => `${p.path ?? p.checkId}: ${p.message}`).join('; ')
      await restoreConfigBackup()
      return fail(
        'writing-config',
        `Generated an invalid gateway config (${detail})`,
        'Your previous configuration was restored',
        false,
      )
    }
  }

  // Before anything tries to talk to a model: the credential has to be in the
  // agent's auth store, or the first turn fails instantly with no explanation.
  await ensureProviderAuth(resolution.bin, config)
  if (opencodeAdopted && opencodeKey) {
    // Newly adopted or rotated: the plugin (a running gateway skipped the
    // plugin check above) and the agent's own auth store both need it.
    await ensureProviderPlugins(resolution.bin, [...OPENCODE_PROVIDER_IDS], (line) => progress('writing-config', line))
    const authorized = await authorizedProviders(resolution.bin)
    for (const id of OPENCODE_PROVIDER_IDS) {
      if (authorized.has(id)) continue
      await registerProviderAuth(resolution.bin, id, opencodeKey).catch((error: unknown) => {
        log.warn(`[opencode-adopt] ${id} auth registration failed:`, (error as Error).message)
      })
    }
  }

  // Attach-if-running: something already owns the port. If it answers our health
  // probe with our token it is our gateway from a previous session — join it.
  if (previous && (await isPortTaken(port))) {
    progress('health', 'Found a gateway already running')
    if (await health(resolution.bin, port, token)) {
      const serviceDefinitionStale = existsSync(paths.launchAgent)
        ? !(await readFile(paths.launchAgent, 'utf8').catch(() => '')).includes(paths.runtime)
        : false
      // A running gateway holds its config in memory, so new values only take
      // effect after a restart.
      // A new credential only reaches a running daemon through a forced
      // install (it snapshots `.env`) followed by a restart.
      if (configChanged || serviceDefinitionStale || credentialChanged) {
        progress('starting', 'Applying updated settings…')
        if (credentialChanged) {
          await installService(resolution.bin, port, { force: true })
            .then(() => restartService(resolution!.bin))
            .catch((error: unknown) => {
              log.warn('[local-runtime] credential refresh failed:', (error as Error).message)
            })
        } else if (serviceDefinitionStale) {
          await installService(resolution.bin, port, { force: true }).catch((error: unknown) => {
            log.warn('[local-runtime] canonical service rewrite failed:', (error as Error).message)
          })
        } else {
          await restartService(resolution.bin).catch((error: unknown) => {
            log.warn('[local-runtime] restart after config change failed:', (error as Error).message)
          })
        }
        await waitForHealth(resolution.bin, port, token, {
          onProgress: (detail) => progress('health', detail),
        })
      }
      return announceReady({
        state: 'ready',
        port,
        wsUrl: wsUrlFor(port),
        cliVersion: resolution.version,
        attached: true,
      })
    }
    log.warn('[local-runtime] port busy but health failed — reinstalling the service')
  }

  progress('installing-service')
  let outcome: string
  try {
    // Order matters: the gateway refuses to start without `gateway.mode=local`
    // in the config, and `install` snapshots the environment into the service
    // env file — so config and .env must both exist first.
    //
    // Forced when the credential just changed: an unforced `install` reports
    // `already-installed` and leaves the old snapshot — and therefore the old
    // key — in place.
    outcome = await installService(resolution.bin, port, { force: credentialChanged })
  } catch (error) {
    return fail('installing-service', (error as Error).message)
  }

  progress('starting')
  await startServiceIfStopped(resolution.bin)

  progress('health')
  let healthy = await waitForHealth(resolution.bin, port, token, {
    onProgress: (detail) => progress('health', detail),
  })

  // One repair pass before giving up.
  if (!healthy) {
    // The gateway is down, so whatever the warm-path skip above assumed about
    // its providers no longer holds. A missing provider plugin is one of the
    // few things that stops a correctly configured gateway from coming up, and
    // installing it costs nothing when it is already there.
    await ensurePlugins()

    // A pre-existing service is left alone by `install`, so one installed
    // against a different port (or an older profile) never answers here.
    // Rewriting it is the only way out, and doing it lazily keeps the common
    // attach path free of an unnecessary reinstall on every launch.
    if (outcome === 'already-installed') {
      progress('installing-service', 'Updating the existing agent service…')
      try {
        await installService(bin, port, { force: true })
      } catch (error) {
        return fail('installing-service', (error as Error).message)
      }
    }

    progress('starting')
    await startServiceIfStopped(bin)
    progress('health')
    healthy = await waitForHealth(bin, port, token, {
      onProgress: (detail) => progress('health', detail),
    })
  }

  if (!healthy) {
    // "did not become ready in time" is the symptom, never the cause. The
    // LaunchAgent discards stderr, so the reason a gateway died on startup is
    // only in OpenClaw's own log — read it rather than sending the user to a
    // file that is empty precisely when it matters.
    const reason = await readStartupFailure()
    return fail(
      'health',
      reason ? `The local agent failed to start: ${reason}` : 'The local agent did not become ready in time',
      reason ? undefined : 'Open the runtime log to see why',
    )
  }

  return announceReady({
    state: 'ready',
    port,
    wsUrl: wsUrlFor(port),
    cliVersion: resolution.version,
    attached: false,
  })
}

/** Idempotent, and safe to call concurrently — callers share one attempt. */
export function ensure(): Promise<LocalRuntimeStatus> {
  if (status.state === 'ready') return Promise.resolve(status)
  if (inFlight) return inFlight
  inFlight = ensureInner()
    .catch((error: unknown) => fail('idle', (error as Error).message))
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export async function restart(): Promise<LocalRuntimeStatus> {
  if (!resolution) return ensure()
  progress('starting', 'Restarting the local agent…')
  try {
    await restartService(resolution.bin)
  } catch (error) {
    return fail('starting', (error as Error).message)
  }
  const config = await readRuntimeConfig()
  if (!config) return fail('starting', 'Runtime configuration is missing', undefined, false)

  progress('health')
  const healthy = await waitForHealth(resolution.bin, config.port, config.token, {
    onProgress: (detail) => progress('health', detail),
  })
  if (!healthy) return fail('health', 'The local agent did not come back', 'Open the runtime log')

  return announceReady({
    state: 'ready',
    port: config.port,
    wsUrl: wsUrlFor(config.port),
    cliVersion: resolution.version,
    attached: false,
  })
}

/**
 * Stops the managed service. Only reachable from an explicit Settings action —
 * quitting the app deliberately leaves the agent running so scheduled tasks and
 * channel messages keep working, exactly like the OpenClaw mac app.
 */
export async function stop(): Promise<void> {
  if (!resolution) return
  await stopService(resolution.bin)
  setStatus({ state: 'idle' })
}

/**
 * Whether a model is actually reachable.
 *
 * A gateway with no provider starts fine and then fails on the first message,
 * which reads as "the app is broken" rather than "you have not picked a model".
 * A local server (Ollama / LM Studio) counts without any key; a cloud provider
 * needs its key present in `.env`.
 */
export async function isProviderConfigured(): Promise<boolean> {
  // A build that ships its own provider can configure itself, so onboarding has
  // nothing to ask for. This is load-bearing on a fresh machine: the bundled
  // provider is seeded inside `ensure()`, but `ensure()` only runs once this
  // gate passes — reading only the on-disk config deadlocked the first run at
  // "Choose a model" with no config, no runtime, and no way forward.
  if (appProvider()) return true
  if (await hasConfiguredProviderOnDisk()) return true

  // A machine that already runs `openclaw` has answered everything onboarding
  // would ask, so there is nothing to stop for: `ensureInner` adopts that
  // provider into this profile on the same run that follows this check.
  return (await hostProvider()) !== null || (await bestLocalCredential()) !== null
}

/** Whether this app's own profile already carries a usable provider. */
async function hasConfiguredProviderOnDisk(): Promise<boolean> {
  const config = await readExistingConfig()
  if (!config) return false
  const env = await readEnvFile()

  const usable = (id: string): boolean => {
    if (id === 'ollama' || id === 'lmstudio') return true
    const value = env[envVarForProvider(id)]
    return typeof value === 'string' && value.length > 0
  }

  // The declared model is checked first because a built-in cloud provider
  // carries no overlay entry at all — `wireProvider` deletes the empty one it
  // would otherwise write. Reading only `models.providers` therefore reports a
  // fully configured Anthropic/OpenRouter profile as empty, and the app would
  // send the user back to onboarding on every launch.
  const agentDefaults = (config.agents as { defaults?: { model?: { primary?: unknown }; models?: Record<string, { agentRuntime?: { id?: unknown } }> } } | undefined)?.defaults
  const primary = agentDefaults?.model?.primary
  // Claude Code carries no key in `.env`: its own login is the credential.
  if (typeof primary === 'string' && agentDefaults?.models?.[primary]?.agentRuntime?.id === 'claude-cli') {
    const bin = await claudeCliLogin()
    if (bin) ensureClaudeOnPath(bin)
    return bin !== null
  }
  if (typeof primary === 'string') {
    const slash = primary.indexOf('/')
    if (slash > 0 && usable(primary.slice(0, slash))) return true
  }

  const models = config.models as { providers?: Record<string, unknown> } | undefined
  return Object.keys(models?.providers ?? {}).some(usable)
}

/**
 * Records a failed gateway handshake and repairs it where the machine can.
 *
 * Two things were wrong before this existed. The renderer's WebSocket failures
 * never reached `main.log` — the field report had to read
 * `/tmp/openclaw/openclaw-*.log` to find out that a connection was being closed
 * with `1008 pairing-required`, while the app's own log ended cleanly four
 * lines earlier and said nothing. And a device stuck in `pending` had no
 * surface in the app that could approve it, so onboarding simply span.
 *
 * Both are fixed here: every handshake failure is logged with its close code,
 * and a pairing failure additionally tries the one repair that is safe to do
 * unattended — approving *this machine's own* device request.
 */
export async function reportHandshakeFailure(
  failure: HandshakeFailureReport,
): Promise<HandshakeFailureOutcome> {
  const where = failure.code ? ` (close ${failure.code}${failure.reason ? `: ${failure.reason}` : ''})` : ''
  log.error(`[gateway-ws] handshake failed — ${failure.message}${where}`)

  if (failure.kind !== 'pairing-required') return { repaired: false }
  if (!resolution) return { repaired: false, detail: 'The local runtime is not resolved yet' }

  const config = await readRuntimeConfig()
  if (!config) return { repaired: false, detail: 'Runtime configuration is missing' }

  let outcome: PairingRepair
  try {
    outcome = await repairDevicePairing(resolution.bin, config.port, config.token)
  } catch (error) {
    const detail = (error as Error).message
    log.error('[pairing] repair threw:', detail)
    return { repaired: false, detail }
  }

  if (outcome.repaired) return { repaired: true }
  // `already-paired` means the gateway refused us for a reason pairing cannot
  // fix — say so rather than inviting an identical retry.
  if (outcome.reason === 'already-paired') {
    return { repaired: false, detail: 'This device is already approved — the gateway refused it for another reason' }
  }
  return { repaired: false, ...(outcome.detail ? { detail: outcome.detail } : {}) }
}

export async function credentials(): Promise<LocalRuntimeCredentials | null> {
  const config = await readRuntimeConfig()
  if (!config) return null
  return { port: config.port, token: config.token, wsUrl: wsUrlFor(config.port) }
}

/**
 * The log the user should actually be reading.
 *
 * `paths.gatewayLog` is the LaunchAgent's stdout. Its stderr goes to
 * `/dev/null`, so a gateway that dies during startup writes *nothing* there —
 * the one situation where someone opens the log is the one where it is empty.
 * OpenClaw's own log does record those failures, so prefer it whenever it has
 * content, and fall back to the service log otherwise.
 */
export async function resolveLogPath(): Promise<string> {
  const openclawLog = findLatestGatewayLog()
  if (!openclawLog) return paths.gatewayLog
  try {
    if ((await stat(openclawLog)).size > 0) return openclawLog
  } catch {
    /* fall through */
  }
  return paths.gatewayLog
}

export async function readLogs(maxLines = 400): Promise<RuntimeLogs> {
  const path = await resolveLogPath()
  try {
    const text = await readFile(path, 'utf8')
    const lines = text.split('\n').filter(Boolean)
    return { path, lines: lines.slice(-maxLines) }
  } catch {
    return { path, lines: [] }
  }
}
