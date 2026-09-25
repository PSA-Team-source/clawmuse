import { describe, expect, it } from 'vitest'
import {
  buildCatalog,
  displayName,
  filterCatalog,
  readLifecycleReview,
  skillNeeds,
  unavailablePlugins,
  type PluginEntry,
  type SkillEntry,
} from '@/routes/settings/connectors-catalog'

const plugin = (overrides: Partial<PluginEntry> & { id: string }): PluginEntry => ({
  name: overrides.id,
  installed: true,
  enabled: true,
  state: 'enabled',
  ...overrides,
})

const skill = (overrides: Partial<SkillEntry> & { name: string }): SkillEntry => ({
  skillKey: overrides.name,
  disabled: false,
  eligible: true,
  ...overrides,
})

const input = {
  channelSettingIds: ['telegram', 'discord'],
  providerSetupIds: ['openai', 'ollama'],
}

describe('connectors catalog', () => {
  it('names bundled plugins from their description when the manifest name is the id', () => {
    expect(displayName({ id: 'openai', name: 'openai', description: 'OpenClaw OpenAI provider plugins' })).toBe('OpenAI')
    expect(displayName({ id: 'elevenlabs', name: 'elevenlabs', description: 'OpenClaw ElevenLabs speech plugin' })).toBe('ElevenLabs')
    expect(displayName({ id: 'deepgram', name: 'deepgram', description: 'Deepgram audio transcription' })).toBe('Deepgram')
    expect(displayName({ id: 'session-share', name: 'session-share', description: 'Read-only sessions' })).toBe('Session share')
    expect(displayName({ id: 'telegram', name: 'Telegram', description: 'x' })).toBe('Telegram')
  })

  it('says exactly what a skill is missing', () => {
    expect(skillNeeds(skill({ name: '1password', disabled: true, eligible: false, missing: { bins: ['op'] } }))).toBe('Needs op')
    expect(skillNeeds(skill({ name: 'spotify', missing: { anyBins: ['spogo', 'spotify_player'] } }))).toBe('Needs spogo or spotify_player')
    expect(skillNeeds(skill({ name: 'trello', missing: { env: ['TRELLO_API_KEY', 'TRELLO_TOKEN'] } }))).toBe('Needs TRELLO_API_KEY, TRELLO_TOKEN')
    expect(skillNeeds(skill({ name: 'notes', platformIncompatible: true, missing: { os: ['darwin'] } }))).toBe('macOS only')
    expect(skillNeeds(skill({ name: 'weather' }))).toBeNull()
  })

  it('files plugins under ClawHub categories, falls back to Other, and ranks on > off > not installed', () => {
    const sections = buildCatalog({
      ...input,
      plugins: [
        plugin({ id: 'telegram', name: 'Telegram', enabled: false, state: 'disabled', categories: ['channels'], channelIds: ['telegram'] }),
        plugin({ id: '@openclaw/slack', name: 'Slack', packageName: '@openclaw/slack', installed: false, enabled: false, state: 'not-installed', install: { source: 'official', pluginId: '@openclaw/slack' } }),
        plugin({ id: 'openai', name: 'openai', description: 'OpenClaw OpenAI provider plugins', categories: ['models'] }),
        plugin({ id: 'mystery', name: 'Mystery', installed: false, enabled: false, state: 'not-installed' }),
        plugin({ id: 'a2a', name: 'A2A', runtime: { state: 'service-failed', error: 'boom' } }),
      ],
      skills: [
        skill({ name: '1password', disabled: true, eligible: false, missing: { bins: ['op'] }, install: [{ id: 'brew', label: 'Install 1Password CLI (brew)' }], homepage: 'https://1password.com' }),
        skill({ name: 'weather' }),
        skill({ name: 'trello', disabled: true, eligible: false, missing: { env: ['TRELLO_API_KEY'] } }),
      ],
      discovery: {
        items: [{ catalog: { packageName: '@openclaw/slack', categories: ['channels'] } }, { catalog: { categories: ['agent-orchestration'] }, local: { pluginId: 'a2a' } }],
        categories: [
          { slug: 'channels', label: 'Channels', order: 0 },
          { slug: 'models', label: 'Models', order: 1 },
          { slug: 'agent-orchestration', label: 'Agent orchestration', order: 19 },
        ],
      },
    })

    expect(sections.map((section) => section.title)).toEqual(['Skills', 'Channels', 'Models', 'Agent orchestration', 'Other'])
    const [skills, channels, models, orchestration, other] = sections

    expect(skills!.items.map((item) => [item.name, item.status.label, item.action.type])).toEqual([
      ['Weather', 'Ready', 'toggle'],
      ['1password', 'Needs op', 'install'],
      ['Trello', 'Needs TRELLO_API_KEY', 'none'],
    ])
    expect(skills!.items[1]).toMatchObject({ skillInstall: { name: '1password', installId: 'brew', label: 'Install 1Password CLI (brew)' }, homepage: 'https://1password.com' })
    expect(skills!.items[2]!.missingEnv).toEqual(['TRELLO_API_KEY'])

    expect(channels!.items.map((item) => [item.name, item.status.label])).toEqual([['Telegram', 'Off'], ['Slack', 'Not installed']])
    expect(channels!.items[0]!.setup?.path).toBe('/settings/channels')
    expect(channels!.items[1]).toMatchObject({ installPluginId: '@openclaw/slack', action: { type: 'install' } })
    expect(channels!.items[1]!.setup).toBeUndefined()

    expect(models!.items[0]).toMatchObject({ name: 'OpenAI', status: { label: 'On' }, setup: { path: '/local-setup' } })
    expect(orchestration!.items[0]!.status).toEqual({ label: 'Not working', tone: 'attention', detail: 'boom' })
    // Not official, not installed: listed honestly, with no button that could not work.
    expect(other!.items[0]).toMatchObject({ name: 'Mystery', action: { type: 'none' } })

    expect(filterCatalog(sections, 'slack').flatMap((section) => section.items.map((item) => item.name))).toEqual(['Slack'])
    expect(filterCatalog(sections, 'models').map((section) => section.title)).toEqual(['Models'])
  })

  it('marks a plugin the gateway health reports unavailable as not working, with its reason', () => {
    const unavailable = unavailablePlugins({ plugins: { errors: [], unavailable: [{ id: 'perplexity', state: 'configured-unavailable', diagnostic: { reason: 'missing-openclaw-peer-link', detail: 'peer link is missing' } }] } })
    expect(unavailable).toEqual({ perplexity: 'peer link is missing' })
    const [web] = buildCatalog({ ...input, unavailable, skills: [], plugins: [plugin({ id: 'perplexity', name: 'Perplexity', categories: ['web'] })] })
    expect(web!.items[0]!.status).toEqual({ label: 'Not working', tone: 'attention', detail: 'peer link is missing' })
    expect(unavailablePlugins(null)).toEqual({})
  })

  it('reads the reviews OpenClaw asks for before a plugin lifecycle change', () => {
    expect(readLifecycleReview({ capabilityConsentCode: 'PLUGIN_CAPABILITY_CONSENT_REQUIRED', pluginId: 'x', reviewToken: 't1', widened: { tools: ['browser'], hooks: [] } })).toEqual({
      kind: 'capabilities',
      reviewToken: 't1',
      widened: [{ group: 'tools', items: ['browser'] }],
    })
    expect(readLifecycleReview({ installPolicyCode: 'install_policy_warning_acknowledgement_required', reason: 'flagged', findings: [{ severity: 'warn', message: 'spawns a shell', ruleId: 'r' }] })).toEqual({
      kind: 'install-policy',
      reason: 'flagged',
      findings: [{ severity: 'warn', message: 'spawns a shell' }],
    })
    expect(readLifecycleReview({ code: 'OTHER' })).toBeNull()
    expect(readLifecycleReview(undefined)).toBeNull()
  })
})
