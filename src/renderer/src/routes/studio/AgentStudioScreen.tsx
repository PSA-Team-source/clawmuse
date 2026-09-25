import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Add01Icon, AiBrain01Icon, Delete02Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { GhostButton, GradientButton, IconButton, PillButton, Skeleton } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { EmptyState, useToast } from '@/components/patterns'
import {Dialog } from '@/components/primitives'
import { errorMessage, useAdminSkills, useAgentStudioMutations } from '@/hooks/queries'
import type { AdminSkill } from '@/types'

function SkillRow({
  skill,
  onEdit,
  onDelete,
}: {
  skill: AdminSkill
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-box border border-line-subtle bg-fill p-3.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-content-primary">
          {skill.emoji ? `${skill.emoji} ` : ''}
          {skill.name ?? skill.slug}
        </p>
        {skill.description && <p className="truncate text-footnote text-content-tertiary">{skill.description}</p>}
        <p className="font-mono text-micro text-content-disabled">{skill.slug}</p>
      </div>

      <div className="flex shrink-0 items-center gap-3.5">
        <IconButton
          icon={PencilEdit01Icon}
          label={`Edit ${skill.name ?? skill.slug}`}
          onClick={onEdit}
        />
        <IconButton
          icon={Delete02Icon}
          label={`Delete ${skill.name ?? skill.slug}`}
          onClick={onDelete}
          tone="danger"
        />
      </div>
    </div>
  )
}

export default function AgentStudioScreen() {
  const navigate = useNavigate()
  const toast = useToast()
  // No account, so no permission to check: a skill is a file in this machine's
  // workspace and the person at the keyboard owns it.
  const { data: skills, isLoading } = useAdminSkills(true)
  const { remove } = useAgentStudioMutations()
  const [pendingDelete, setPendingDelete] = useState<AdminSkill | null>(null)

  async function handleDelete() {
    if (!pendingDelete) return
    try {
      await remove.mutateAsync(pendingDelete.slug)
      toast.show({ title: 'Skill deleted', description: pendingDelete.name ?? pendingDelete.slug, variant: 'info' })
      setPendingDelete(null)
    } catch (err) {
      toast.show({ title: 'Could not delete skill', description: errorMessage(err), variant: 'error' })
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-title-2 font-bold text-content-primary">Agent Studio</h1>
          <PillButton variant="cta" onClick={() => navigate('/agent-studio/new')}>
            <Icon icon={Add01Icon} size={14} className="text-current" />
            New skill
          </PillButton>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : skills && skills.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {skills.map((skill) => (
              <SkillRow
                key={skill.slug}
                skill={skill}
                onEdit={() => navigate(`/agent-studio/${encodeURIComponent(skill.slug)}`)}
                onDelete={() => setPendingDelete(skill)}
              />
            ))}
          </div>
        ) : (
          <div className="py-10">
            <EmptyState
              icon={<Icon icon={AiBrain01Icon} size={40} className="text-content-disabled" />}
              title="No skills yet"
              // Naming where the file lands turns an abstract "skill" into
              // something the user can go and look at.
              description="A skill is a SKILL.md in your workspace under skills/. Write one here and the agent picks it up immediately — no restart."
              action={
                <GradientButton onClick={() => navigate('/agent-studio/new')}>
                  <Icon icon={Add01Icon} size={16} className="text-white" />
                  New skill
                </GradientButton>
              }
            />
          </div>
        )}
      </div>

      <Dialog
        open={pendingDelete != null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete skill"
        description={pendingDelete ? `Delete "${pendingDelete.name ?? pendingDelete.slug}"? This cannot be undone.` : undefined}
      >
        <div className="flex gap-2.5">
          <GhostButton onClick={() => setPendingDelete(null)} className="flex-1">
            Cancel
          </GhostButton>
          <GradientButton onClick={() => void handleDelete()} loading={remove.isPending} className="flex-1">
            Delete
          </GradientButton>
        </div>
      </Dialog>
    </div>
  )
}
