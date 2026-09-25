import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlugSocketIcon, Search01Icon } from '@hugeicons/core-free-icons'
import { SkillCard } from '@/components/skills'
import { SectionLabel, Skeleton } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { EmptyState, TextField, useToast } from '@/components/patterns'
import { errorMessage, useDebounced, useSkills } from '@/hooks'

/** Skill marketplace: search, then Enabled/Available groups of `SkillCard`s. */
export default function SkillsScreen() {
  const navigate = useNavigate()
  const { skills, isLoading, toggleSkill } = useSkills()
  const { show } = useToast()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 150)

  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    if (!query) return skills
    return skills.filter(
      (skill) => skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
    )
  }, [skills, debouncedSearch])

  const enabled = useMemo(() => filtered.filter((skill) => skill.enabled), [filtered])
  const available = useMemo(() => filtered.filter((skill) => !skill.enabled), [filtered])

  async function handleToggle(skillKey: string) {
    try {
      await toggleSkill(skillKey)
      show({ title: 'Skill updated', description: 'The agent is restarting to apply the change.', variant: 'info' })
    } catch (error) {
      show({ title: 'Could not update skill', description: errorMessage(error), variant: 'error' })
    }
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-title-3 font-bold text-content-primary">Skills</h1>
          <p className="text-body-sm text-content-tertiary">Capabilities your agent can use — enable what you need.</p>
        </div>
        <div className="w-72">
          <TextField value={search} onChange={setSearch} placeholder="Search skills" icon={Search01Icon} />
        </div>
      </div>

      {isLoading && skills.length === 0 ? (
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[124px] rounded-box" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-[60vh] items-center justify-center">
          <EmptyState
            icon={<Icon icon={PlugSocketIcon} size={44} className="text-content-disabled" />}
            title={search ? 'No matches' : 'No skills available'}
            description={search ? 'Try a different search.' : 'Connect to the gateway to see available skills.'}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {enabled.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionLabel>Enabled · {enabled.length}</SectionLabel>
              <div className="grid grid-cols-3 gap-3">
                {enabled.map((skill) => (
                  <SkillCard
                    key={skill.skillKey}
                    skill={skill}
                    onToggle={() => void handleToggle(skill.skillKey)}
                    onOpen={() => navigate(`/skills/${encodeURIComponent(skill.skillKey)}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {available.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionLabel>Available · {available.length}</SectionLabel>
              <div className="grid grid-cols-3 gap-3">
                {available.map((skill) => (
                  <SkillCard
                    key={skill.skillKey}
                    skill={skill}
                    onToggle={() => void handleToggle(skill.skillKey)}
                    onOpen={() => navigate(`/skills/${encodeURIComponent(skill.skillKey)}`)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
