import log from 'electron-log/main.js'
import type { DetectedLocalProvider } from '@shared/ipc'

/**
 * Probes for model servers already running on this machine.
 *
 * The product requirement is "GUI for models/providers (local priority)", and
 * the cheapest way to honour it is to notice that the user already runs Ollama
 * or LM Studio and offer that first — no key, no account, nothing leaves the
 * machine. Cloud BYOK stays available as the second path.
 *
 * Probes are best-effort: a closed port is the normal case, not an error.
 */

const PROBE_TIMEOUT = 1500

const ENDPOINTS = {
  ollama: 'http://127.0.0.1:11434/api/tags',
  lmstudio: 'http://127.0.0.1:1234/v1/models',
} as const

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    return await response.json()
  } catch {
    // Connection refused / timeout: the server simply is not running.
    return null
  } finally {
    clearTimeout(timer)
  }
}

function ollamaModels(payload: unknown): string[] {
  const models = (payload as { models?: { name?: string }[] } | null)?.models
  if (!Array.isArray(models)) return []
  return models.map((m) => m.name).filter((n): n is string => typeof n === 'string')
}

function openAiModels(payload: unknown): string[] {
  const data = (payload as { data?: { id?: string }[] } | null)?.data
  if (!Array.isArray(data)) return []
  return data.map((m) => m.id).filter((id): id is string => typeof id === 'string')
}

export async function detectLocalProviders(): Promise<DetectedLocalProvider[]> {
  const [ollama, lmstudio] = await Promise.all([
    fetchJson(ENDPOINTS.ollama),
    fetchJson(ENDPOINTS.lmstudio),
  ])

  const found: DetectedLocalProvider[] = []
  const ollamaList = ollamaModels(ollama)
  if (ollamaList.length > 0) {
    found.push({ id: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: ollamaList })
  }
  const lmList = openAiModels(lmstudio)
  if (lmList.length > 0) {
    // LM Studio speaks the Responses API, which keeps reasoning separate from
    // final text — `docs/gateway/local-models.md` recommends it over
    // chat-completions when the backend supports it.
    found.push({ id: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', models: lmList })
  }

  if (found.length > 0) {
    log.info(`[local-runtime] detected local model servers: ${found.map((f) => f.id).join(', ')}`)
  }
  return found
}
