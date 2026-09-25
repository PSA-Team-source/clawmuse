import { describe, expect, it } from 'vitest'
import { filterModels } from '@/components/chat/ChatModelPicker'
import type { AIModel } from '@/constants/models'

const model = (id: string, name: string, provider = 'openrouter'): AIModel => ({ id, name, provider, description: '', contextWindow: 0, supportsThinking: false })
const catalog = [model('openrouter/anthropic/claude-sonnet-4', 'Claude Sonnet 4'), model('openrouter/openai/gpt-5', 'GPT-5'), model('ollama/llama3', 'Llama 3', 'ollama')]

describe('model picker search', () => {
  it('keeps Auto and every model when the query is empty', () => {
    expect(filterModels(catalog, '')).toEqual({ autoVisible: true, models: catalog })
  })
  it('ranks by name, id and provider and hides Auto unless it matches', () => {
    expect(filterModels(catalog, 'sonnet')).toEqual({ autoVisible: false, models: [catalog[0]] })
    expect(filterModels(catalog, 'ollama').models).toEqual([catalog[2]])
    expect(filterModels(catalog, 'au').autoVisible).toBe(true)
    expect(filterModels(catalog, 'zzz')).toEqual({ autoVisible: false, models: [] })
    // Multi-word: every word has to match somewhere.
    expect(filterModels(catalog, 'claude sonnet 4').models).toEqual([catalog[0]])
    expect(filterModels(catalog, 'openrouter gpt').models).toEqual([catalog[1]])
    expect(filterModels(catalog, 'claude llama').models).toEqual([])
  })
})

describe('OpenCode free tier', () => {
  it('is left out of the catalogue: OpenCode refuses it outside its own app', async () => {
    const { isOpencodeFreeTier } = await import('@/services/model-catalog')
    expect(isOpencodeFreeTier({ id: 'muse-spark-1.3-contributor-free', provider: 'opencode' })).toBe(true)
    expect(isOpencodeFreeTier({ id: 'opencode-go/space-bunny-free' })).toBe(true)
    expect(isOpencodeFreeTier({ id: 'muse-spark-1.3', provider: 'opencode' })).toBe(false)
    expect(isOpencodeFreeTier({ id: 'openrouter/meta-llama/llama-3-free' })).toBe(false)
  })
})

describe('qualifiedModelId', () => {
  it('prefixes the provider unless the id already starts with it', async () => {
    const { qualifiedModelId } = await import('@/services/model-catalog')
    expect(qualifiedModelId({ id: 'nvidia/nemotron-3-ultra-550b-a55b:free', provider: 'openrouter' })).toBe('openrouter/nvidia/nemotron-3-ultra-550b-a55b:free')
    expect(qualifiedModelId({ id: 'muse-spark-1.3', provider: 'opencode' })).toBe('opencode/muse-spark-1.3')
    expect(qualifiedModelId({ id: 'openrouter/auto', provider: 'openrouter' })).toBe('openrouter/auto')
  })
})
