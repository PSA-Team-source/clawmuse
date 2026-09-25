import type { AdminSkill } from '@/types'
import { validateSkillMd } from '@/routes/studio/skill-md'

/**
 * Skill authoring for local mode.
 *
 * The cloud path writes a `shared_skills` row and the server symlinks it into
 * every running container. None of that exists on a laptop — there is no
 * database and no container — so a skill here is what OpenClaw already means by
 * one: a directory under the workspace holding a `SKILL.md`.
 *
 *     ~/.openclaw-clawmuse/workspace/skills/<slug>/SKILL.md
 *
 * That is the documented layout (`<workspace>/skills/<name>/SKILL.md`), and the
 * generated config sets `skills.load.watch`, so writing the file *is* the
 * deployment — the gateway reloads it on its own. No restart, no API call, and
 * in particular no request that leaves this machine, which this app must never make.
 *
 * Every path here is relative and goes through the main process's root
 * allowlist, which re-resolves and `realpath`s before touching disk.
 */

const ROOT = 'workspace'
const SKILLS_DIR = 'skills'

const fs = () => window.clawmuse.fs

function skillDir(slug: string): string {
  return `${SKILLS_DIR}/${slug}`
}

function skillFile(slug: string): string {
  return `${skillDir(slug)}/SKILL.md`
}

/** Pulls `description:` out of the frontmatter for the list view. */
function descriptionOf(skillMd: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/.exec(skillMd)
  if (!frontmatter) return ''
  const line = /^\s*description:\s*(.+?)\s*$/m.exec(frontmatter[1]!)
  return line?.[1]?.replace(/^["']|["']$/g, '') ?? ''
}

export async function listLocalSkills(): Promise<AdminSkill[]> {
  let entries
  try {
    entries = await fs().list(ROOT, SKILLS_DIR)
  } catch {
    // No `skills/` yet simply means none have been authored.
    return []
  }

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory)
      .map(async (entry): Promise<AdminSkill | null> => {
        try {
          const file = await fs().read(ROOT, `${entry.path}/SKILL.md`)
          if (file.binary || file.tooLarge) return null
          return {
            slug: entry.name,
            name: entry.name,
            description: descriptionOf(file.content),
            skill_md: file.content,
            enabled: true,
          }
        } catch {
          // A directory with no SKILL.md is not a skill.
          return null
        }
      }),
  )

  return skills.filter((skill): skill is AdminSkill => skill !== null)
}

export async function getLocalSkill(slug: string): Promise<AdminSkill | null> {
  try {
    const file = await fs().read(ROOT, skillFile(slug))
    return {
      slug,
      name: slug,
      description: descriptionOf(file.content),
      skill_md: file.content,
      enabled: true,
    }
  } catch {
    return null
  }
}

/**
 * Writes the skill to disk. Validates first for the same reason the server
 * does: a `SKILL.md` whose frontmatter name disagrees with its directory loads
 * under the wrong name, or not at all.
 */
export async function saveLocalSkill(slug: string, skillMd: string): Promise<void> {
  const validation = validateSkillMd(skillMd, slug)
  if (!validation.ok) throw new Error(validation.error)

  await fs().mkdir(ROOT, skillDir(slug))
  await fs().write(ROOT, skillFile(slug), skillMd)
}

export async function removeLocalSkill(slug: string): Promise<void> {
  await fs().delete(ROOT, skillDir(slug))
}
