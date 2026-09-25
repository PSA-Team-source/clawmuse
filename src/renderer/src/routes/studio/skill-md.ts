/**
 * Client-side mirror of the server's `validateSkillMd`.
 *
 * The server is still the authority — this exists so a broken frontmatter is
 * caught while typing rather than after a round trip that returns a bare error
 * string. Keep the rules byte-compatible with
 * the gateway's skill loader, or the editor will cheerfully accept documents it
 * rejects.
 */

export interface SkillMdValidation {
  ok: boolean
  /** The `name:` declared in the frontmatter, when one parsed. */
  name?: string
  error?: string
}

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---/
const NAME_LINE = /^\s*name:\s*(.+?)\s*$/m
const DESCRIPTION_LINE = /^\s*description:\s*.+$/m

export function validateSkillMd(skillMd: string, expectedSlug?: string): SkillMdValidation {
  if (!skillMd.trim()) return { ok: false, error: 'SKILL.md is empty' }

  const frontmatter = FRONTMATTER.exec(skillMd)
  if (!frontmatter) {
    return { ok: false, error: 'Must start with a YAML frontmatter block (--- … ---)' }
  }

  const block = frontmatter[1]!
  const nameLine = NAME_LINE.exec(block)
  if (!nameLine) return { ok: false, error: 'Frontmatter must declare a `name:`' }

  const name = nameLine[1]!.trim().replace(/^["']|["']$/g, '')
  if (expectedSlug && name !== expectedSlug) {
    return { ok: false, error: `Frontmatter name "${name}" must equal the slug "${expectedSlug}"` }
  }

  if (!DESCRIPTION_LINE.test(block)) {
    return { ok: false, error: 'Frontmatter must declare a `description:`' }
  }

  return { ok: true, name }
}

/**
 * Rewrites the frontmatter `name:` to match the slug.
 *
 * Renaming is the single most common way to end up with a document the server
 * rejects, and the fix is mechanical — so it is applied on save instead of
 * being reported as an error the user has to go and correct by hand.
 */
export function syncFrontmatterName(skillMd: string, slug: string): string {
  const frontmatter = FRONTMATTER.exec(skillMd)
  if (!frontmatter) return skillMd

  const block = frontmatter[1]!
  if (!NAME_LINE.test(block)) return skillMd

  const fixed = block.replace(NAME_LINE, `name: ${slug}`)
  return skillMd.replace(block, fixed)
}

export const SLUG_PATTERN = /^[a-z0-9-]+$/

export interface SkillTemplate {
  id: string
  label: string
  build: (slug: string) => string
}

/**
 * Starting points, not examples. Each one is a working skill the moment it is
 * saved — the blank one included — because a template that needs edits before
 * it runs is just a comment.
 */
export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: 'blank',
    label: 'Blank',
    build: (slug) => `---
name: ${slug}
description: What this agent does, in one line.
---

# ${slug}

## When to use
Describe the situations this agent should handle.

## How to respond
Describe the steps it should take.
`,
  },
  {
    id: 'ecommerce',
    label: 'E-commerce',
    build: (slug) => `---
name: ${slug}
description: Handles store operations — products, orders and inventory.
---

# ${slug}

## When to use
The user asks about products, orders, stock levels or pricing.

## How to respond
1. Read the current state before changing anything.
2. Confirm any action that changes money or inventory before performing it.
3. Report what changed, with the identifiers the user can verify.

## Guardrails
- Never adjust price or stock without stating the previous value.
- Refuse bulk destructive operations without explicit confirmation.
`,
  },
  {
    id: 'support',
    label: 'Customer support',
    build: (slug) => `---
name: ${slug}
description: Answers customer questions and resolves common issues.
---

# ${slug}

## When to use
A customer question arrives on any channel.

## How to respond
1. Identify the customer and the order in question.
2. Answer from what the systems actually say — never guess an order status.
3. Escalate to a human when a refund or exception is involved.

## Tone
Direct and warm. No filler, no apology loops.
`,
  },
  {
    id: 'research',
    label: 'Research',
    build: (slug) => `---
name: ${slug}
description: Gathers and summarises information from the web and internal data.
---

# ${slug}

## When to use
The user needs facts assembled from more than one source.

## How to respond
1. State what is being looked up before looking it up.
2. Cite each source alongside the claim it supports.
3. Separate what was found from what was inferred.

## Guardrails
- Say so plainly when a source could not be reached.
- Never present an inference as a retrieved fact.
`,
  },
]
