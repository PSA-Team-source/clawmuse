import { useEffect, useMemo, useState } from 'react'
import { Search01Icon } from '@hugeicons/core-free-icons'
import { TextField, useToast } from '@/components/patterns'
import { Dialog, Switch } from '@/components/primitives'
import { errorMessage, useDebounced } from '@/hooks'
import { useSkillsStore } from '@/stores/skills.store'
import { useRoomStore } from '@/stores/room.store'
import type { Skill } from '@/types'

interface AddAgentSheetProps {
  onClose: () => void
}

function SkillRow({
  skill,
  onPress,
  onToggle,
}: {
  skill: Skill
  onPress: () => void
  onToggle: () => void
}) {
  // Told, not blocked.
  //
  // Most OpenClaw skills lean on a third-party CLI (`op`, `memo`, `grizzly`),
  // and a machine that has none of them installed is the normal case — so
  // disabling every row with a missing binary left the sheet full of agents
  // and no way to add any of them. Adding one is harmless: the skill only
  // fails at the moment it reaches for the tool, and plenty of them do useful
  // work before that. The note stays so the failure is not a surprise.
  const missing = skill.missingBins

  return (
    <div className="flex w-full items-center gap-3 rounded-field px-2 py-3 transition-colors hover:bg-fill-raised">
      <button
        type="button"
        onClick={onPress}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
      >
        <span className="text-xl">{skill.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-content-primary">{skill.name}</p>
          {!!skill.description && (
            <p className="mt-0.5 line-clamp-2 text-caption text-content-muted">{skill.description}</p>
          )}
          {missing.length > 0 && (
            <p className="mt-0.5 text-caption text-warning">
              Needs {missing.join(', ')} — install it before this agent can use those tools
            </p>
          )}
        </div>
      </button>

      {/* Enabling here rather than in a separate screen: an agent you are about
          to put in the room is exactly the one you want switched on. */}
      <Switch
        checked={skill.enabled}
        onCheckedChange={onToggle}
        aria-label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`}
      />
    </div>
  )
}

/**
 * Add-agent picker. Mobile used `@gorhom/bottom-sheet` (a native RN sheet);
 * desktop has no such primitive, so this reuses the app's standard `Modal`
 * (Radix Dialog + glass chrome) rather than hand-rolling dialog markup.
 */
export function AddAgentSheet({ onClose }: AddAgentSheetProps) {
  const skills = useSkillsStore((s) => s.skills)
  const isLoading = useSkillsStore((s) => s.isLoading)
  const toggleSkill = useSkillsStore((s) => s.toggleSkill)
  const { show } = useToast()

  // Raw state, never `s.characters()`. That helper builds a fresh array on
  // every call, so using it as a selector hands `useSyncExternalStore` a new
  // snapshot each read — React sees the store mutating forever, throws #185,
  // and unmounts the whole tree. The symptom is the entire window going black
  // the moment this sheet opens, which reads as a rendering bug rather than a
  // selector one.
  const rooms = useRoomStore((s) => s.rooms)
  const activeRoomId = useRoomStore((s) => s.activeRoomId)
  const addCharacterToRoom = useRoomStore((s) => s.addCharacterToRoom)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 150)

  useEffect(() => {
    void useSkillsStore.getState().loadSkills()
  }, [])

  const available = useMemo(() => {
    const room = rooms.find((entry) => entry.id === activeRoomId) ?? rooms[0]
    const inRoom = new Set((room?.characterConfigs ?? []).map((config) => config.skillId))
    const query = debouncedSearch.trim().toLowerCase()

    return skills
      .filter((skill) => !inRoom.has(skill.skillKey))
      .filter((skill) => {
        if (!query) return true
        return (
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query) ||
          skill.skillKey.toLowerCase().includes(query)
        )
      })
  }, [skills, rooms, activeRoomId, debouncedSearch])

  function handlePick(skill: Skill) {
    addCharacterToRoom({
      skillId: skill.skillKey,
      skillName: skill.name,
      description: skill.description,
      appearanceSeed: 0,
      emoji: skill.emoji,
    })
    onClose()
  }

  function handleToggle(skill: Skill) {
    void toggleSkill(skill.skillKey).catch((error: unknown) =>
      show({
        title: `Could not ${skill.enabled ? 'disable' : 'enable'} ${skill.name}`,
        description: errorMessage(error),
        variant: 'error',
      }),
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Add Agent"
      description="Pick a skill to add as an agent in this room."
      className="flex max-h-[70vh] flex-col"
    >
      <div className="shrink-0 pb-2">
        <TextField
          value={search}
          onChange={setSearch}
          placeholder="Search agents"
          icon={Search01Icon}
        />
      </div>

      <div className="-mx-2 overflow-y-auto">
        {isLoading && (
          <div className="py-8 text-center">
            <p className="text-body text-content-muted">Loading agents…</p>
          </div>
        )}
        {!isLoading && available.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-body text-content-muted">
              {debouncedSearch.trim()
                ? 'No agents match that search.'
                : 'All agents are already in this room.'}
            </p>
          </div>
        )}
        {!isLoading &&
          available.map((skill) => (
            <SkillRow
              key={skill.skillKey}
              skill={skill}
              onPress={() => handlePick(skill)}
              onToggle={() => handleToggle(skill)}
            />
          ))}
      </div>
    </Dialog>
  )
}
