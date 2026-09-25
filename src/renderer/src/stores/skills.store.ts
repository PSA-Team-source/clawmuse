import { create } from 'zustand'
import { gatewayWS } from '@/services/gateway-ws.service'
import type { Skill } from '@/types'

interface SkillsState {
  skills: Skill[]
  isLoading: boolean
  loadSkills: () => Promise<void>
  toggleSkill: (skillKey: string) => Promise<void>
}

/**
 * Tolerant parser for `skills.status`: the gateway returns either an array or
 * a keyed map, at the root or under `.skills`, and spells "enabled" as the
 * inverse field `disabled`. Exported for unit testing.
 */
export function parseSkills(result: unknown): Skill[] {
  const source =
    Array.isArray(result)
      ? result
      : typeof result === 'object' && result !== null
        ? ((result as { skills?: unknown }).skills ?? result)
        : []

  const entries: Record<string, unknown>[] = Array.isArray(source)
    ? (source as Record<string, unknown>[])
    : Object.entries(source as Record<string, unknown>).map(([key, value]) => ({
        skillKey: key,
        ...(typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}),
      }))

  return entries
    .filter((entry) => typeof entry === 'object' && entry !== null)
    .map((entry) => {
      const skillKey = String(entry.skillKey ?? entry.slug ?? entry.name ?? entry.id ?? '')
      const missing = (entry.missing as { bins?: unknown })?.bins
      return {
        skillKey,
        name: String(entry.name ?? skillKey),
        description: String(entry.description ?? ''),
        emoji: typeof entry.emoji === 'string' ? entry.emoji : '🧩',
        homepage: typeof entry.homepage === 'string' ? entry.homepage : undefined,
        enabled: entry.disabled === true ? false : entry.enabled !== false,
        eligible: entry.eligible !== false,
        bundled: entry.bundled === true,
        source: typeof entry.source === 'string' ? entry.source : undefined,
        missingBins: Array.isArray(missing) ? missing.map(String) : [],
      } satisfies Skill
    })
    .filter((skill) => skill.skillKey.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  isLoading: false,

  async loadSkills() {
    set({ isLoading: true })
    try {
      // The gateway is the only source there is, and it is authoritative:
      // `skills.status` reports what is actually installed, not a catalogue of
      // what might be.
      set({ skills: parseSkills(await gatewayWS.getSkillsStatus()) })
    } catch {
      /* the gateway is not up yet — the screen shows its empty state */
    } finally {
      set({ isLoading: false })
    }
  },

  async toggleSkill(skillKey) {
    const current = get().skills.find((skill) => skill.skillKey === skillKey)
    if (!current) return
    const next = !current.enabled

    set((state) => ({
      skills: state.skills.map((skill) => (skill.skillKey === skillKey ? { ...skill, enabled: next } : skill)),
    }))

    try {
      await gatewayWS.setSkillEnabled(skillKey, next)
    } catch (error) {
      set((state) => ({
        skills: state.skills.map((skill) =>
          skill.skillKey === skillKey ? { ...skill, enabled: current.enabled } : skill,
        ),
      }))
      throw error
    }

    // `skills.update` answers before the gateway's config snapshot reloads (about
    // a second), so an immediate `skills.status` still reports the old value.
    // Re-read once it has settled so the UI reflects what the agent will use.
    setTimeout(() => void get().loadSkills(), 3000)
  },
}))
