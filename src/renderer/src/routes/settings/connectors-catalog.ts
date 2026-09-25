/**
 * The Connectors catalog: everything OpenClaw can plug into, as OpenClaw itself
 * reports it. Nothing here is a list of ours.
 *
 * - `plugins.list` — every installed plugin (bundled, ClawHub, global) plus the
 *   official ClawHub plugins that are not installed yet, with their real state.
 * - `plugins.catalog.browse` + `plugins.catalog.categories` — ClawHub's own
 *   taxonomy (Channels, Models, Voice, Web…), used only to file each plugin
 *   under a heading. When ClawHub is unreachable the plugins still list, filed
 *   by the categories their installed manifest carries, else under "Other".
 * - `skills.status` — the agent's skills, with exactly what each one is missing.
 *
 * Pure: the screen fetches, this shapes. Tested in `connectors-catalog.test.ts`.
 */

export interface PluginEntry {
  id: string
  name: string
  description?: string
  packageName?: string
  origin?: string
  installed: boolean
  enabled: boolean
  state: string
  removable?: boolean
  categories?: string[]
  channelIds?: string[]
  providerIds?: string[]
  install?: { source: string; pluginId?: string }
  runtime?: { state?: string; error?: string }
}

export interface DiscoveryItem {
  catalog: { name?: string; packageName?: string; categories?: string[] }
  local?: { pluginId?: string }
}

export interface DiscoveryCategory {
  slug: string
  label: string
  order?: number
}

interface SkillRequirements {
  bins?: string[]
  anyBins?: string[]
  env?: string[]
  config?: string[]
  os?: string[]
}

export interface SkillEntry {
  name: string
  skillKey: string
  description?: string
  emoji?: string
  homepage?: string
  disabled: boolean
  eligible: boolean
  blockedByAllowlist?: boolean
  platformIncompatible?: boolean
  missing?: SkillRequirements
  install?: { id: string; kind?: string; label?: string }[]
}

export type ConnectorTone = 'ready' | 'off' | 'attention'

export type ConnectorAction =
  | { type: 'toggle'; on: boolean }
  | { type: 'install'; label: string }
  | { type: 'none' }

export interface ConnectorItem {
  key: string
  kind: 'plugin' | 'skill'
  /** Plugin id (for `plugins.*`) or skill key (for `skills.*`). */
  id: string
  name: string
  description: string
  emoji?: string
  status: { label: string; tone: ConnectorTone; detail?: string }
  action: ConnectorAction
  /** `plugins.install` target, for an official plugin that is not installed. */
  installPluginId?: string
  /** `skills.install` params, for a skill whose missing binary OpenClaw can install. */
  skillInstall?: { name: string; installId: string; label: string }
  /** Env vars a skill needs that `skills.update` can store for it. */
  missingEnv?: string[]
  removable?: boolean
  homepage?: string
  /** An in-app screen that finishes setting this up. Only screens that really do. */
  setup?: { label: string; path: string }
  installed: boolean
  haystack: string
}

export interface ConnectorSection {
  id: string
  title: string
  items: ConnectorItem[]
}

export interface CatalogInput {
  plugins: PluginEntry[]
  skills: SkillEntry[]
  discovery?: { items: DiscoveryItem[]; categories: DiscoveryCategory[] }
  /** Channel ids the Messaging channels screen configures. */
  channelSettingIds: readonly string[]
  /** Provider ids the model provider setup screen configures. */
  providerSetupIds: readonly string[]
  /**
   * Plugins the gateway's `health` reports as enabled but unable to run
   * (`plugins.unavailable` / `plugins.errors`), by id → the reason it gives.
   * `plugins.list` alone reports these as plainly enabled.
   */
  unavailable?: Readonly<Record<string, string>>
}

/** `health.plugins` → the `unavailable` map above. */
export function unavailablePlugins(health: unknown): Record<string, string> {
  const plugins = (health as { plugins?: { unavailable?: unknown; errors?: unknown } } | null)?.plugins
  const out: Record<string, string> = {}
  for (const entry of [...(Array.isArray(plugins?.errors) ? plugins.errors : []), ...(Array.isArray(plugins?.unavailable) ? plugins.unavailable : [])]) {
    const record = entry as { id?: unknown; error?: unknown; message?: unknown; diagnostic?: { detail?: unknown; reason?: unknown } }
    if (typeof record?.id !== 'string') continue
    const reason = [record.diagnostic?.detail, record.error, record.message, record.diagnostic?.reason].find((value) => typeof value === 'string' && value)
    out[record.id] = typeof reason === 'string' ? reason : 'The gateway could not load it.'
  }
  return out
}

export const SKILLS_SECTION_ID = 'skills'

/**
 * A readable name for a plugin whose manifest `name` is just its id.
 *
 * Bundled provider manifests say `name: "openai"`, but their description names
 * the product properly — "OpenClaw OpenAI provider plugins". So: take the words
 * between "OpenClaw " and the first plugin-kind word.
 * ponytail: a wording heuristic over upstream manifests; the upgrade is a
 * `displayName` in OpenClaw's manifest, which would make this a passthrough.
 */
