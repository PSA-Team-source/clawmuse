import type { KeyboardEvent } from 'react'
import type { Skill } from '@/types'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/brand'
import { Switch } from '@/components/primitives'

interface SkillCardProps {
  skill: Skill
  onToggle: (enabled: boolean) => void
  onOpen: () => void
  className?: string
}

/**
 * Grid tile for a skill: emoji, name, description, enable switch, and a
 * needs-setup hint. The card itself opens the detail screen; the switch is a
 * separate interactive control (stops propagation so it doesn't also navigate).
 */
export function SkillCard({ skill, onToggle, onOpen, className }: SkillCardProps) {
  const needsSetup = skill.missingBins.length > 0

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex min-h-[120px] flex-1 cursor-pointer flex-col gap-1 rounded-box border border-line bg-fill-subtle p-3.5 text-left transition-colors hover:border-line-strong hover:bg-fill-raised',
        className,
      )}
    >
      <div className="mb-0.5 flex items-start justify-between gap-2">
        <span className="text-emoji leading-none">{skill.emoji}</span>
        <div onClick={(e) => e.stopPropagation()}>
          {/*
            Never disabled on account of a missing binary. Turning a skill *off*
            has to work regardless — and locking the switch produced the worst
            possible reading: a greyed-out control next to a green "Enabled"
            badge, with nothing on the card explaining why.
          */}
          <Switch
            checked={skill.enabled}
            onCheckedChange={onToggle}
            aria-label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`}
          />
        </div>
      </div>
      <span className="truncate text-body-sm font-semibold text-content-primary">{skill.name}</span>
      <p className="line-clamp-2 text-micro text-content-muted">{skill.description}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
        {skill.enabled ? (
          <Badge variant="success">Enabled</Badge>
        ) : (
          <Badge variant="neutral">Disabled</Badge>
        )}
        {/*
          Shown whether or not the skill is on: an enabled skill with a missing
          CLI is exactly the case worth warning about, and the old markup only
          mentioned setup when the skill was already off.
        */}
        {needsSetup && (
          <span className="text-micro text-warning">Needs {skill.missingBins.join(', ')}</span>
        )}
      </div>
    </div>
  )
}
