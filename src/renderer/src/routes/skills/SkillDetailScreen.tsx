import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert02Icon, ArrowRight01Icon, BubbleChatIcon } from '@hugeicons/core-free-icons'
import { Badge, GhostButton, GradientButton } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { BackLink, EmptyState, useToast } from '@/components/patterns'
import { Switch } from '@/components/primitives'
import { errorMessage, useSkills } from '@/hooks'
import { useChatStore } from '@/stores/chat.store'

export default function SkillDetailScreen() {
  const { skillKey } = useParams<{ skillKey: string }>()
  const navigate = useNavigate()
  const { skills, toggleSkill } = useSkills()
  const createSession = useChatStore((state) => state.createSession)
  const { show } = useToast()
  const [isToggling, setIsToggling] = useState(false)

  const skill = skills.find((s) => s.skillKey === skillKey)

  if (!skill) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Skill not found"
          description="This skill may have been removed."
          action={<GhostButton onClick={() => navigate('/skills')}>Back to skills</GhostButton>}
        />
      </div>
    )
  }

  // Re-bind so every closure below (and the `homepage &&` guard) sees the
  // narrowed, non-null type without repeated `!` assertions.
  const currentSkill = skill
  const homepage = currentSkill.homepage
  const needsSetup = currentSkill.missingBins.length > 0

  async function handleToggle() {
    setIsToggling(true)
    try {
      await toggleSkill(currentSkill.skillKey)
      show({ title: 'Skill updated', description: 'The agent is restarting to apply the change.', variant: 'info' })
    } catch (error) {
      show({ title: 'Could not update skill', description: errorMessage(error), variant: 'error' })
    } finally {
      setIsToggling(false)
    }
  }

  function handleChat() {
    const id = createSession({ skillId: currentSkill.skillKey })
    navigate(`/chat/${encodeURIComponent(id)}`)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
        <BackLink to="/skills" label="Skills" />

        <div className="flex items-center gap-4 rounded-box border border-line bg-fill p-5">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-box border border-primary/25 bg-fill-accent text-emoji-lg leading-none">
            {currentSkill.emoji}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h1 className="truncate text-title-3 font-bold text-content-primary">{currentSkill.name}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={currentSkill.enabled ? 'success' : 'neutral'}>
                {currentSkill.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              {currentSkill.bundled && <Badge variant="info">Bundled</Badge>}
            </div>
          </div>
        </div>

        {currentSkill.description && (
          <div className="flex flex-col gap-2">
            <p className="text-caption font-semibold uppercase tracking-label text-content-muted">About</p>
            <p className="text-body leading-6 text-content-secondary">{currentSkill.description}</p>
          </div>
        )}

        {needsSetup && (
          <div className="flex flex-col gap-2 rounded-box border border-warning-border bg-warning-bg p-4">
            <div className="flex items-center gap-2">
              <Icon icon={Alert02Icon} size={16} className="text-warning" />
              <p className="text-body-sm font-semibold text-content-primary">Requires setup</p>
            </div>
            <p className="text-body-sm text-content-tertiary">
              This skill needs the following installed in the sandbox before it can run:
            </p>
            <div className="flex flex-wrap gap-2">
              {currentSkill.missingBins.map((bin) => (
                <span
                  key={bin}
                  className="rounded-box border border-line-strong bg-fill-raised px-2.5 py-1 font-mono text-caption text-content-secondary"
                >
                  {bin}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between rounded-box border border-line-subtle bg-fill p-4">
          <div>
            <p className="text-body font-semibold text-content-primary">
              {currentSkill.enabled ? 'Skill enabled' : 'Skill disabled'}
            </p>
            <p className="text-caption text-content-tertiary">
              {currentSkill.enabled ? 'Your agent can use this skill.' : 'Enable to let your agent use it.'}
            </p>
          </div>
          <Switch
            checked={currentSkill.enabled}
            onCheckedChange={() => void handleToggle()}
            disabled={isToggling}
            aria-label={currentSkill.enabled ? 'Disable this skill' : 'Enable this skill'}
          />
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <GradientButton onClick={handleChat} className="flex-1">
            <Icon icon={BubbleChatIcon} size={16} className="text-current" />
            Chat with this agent
          </GradientButton>
          {homepage && (
            <GhostButton onClick={() => void window.clawmuse.shell.openExternal(homepage)}>
              View documentation
              <Icon icon={ArrowRight01Icon} size={15} className="text-current" />
            </GhostButton>
          )}
        </div>
      </div>
    </div>
  )
}