export function displayName(plugin: Pick<PluginEntry, 'id' | 'name' | 'description'>): string {
  if (plugin.name !== plugin.id || /[A-Z]/.test(plugin.name)) return plugin.name
  const fromDescription = /^OpenClaw\s+(.+?)(?:\s+(?:provider|plugins?|speech|video|media-understanding|tool)\b.*)?$/.exec(plugin.description ?? '')
  const words = fromDescription?.[1]?.trim()
  const base = words && words.toLowerCase() !== 'openclaw' ? words : plugin.id.replace(/[-_]+/g, ' ')
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** Skill slugs read as words: `apple-notes` → `Apple notes`. */
export function skillName(name: string): string {
  const spaced = name.replace(/[-_]+/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function titleFromSlug(slug: string): string {
  return skillName(slug)
}

/** What a skill still needs, in the words a person would act on — or null when nothing. */
export function skillNeeds(skill: SkillEntry): string | null {
  const missing = skill.missing ?? {}
  if (skill.platformIncompatible || (missing.os?.length ?? 0) > 0) {
    const os = (missing.os ?? []).map((name) => (name === 'darwin' ? 'macOS' : name === 'win32' ? 'Windows' : name === 'linux' ? 'Linux' : name))
    return os.length ? `${os.join(' or ')} only` : 'Not available on this computer'
  }
  const parts: string[] = []
  if (missing.bins?.length) parts.push(missing.bins.join(', '))
  if (missing.anyBins?.length) parts.push(missing.anyBins.join(' or '))
  if (missing.env?.length) parts.push(missing.env.join(', '))
  if (missing.config?.length) parts.push(missing.config.join(', '))
  return parts.length ? `Needs ${parts.join(' · ')}` : null
}

function skillItem(skill: SkillEntry): ConnectorItem {
  const needs = skillNeeds(skill)
  const missingBins = (skill.missing?.bins?.length ?? 0) + (skill.missing?.anyBins?.length ?? 0) > 0
  const missingEnv = skill.missing?.env ?? []
  const installOption = missingBins && !skill.platformIncompatible ? skill.install?.find((option) => option.id) : undefined
  const on = !skill.disabled
  const status: ConnectorItem['status'] = skill.blockedByAllowlist
    ? { label: 'Blocked by the skills allowlist', tone: 'attention' }
    : needs
      ? { label: needs, tone: 'attention' }
      : on
        ? { label: 'Ready', tone: 'ready' }
        : { label: 'Off', tone: 'off' }
  // A skill that cannot run is not offered a switch that would only pretend to
  // turn it on — but one already on keeps its switch, so it can be turned off.
  const canToggle = on || (!needs && !skill.blockedByAllowlist)
  const action: ConnectorAction = installOption
    ? { type: 'install', label: 'Install' }
    : canToggle
      ? { type: 'toggle', on }
      : { type: 'none' }
  const name = skillName(skill.name)
  return {
    key: `skill:${skill.skillKey}`,
    kind: 'skill',
    id: skill.skillKey,
    name,
    description: skill.description ?? '',
    ...(skill.emoji ? { emoji: skill.emoji } : {}),
    status,
    action,
    ...(installOption ? { skillInstall: { name: skill.name, installId: installOption.id, label: installOption.label ?? `Install ${skill.name}` } } : {}),
    ...(missingEnv.length && !missingBins && !skill.platformIncompatible ? { missingEnv } : {}),
    ...(skill.homepage ? { homepage: skill.homepage } : {}),
    installed: true,
    haystack: `${name} ${skill.name} ${skill.description ?? ''}`.toLowerCase(),
  }
}

function pluginItem(plugin: PluginEntry, input: CatalogInput): ConnectorItem {
  const name = displayName(plugin)
  const healthError = input.unavailable?.[plugin.id]
  const failed = plugin.runtime?.state === 'service-failed' || Boolean(plugin.runtime?.error) || Boolean(healthError)
  const detail = plugin.runtime?.error ?? healthError
  const status: ConnectorItem['status'] = !plugin.installed
    ? { label: 'Not installed', tone: 'off' }
    : !plugin.enabled
      ? { label: 'Off', tone: 'off' }
      : failed
        ? { label: 'Not working', tone: 'attention', ...(detail ? { detail } : {}) }
        : { label: 'On', tone: 'ready' }
  const installPluginId = !plugin.installed && plugin.install?.source === 'official' ? plugin.install.pluginId ?? plugin.id : undefined
  const action: ConnectorAction = plugin.installed
    ? { type: 'toggle', on: plugin.enabled }
    : installPluginId
      ? { type: 'install', label: 'Install' }
      : { type: 'none' }
  const setup = !plugin.installed
    ? undefined
    : [plugin.id, ...(plugin.channelIds ?? [])].some((id) => input.channelSettingIds.includes(id))
      ? { label: 'Set up in Messaging channels', path: '/settings/channels' }
      : // `plugins.list` carries no provider ids; a bundled provider plugin's id is its provider id.
        [plugin.id, ...(plugin.providerIds ?? [])].some((id) => input.providerSetupIds.includes(id))
        ? { label: 'Set up model provider', path: '/local-setup' }
        : undefined
  return {
    key: `plugin:${plugin.id}`,
    kind: 'plugin',
    id: plugin.id,
    name,
    description: plugin.description ?? '',
    status,
    action,
    ...(installPluginId ? { installPluginId } : {}),
    ...(plugin.installed && plugin.removable ? { removable: true } : {}),
    ...(setup ? { setup } : {}),
    installed: plugin.installed,
    haystack: `${name} ${plugin.id} ${plugin.packageName ?? ''} ${plugin.description ?? ''}`.toLowerCase(),
  }
}

/** On first, then off, then not installed; alphabetical inside each. */
function rank(item: ConnectorItem): number {
  if (!item.installed) return 2
  if (item.action.type === 'toggle' && item.action.on) return 0
  return item.status.tone === 'ready' ? 0 : 1
}

function byRank(a: ConnectorItem, b: ConnectorItem): number {
  return rank(a) - rank(b) || a.name.localeCompare(b.name)
}

export function buildCatalog(input: CatalogInput): ConnectorSection[] {
  const categoryByKey = new Map<string, string>()
  for (const item of input.discovery?.items ?? []) {
    const category = item.catalog.categories?.[0]
    if (!category) continue
    if (item.catalog.packageName) categoryByKey.set(`pkg:${item.catalog.packageName}`, category)
    if (item.local?.pluginId) categoryByKey.set(`id:${item.local.pluginId}`, category)
  }
  const labels = new Map((input.discovery?.categories ?? []).map((category) => [category.slug, category]))

  const grouped = new Map<string, ConnectorItem[]>()
  for (const plugin of input.plugins) {
    const category =
      plugin.categories?.[0] ??
      categoryByKey.get(`id:${plugin.id}`) ??
      (plugin.packageName ? categoryByKey.get(`pkg:${plugin.packageName}`) : undefined) ??
      'other'
    const list = grouped.get(category) ?? []
    list.push(pluginItem(plugin, input))
    grouped.set(category, list)
  }

  const pluginSections = [...grouped.entries()]
    .map(([slug, items]) => ({ id: slug, title: labels.get(slug)?.label ?? titleFromSlug(slug), order: labels.get(slug)?.order ?? Number.MAX_SAFE_INTEGER, items: items.sort(byRank) }))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    .map(({ id, title, items }) => ({ id, title, items }))

  const skills = input.skills.map(skillItem).sort(byRank)
  return [...(skills.length ? [{ id: SKILLS_SECTION_ID, title: 'Skills', items: skills }] : []), ...pluginSections]
}

export function filterCatalog(sections: ConnectorSection[], query: string): ConnectorSection[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return sections
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => item.haystack.includes(needle) || section.title.toLowerCase().includes(needle)) }))
    .filter((section) => section.items.length > 0)
}

