import type { ThinkingLevel } from '@/types'

export interface AIModel {
  id: string
  name: string
  provider: string
  description: string
  contextWindow: number
  supportsThinking: boolean
}

/**
 * Fallback catalogue only — the live list comes from the gateway via
 * `models.list`. Backend `sandbox-manager.js` is the real source of truth;
 * this exists so the picker has labels before the socket is up.
 */
export const AI_MODELS: AIModel[] = [
  {
    id: 'wrap/gpt-5.5',
    name: 'GPT-5.5',
    provider: 'Wrap',
    description: 'Primary model — best reasoning and tool use',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'wrap/gpt-5.3-codex-spark',
    name: 'GPT-5.3 Codex Spark',
    provider: 'Wrap',
    description: 'Fast fallback — lower latency, strong at code',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'amazon-bedrock/zai.glm-5',
    name: 'GLM-5 (Bedrock)',
    provider: 'Amazon Bedrock',
    description: 'Final fallback when upstream providers are unavailable',
    contextWindow: 200_000,
    supportsThinking: false,
  },
]

export const DEFAULT_MODEL = AI_MODELS[0]!.id

export const THINKING_LEVELS: { value: ThinkingLevel; label: string; tokens: string }[] = [
  { value: 'off', label: 'Off', tokens: '—' },
  { value: 'low', label: 'Low', tokens: '1k' },
  { value: 'medium', label: 'Medium', tokens: '5k' },
  { value: 'high', label: 'High', tokens: '10k' },
  { value: 'xhigh', label: 'Extra high', tokens: '20k' },
]
