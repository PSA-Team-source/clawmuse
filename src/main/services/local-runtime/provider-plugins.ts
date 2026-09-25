import log from 'electron-log/main.js'
import { firstMeaningfulLine, run, runJson } from './exec.js'
import { PROFILE, openclawEnv } from './paths.js'

/**
 * Puts a provider's plugin on disk *before* the gateway needs it.
 *
 * Since OpenClaw 2026.7 most cloud providers are no longer compiled into the
 * runtime. `dist/extensions/` ships anthropic, openai, openrouter, google,
 * ollama and lmstudio; `zai`, `groq` and `deepseek` are **not** there — they
 * live in the official external catalogue as `@openclaw/<id>-provider` and the
 * gateway npm-installs them into `<stateDir>/npm/projects/` the first time it
 * boots with that provider configured.
 *
 * That install is where first run died. From the field report:
 *
 *     10:52:00  gateway install → installed
 *     10:53:01  health: "The local agent did not become ready in time"  ← app gave up
 *     10:57:11  npm finished @openclaw/zai-provider
 *     10:57:14  gateway ready                                          ← 4 minutes late
 *
 * A developer machine never sees it: the npm cache is already warm. Every new
 * user on a cold cache does.
 *
 * Doing the install here moves those minutes into "Installing the local agent",
 * a step that already streams real progress and budgets ten minutes for exactly
 * this kind of download — instead of into a health probe that is only supposed
 * to be measuring whether a process came up.
 *
 * Which plugins are needed is asked of the runtime rather than hard-coded:
 * `plugins list --json` reports the provider ids every installed plugin serves,
 * so a provider that becomes stock (or stops being) needs no change here.
 */

function argv(args: string[]): string[] {
  return ['--profile', PROFILE, ...args]
}

interface PluginEntry {
  id?: string
  providerIds?: string[]
}

/** Provider ids already served by an installed plugin, stock or external. */
async function coveredProviderIds(bin: string): Promise<Set<string> | null> {
  const result = await runJson<{ plugins?: PluginEntry[] }>(
    bin,
    argv(['plugins', 'list', '--json']),
    { env: openclawEnv(), timeoutMs: 90_000 },
  )
  if (!result.ok) {
    log.warn('[provider-plugins] could not list plugins:', result.error)
    return null
  }
  const covered = new Set<string>()
  for (const plugin of result.data.plugins ?? []) {
    for (const id of plugin.providerIds ?? []) covered.add(id.toLowerCase())
  }
  return covered
}

/**
 * Every entry in the official catalogue follows `@openclaw/<id>-provider`, so
 * the spec is derivable from the provider id. A wrong guess costs one failed
 * install that is logged and ignored — never a failed launch.
 */
function npmSpecFor(providerId: string): string {
  return `@openclaw/${providerId}-provider`
}

export interface PluginInstallProgress {
  (line: string): void
}

/**
 * Installs the plugins for `providerIds` that nothing on this machine serves.
 *
 * Best-effort by design. A provider whose plugin will not install is a provider
 * the user cannot chat with — but it must not stop the gateway from starting,
 * because every other part of the app still works and the error belongs on the
 * model screen, not on a boot screen the user cannot get past.
 */
export async function ensureProviderPlugins(
  bin: string,
  providerIds: readonly string[],
  onProgress?: PluginInstallProgress,
): Promise<void> {
  const wanted = [...new Set(providerIds.map((id) => id.toLowerCase()))].filter(Boolean)
  if (wanted.length === 0) return

  const covered = await coveredProviderIds(bin)
  // Unreadable plugin list: skip rather than reinstall blindly. The gateway
  // still installs what it needs on its own — slowly, which is the bug this
  // avoids, not one it creates.
  if (!covered) return

  const missing = wanted.filter((id) => !covered.has(id))
  if (missing.length === 0) return

  for (const providerId of missing) {
    const spec = npmSpecFor(providerId)
    onProgress?.(`Installing the ${providerId} provider…`)
    const result = await run(bin, argv(['plugins', 'install', spec]), {
      env: openclawEnv(),
      // Same budget as the runtime install itself: this is an npm download on
      // a network we know nothing about.
      timeoutMs: 600_000,
      onLine: (line) => onProgress?.(line),
    })
    if (result.code === 0) {
      log.info(`[provider-plugins] installed ${spec}`)
      continue
    }
    const reason = result.timedOut ? 'timed out' : firstMeaningfulLine(result.stderr) || `exit ${result.code}`
    log.warn(`[provider-plugins] ${spec} did not install — ${reason}`)
  }
}

/** Cloud provider ids declared in a config document. Local servers need no plugin fetch. */
export function configuredCloudProviderIds(config: Record<string, unknown> | null): string[] {
  const providers = (config?.models as { providers?: Record<string, unknown> } | undefined)?.providers
  return Object.keys(providers ?? {}).filter((id) => id !== 'ollama' && id !== 'lmstudio')
}
