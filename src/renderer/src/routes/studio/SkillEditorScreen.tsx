import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FloppyDiskIcon, Tick02Icon, Alert02Icon } from '@hugeicons/core-free-icons'
import { Chip, GhostButton, GradientButton, SectionLabel, Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { BackLink, EmptyState, TextField, useToast } from '@/components/patterns'
import { Dialog, Switch } from '@/components/primitives'
import { errorMessage, useAdminSkill, useAgentStudioMutations } from '@/hooks/queries'
import type { AdminSkill } from '@/types'
import { SKILL_TEMPLATES, SLUG_PATTERN, syncFrontmatterName, validateSkillMd } from './skill-md'

/** Build modes an agent can advertise; `create-store` uses these for quick-start buttons. */
const KNOWN_MODES = ['quick', 'guided', 'expert'] as const

/** Audience tags the web studio offers. */
const USER_TYPES = ['founder', 'marketer', 'developer', 'operator'] as const

interface SkillFormProps {
  isNew: boolean
  initial: Partial<AdminSkill>
  onSaved: () => void
  onDirtyChange: (dirty: boolean) => void
}

function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/**
 * Initialized entirely from `initial` via useState initializers. The parent
 * only mounts this once the loaded skill (or "new") is ready, so there is no
 * effect syncing async data into local state — the classic footgun of
 * re-running on every refetch and clobbering in-progress edits.
 */
function SkillForm({ isNew, initial, onSaved, onDirtyChange }: SkillFormProps) {
  const { create, update } = useAgentStudioMutations()
  const toast = useToast()
  const [slug, setSlug] = useState(initial.slug ?? '')
  const [name, setName] = useState(initial.name ?? '')
  const [description, setDescription] = useState(initial.description ?? '')
  const [emoji, setEmoji] = useState(initial.emoji ?? '🤖')
  const [useCase, setUseCase] = useState(initial.use_case ?? '')
  const [color, setColor] = useState(initial.color ?? '#6366F1')
  const [priority, setPriority] = useState(String(initial.priority ?? 100))
  const [userTypes, setUserTypes] = useState<string[]>(initial.user_types ?? [])
  const [modes, setModes] = useState<string[]>(initial.modes ?? [])
  const [enabled, setEnabled] = useState(initial.enabled ?? true)
  const [skillMd, setSkillMd] = useState(initial.skill_md ?? '')
  const [slugError, setSlugError] = useState<string | null>(null)

  const saving = create.isPending || update.isPending
  const cleanSlug = slug.trim().toLowerCase()

  // Live, not on submit: the server rejects a malformed document with a bare
  // string, and finding out after a round trip is the slowest possible way to
  // learn you forgot a `description:`.
  const validation = useMemo(
    () => validateSkillMd(skillMd, cleanSlug || undefined),
    [skillMd, cleanSlug],
  )

  useEffect(() => {
    const dirty =
      slug !== (initial.slug ?? '') ||
      name !== (initial.name ?? '') ||
      description !== (initial.description ?? '') ||
      emoji !== (initial.emoji ?? '🤖') ||
      useCase !== (initial.use_case ?? '') ||
      color !== (initial.color ?? '#6366F1') ||
      priority !== String(initial.priority ?? 100) ||
      enabled !== (initial.enabled ?? true) ||
      userTypes.join() !== (initial.user_types ?? []).join() ||
      modes.join() !== (initial.modes ?? []).join() ||
      skillMd !== (initial.skill_md ?? '')
    onDirtyChange(dirty)
  }, [
    slug, name, description, emoji, useCase, color, priority, enabled,
    userTypes, modes, skillMd, initial, onDirtyChange,
  ])

  function payload() {
    return {
      slug: cleanSlug,
      name: name.trim() || undefined,
      description: description.trim() || undefined,
      emoji: emoji.trim() || undefined,
      use_case: useCase.trim() || undefined,
      color: color.trim() || undefined,
      priority: Number.isFinite(Number(priority)) ? Number(priority) : undefined,
      user_types: userTypes,
      modes,
      enabled,
      // Renaming is the usual way to produce a document the server rejects,
      // and the fix is mechanical — so apply it instead of reporting it.
      skill_md: syncFrontmatterName(skillMd, cleanSlug),
    }
  }

  async function handleSave() {
    if (isNew) {
      if (!SLUG_PATTERN.test(cleanSlug)) {
        setSlugError('Use lowercase letters, digits, and hyphens only.')
        return
      }
      setSlugError(null)
    }
    if (!validation.ok) {
      toast.show({ title: 'SKILL.md is not valid', description: validation.error, variant: 'error' })
      return
    }

    try {
      const body = payload()
      if (isNew) await create.mutateAsync(body)
      else await update.mutateAsync(body)

      toast.show({
        title: isNew ? 'Skill created' : 'Skill saved',
        // The write *is* the deploy: `skills.load.watch` picks the file up, so
        // there is no gap between "stored" and "live" to report.
        description: 'Live now — the agent reloaded it.',
        variant: 'success',
      })
      onDirtyChange(false)
      onSaved()
    } catch (err) {
      toast.show({ title: 'Save failed', description: errorMessage(err), variant: 'error' })
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <TextField
        label="Slug"
        value={slug}
        onChange={setSlug}
        placeholder="my-skill"
        disabled={!isNew}
        error={slugError}
      />
      <TextField label="Name" value={name} onChange={setName} placeholder="My Skill" />
      <TextField label="Description" value={description} onChange={setDescription} placeholder="Short description" />
      <TextField
        label="Use case"
        value={useCase}
        onChange={setUseCase}
        placeholder='Shown as "try: …" in the picker'
      />

      <div className="grid grid-cols-3 gap-3">
        <TextField label="Emoji" value={emoji} onChange={setEmoji} placeholder="🤖" />
        <div className="flex flex-col gap-1.5">
          <label className="text-footnote font-medium text-content-body" htmlFor="skill-color">
            Colour
          </label>
          <input
            id="skill-color"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-10 w-full cursor-pointer rounded-field border border-line bg-bg-surface p-1"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <TextField label="Priority" value={priority} onChange={setPriority} placeholder="100" />
          <span className="text-caption text-content-muted">Lower sorts first</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Audience</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {USER_TYPES.map((type) => (
            <Chip
              key={type}
              selected={userTypes.includes(type)}
              onClick={() => setUserTypes((current) => toggleIn(current, type))}
            >
              {type}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Build modes</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {KNOWN_MODES.map((mode) => (
            <Chip
              key={mode}
              selected={modes.includes(mode)}
              onClick={() => setModes((current) => toggleIn(current, mode))}
            >
              {mode}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-field border border-line px-3 py-2.5">
        <div>
          <p className="text-body-sm font-medium text-content-primary">Enabled</p>
          <p className="text-caption text-content-tertiary">Disabled skills stay stored but never load.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Skill enabled" />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-footnote font-medium text-content-body">SKILL.md</label>
          {!skillMd.trim() && (
            <div className="flex items-center gap-1">
              <span className="text-caption text-content-muted">Start from</span>
              {SKILL_TEMPLATES.map((template) => (
                <Chip
                  key={template.id}
                  onClick={() => setSkillMd(template.build(cleanSlug || 'my-skill'))}
                >
                  {template.label}
                </Chip>
              ))}
            </div>
          )}
        </div>

        <TextField
          value={skillMd}
          onChange={setSkillMd}
          placeholder={'---\nname: my-skill\ndescription: What it does\n---\n\nInstructions…'}
          multiline
          rows={22}
          className="font-mono text-body-sm [&_textarea]:[tab-size:2]"
        />

        {skillMd.trim() && (
          <div
            className={
              validation.ok
                ? 'flex items-center gap-1.5 text-caption text-success'
                : 'flex items-center gap-1.5 text-caption text-error'
            }
          >
            <Icon
              icon={validation.ok ? Tick02Icon : Alert02Icon}
              size={12}
              strokeWidth={2}
              className="shrink-0 text-current"
            />
            {validation.ok ? 'Frontmatter looks good' : validation.error}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <GradientButton
          onClick={() => void handleSave()}
          loading={saving}
          disabled={!validation.ok}
          size="lg"
          className="flex-1"
        >
          <Icon icon={FloppyDiskIcon} size={16} className="text-white" />
          {saving ? 'Saving…' : isNew ? 'Create skill' : 'Save changes'}
        </GradientButton>
      </div>
    </div>
  )
}

export default function SkillEditorScreen() {
  const navigate = useNavigate()
  const { slug: slugParam } = useParams<{ slug: string }>()
  const isNew = slugParam === 'new'
  const { data: existing, isLoading, isError, error } = useAdminSkill(isNew ? undefined : slugParam)

  const [dirty, setDirty] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  // Covers the window/tab close and reload paths; in-app navigation is
  // intercepted separately by the Back button below since `beforeunload`
  // cannot stop a React Router transition.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  function handleBack() {
    if (dirty) {
      setConfirmLeave(true)
      return
    }
    navigate('/agent-studio')
  }

  const ready = isNew || (!isLoading && Boolean(existing))

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <BackLink to="/agent-studio" label="Agent Studio" onClick={handleBack} />

        <h1 className="text-title-2 font-bold text-content-primary">
          {isNew ? 'New skill' : (existing?.name ?? slugParam)}
        </h1>

        {!isNew && isError ? (
          <EmptyState title="Could not load skill" description={errorMessage(error)} />
        ) : !ready ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <SkillForm
            key={isNew ? 'new' : (existing?.slug ?? slugParam)}
            isNew={isNew}
            initial={isNew ? {} : (existing ?? {})}
            onSaved={() => navigate('/agent-studio')}
            onDirtyChange={setDirty}
          />
        )}
      </div>

      <Dialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Discard changes?"
        description="You have unsaved changes. Leaving now will discard them."
      >
        <div className="flex gap-2.5">
          <GhostButton onClick={() => setConfirmLeave(false)} className="flex-1">
            Keep editing
          </GhostButton>
          <GradientButton
            onClick={() => {
              setConfirmLeave(false)
              navigate('/agent-studio')
            }}
            className="flex-1"
          >
            Discard
          </GradientButton>
        </div>
      </Dialog>
    </div>
  )
}
