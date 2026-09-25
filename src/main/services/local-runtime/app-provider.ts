import log from 'electron-log/main.js'
import type { ProviderChoice } from '@shared/ipc'

/**
 * The model provider this build of the app ships with.
 *
 * Local mode is BYOK by design, but a build can carry a provider so a fresh
 * install can chat immediately instead of stopping at an onboarding form. The
 * values come from the app's own env — `.env.local` in development, injected at
 * package time for a release — never from a literal in this file (a key in the
 * source is a key in every `.app` bundle and in git history).
 *
 * Precedence is `process.env` first so an operator can override a packaged
 * build without rebuilding it, then the `MAIN_VITE_*` values electron-vite
 * inlines at build time.
 */

/** `import.meta.env` is untyped in the main process; read it defensively. */
function buildTimeEnv(name: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.[name]
}

function read(runtimeName: string, buildName: string): string | undefined {
  const value = process.env[runtimeName] ?? buildTimeEnv(buildName)
  return value && value.length > 0 ? value : undefined
}

/**
 * Z.AI GLM — the same provider production runs.
 *
 * Deliberately minimal. `zai` is a **built-in** provider in OpenClaw
 * (`BUILT_IN_MODEL_PROVIDER_OVERLAY_IDS` in `config/zod-schema.core.ts`), so it
 * already ships the catalogue, the reasoning metadata, and endpoint probing —
 * `docs/providers/zai.md`: OpenClaw "probes supported Z.AI endpoints with your
 * API key and applies the correct base URL automatically". Declaring our own
 * `baseUrl`/`models` would replace all of that with a guess that goes stale the
 * day Z.AI ships a new model.
 *
 * The key is not passed through the config at all: OpenClaw maps this provider
 * to `ZAI_API_KEY` (`src/llm/env-api-keys.ts`) and reads it from the state
 * dotenv, which is exactly where `env-file.ts` puts it.
 *
 * `baseUrl` stays overridable for the regional/Coding-Plan endpoints the same
 * doc describes, but is unset by default so auto-detection wins.
 */
export function appProvider(): ProviderChoice | null {
  const apiKey = read('ZAI_API_KEY', 'MAIN_VITE_ZAI_API_KEY')
  if (!apiKey) return null

  const model = read('ZAI_MODEL', 'MAIN_VITE_ZAI_MODEL') ?? 'glm-5.2'
  const baseUrl = read('ZAI_BASE_URL', 'MAIN_VITE_ZAI_BASE_URL')

  return {
    id: 'zai',
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    // Model refs are `<provider>/<model>` — `docs/providers/zai.md` uses
    // `zai/glm-5.1` as its example.
    model: `zai/${model}`,
  }
}

/** Logs which bundled provider was found, without ever printing the key. */
export function logAppProvider(provider: ProviderChoice | null): void {
  if (!provider) {
    log.info('[local-runtime] no bundled provider in app env — BYOK onboarding applies')
    return
  }
  log.info(`[local-runtime] bundled provider: ${provider.id} (${provider.model})`)
}
