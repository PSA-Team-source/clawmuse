import { z } from 'zod'
import type { AIModel } from '@/constants/models'
import { gatewayWS } from '@/services/gateway-ws.service'

/** The Gateway has shipped both camelCase and snake_case model metadata. */
const gatewayModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    provider: z.string().optional(),
    description: z.string().optional(),
    contextWindow: z.number().optional(),
    context_window: z.number().optional(),
    supportsThinking: z.boolean().optional(),
    supports_thinking: z.boolean().optional(),
  })
  .loose()

const gatewayModelsResponseSchema = z.object({ models: z.array(gatewayModelSchema).optional() }).loose()

/** Live, policy-filtered models. The static catalogue only covers startup/offline rendering. */
/**
 * The `provider/model` ref the gateway resolves. The model id alone is not
 * enough whenever it contains a slash: OpenRouter's `nvidia/nemotron-…` sent
 * bare resolves as provider `nvidia` ("Unknown model: nvidia/nvidia/…"), so
 * the provider prefix is added unless the id already carries it.
 */
export function qualifiedModelId(model: { id: string; provider?: string }): string {
  if (!model.provider || model.id.startsWith(`${model.provider}/`)) return model.id
  return `${model.provider}/${model.id}`
}

/**
 * OpenCode's free-tier models (`opencode/*-free`, `opencode-go/*-free`) refuse
 * every caller but OpenCode itself — HTTP 403 FreeTierError "OpenCode's free
 * tier can only be used from within OpenCode" (checked 2026-09-24). Listing
 * them would offer a choice that can only fail.
 */
export function isOpencodeFreeTier(model: { id: string; provider?: string }): boolean {
  return /^opencode(-go)?\/.+-free$/.test(qualifiedModelId(model))
}

export async function loadModels(): Promise<AIModel[]> {
  try {
    const parsed = gatewayModelsResponseSchema.safeParse(await gatewayWS.listModels())
    const list = parsed.success ? parsed.data.models : undefined
    if (!list || list.length === 0) return []

    return list.filter((model) => !isOpencodeFreeTier(model)).map((model) => ({
      id: qualifiedModelId(model),
      name: model.name ?? model.id,
      provider: model.provider ?? 'Unknown',
      description: model.description ?? '',
      contextWindow: model.contextWindow ?? model.context_window ?? 0,
      supportsThinking: model.supportsThinking ?? model.supports_thinking ?? false,
    }))
  } catch {
    return []
  }
}

export function readDefaultModel(config: unknown): string | undefined {
  const agents = (config as { agents?: unknown } | null)?.agents
  const defaults = (agents as { defaults?: unknown } | null)?.defaults
  const model = (defaults as { model?: unknown } | null)?.model
  if (typeof model === 'string' && model.length > 0) return model
  const primary = (model as { primary?: unknown } | null)?.primary
  return typeof primary === 'string' && primary.length > 0 ? primary : undefined
}