/**
 * The review a plugin lifecycle call asks for before it proceeds.
 *
 * OpenClaw refuses to enable a plugin that widens what the agent can do until
 * the person has seen the new surface (`PLUGIN_CAPABILITY_CONSENT_REQUIRED`,
 * answered with `acknowledgeCapabilities: { reviewToken }`), and refuses an
 * install its scanner flagged until the warning is acknowledged
 * (`acknowledgeInstallPolicyWarning: true`). Both arrive as `error.details`.
 */
export type LifecycleReview =
  | { kind: 'capabilities'; reviewToken: string; widened: { group: string; items: string[] }[] }
  | { kind: 'install-policy'; reason: string; findings: { severity: string; message: string }[] }

export function readLifecycleReview(details: Record<string, unknown> | undefined): LifecycleReview | null {
  if (!details) return null
  if (details.capabilityConsentCode === 'PLUGIN_CAPABILITY_CONSENT_REQUIRED' && typeof details.reviewToken === 'string' && details.reviewToken) {
    const widened = details.widened && typeof details.widened === 'object' ? (details.widened as Record<string, unknown>) : {}
    return {
      kind: 'capabilities',
      reviewToken: details.reviewToken,
      widened: Object.entries(widened)
        .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((value) => typeof value === 'string') && entry[1].length > 0)
        .map(([group, items]) => ({ group, items })),
    }
  }
  if (details.installPolicyCode === 'install_policy_warning_acknowledgement_required' && typeof details.reason === 'string') {
    const findings = Array.isArray(details.findings) ? details.findings : []
    return {
      kind: 'install-policy',
      reason: details.reason,
      findings: findings
        .filter((finding): finding is { severity: string; message: string } => !!finding && typeof (finding as { message?: unknown }).message === 'string')
        .map(({ severity, message }) => ({ severity: String(severity), message })),
    }
  }
  return null
}

/** OpenClaw's surface-group keys, in words. */
export const SURFACE_GROUP_LABELS: Record<string, string> = {
  channels: 'Messaging channels',
  providers: 'Model providers',
  tools: 'Agent tools',
  contracts: 'Capabilities',
  hooks: 'Hooks',
  mcpServers: 'MCP servers',
  cliCommands: 'CLI commands',
  cliBackends: 'CLI backends',
  skills: 'Skills',
  dangerousConfigFlags: 'Dangerous settings',
}
