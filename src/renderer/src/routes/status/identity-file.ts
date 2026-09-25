/**
 * The rich fields of a workspace `IDENTITY.md`, read the way OpenClaw reads them.
 *
 * `agent.identity.get` resolves only name, emoji and avatar; Creature, Vibe and
 * Theme live in the file alone. This is a line-for-line port of OpenClaw's
 * `parseIdentityMarkdown` (`src/agents/identity-file.ts`) so the status panel
 * never disagrees with the agent about who it is, plus Muse's Tagline and
 * Description labels — including skipping the
 * template's own prompts, which would otherwise show up as the agent's vibe.
 */
export interface IdentityFields {
  name?: string
  emoji?: string
  theme?: string
  creature?: string
  vibe?: string
  avatar?: string
  /** Muse's identity also carries a tagline and description (mapGatewayIdentityToHatch). */
  tagline?: string
  description?: string
}

const PLACEHOLDERS = new Set([
  'pick something you like',
  'ai? robot? familiar? ghost in the machine? something weirder?',
  'how do you come across? sharp? warm? chaotic? calm?',
  'your signature - pick one that feels right',
  'workspace-relative path, http(s) url, or data uri',
])

const LABELS = new Set<keyof IdentityFields>(['name', 'emoji', 'theme', 'creature', 'vibe', 'avatar', 'tagline', 'description'])

function isPlaceholder(value: string): boolean {
  let normalized = value.trim().replace(/^[*_`\s]+|[*_`\s]+$/g, '').trim()
  if (normalized.startsWith('(') && normalized.endsWith(')')) normalized = normalized.slice(1, -1).trim()
  normalized = normalized.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase()
  return PLACEHOLDERS.has(normalized)
}

export function parseIdentityMarkdown(content: string): IdentityFields {
  const identity: IdentityFields = {}
  for (const line of content.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^\s*-\s*/, '')
    const colon = cleaned.indexOf(':')
    if (colon === -1) continue
    const label = cleaned.slice(0, colon).replace(/[*_`]/g, '').trim().toLowerCase() as keyof IdentityFields
    const value = cleaned.slice(colon + 1).replace(/^[*_`\s]+|[*_`\s]+$/g, '').trim()
    if (!value || isPlaceholder(value) || !LABELS.has(label)) continue
    identity[label] = value
  }
  return identity
}
