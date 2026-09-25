import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GhostButton, GradientButton, Spinner } from '@/components/brand'
import { useToast } from '@/components/patterns'
import { SegmentedControl } from '@/components/primitives'
import { errorMessage } from '@/hooks'
import { gatewayWS } from '@/services/gateway-ws.service'

/**
 * The three files that define an agent.
 *
 * `SOUL.md` is personality, `IDENTITY.md` is who it is to the user, `SKILL.md`
 * is what it can do. Editing them here — rather than only in Agent Studio —
 * is what makes an agent feel tunable while you talk to it.
 */
const AGENT_FILES = [
  { name: 'SOUL.md', hint: 'Personality and voice' },
  { name: 'IDENTITY.md', hint: 'Who this agent is to the user' },
  { name: 'SKILL.md', hint: 'Capabilities and instructions' },
] as const

type FileName = (typeof AGENT_FILES)[number]['name']

interface AgentFilesPanelProps {
  /**
   * The *skill* whose thread this panel sits in — used only for the query key.
   *
   * Deliberately not passed to `agents.files.*`: a skill id is not an agent id.
   * These files belong to the agent running the conversation (`main` on a local
   * profile), and sending `create-store` where the gateway wants `main` returns
   * `unknown agent id` — which the panel then showed as an empty editor with a
   * quiet "could not read" note, so it looked like an agent with no soul rather
   * than a request that never had a chance.
   */
  skillId: string
}

/**
 * The editor is a separate component mounted under a `key` of agent+file, so
 * switching files remounts it and the draft starts from the loaded content.
 * That replaces the usual "copy props into state inside an effect", which
 * cascades renders and briefly shows the previous file's text under the new
 * file's name.
 */
export function FileEditor({
  initial,
  fileName,
  onSave,
  isSaving,
  missing,
}: {
  initial: string
  fileName: string
  onSave: (content: string) => void
  isSaving: boolean
  missing?: string | null
}) {
  const [content, setContent] = useState(initial)
  const isDirty = content !== initial

  return (
    <>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        spellCheck={false}
        placeholder={`# ${fileName}\n\nNothing here yet — write it and save.`}
        className="selectable min-h-0 flex-1 resize-none rounded-field border border-line bg-bg-surface p-3 font-mono text-footnote leading-code text-content-primary outline-none focus:border-primary/60"
      />

      {missing && (
        <p className="shrink-0 text-caption text-content-muted">
          Could not read the current file ({missing}). Saving will create it.
        </p>
      )}

      <div className="flex shrink-0 items-center justify-end gap-2">
        {isDirty && (
          <GhostButton size="sm" onClick={() => setContent(initial)} disabled={isSaving}>
            Discard
          </GhostButton>
        )}
        <GradientButton size="sm" onClick={() => onSave(content)} disabled={!isDirty || isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </GradientButton>
      </div>
    </>
  )
}

export function AgentFilesPanel({ skillId }: AgentFilesPanelProps) {
  const { show } = useToast()
  const queryClient = useQueryClient()
  const [active, setActive] = useState<FileName>('SOUL.md')

  // Asked for rather than assumed: `main` is the default on a local profile,
  // but a cloud agent set could name it anything.
  const agents = useQuery({
    queryKey: ['agents', 'list'] as const,
    queryFn: () => gatewayWS.agentsList(),
    staleTime: 5 * 60_000,
  })
  const agentId = agents.data?.defaultId ?? agents.data?.agents?.[0]?.id ?? null

  const queryKey = ['agent-files', agentId ?? 'unknown', skillId, active] as const

  const file = useQuery({
    queryKey,
    // A file that was never written throws rather than returning empty, which
    // is a normal state for a new agent — not an error worth a red screen.
    queryFn: async () => {
      try {
        const response = await gatewayWS.agentFilesGet(agentId!, active)
        return { content: response?.file?.content ?? '', missing: null as string | null }
      } catch (cause) {
        return { content: '', missing: errorMessage(cause) }
      }
    },
    enabled: agentId !== null,
    staleTime: 30_000,
  })

  const save = useMutation({
    mutationFn: (content: string) => gatewayWS.agentFilesSet(agentId!, active, content),
    onSuccess: (_result, content) => {
      queryClient.setQueryData(queryKey, { content, missing: null })
      show({ title: `${active} saved`, variant: 'success' })
    },
    onError: (error) =>
      show({ title: `Could not save ${active}`, description: errorMessage(error), variant: 'error' }),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <SegmentedControl
        aria-label="Agent file"
        value={active}
        onValueChange={setActive}
        className="shrink-0 self-start"
        items={AGENT_FILES.map((entry) => ({
          value: entry.name,
          label: <span className="font-mono">{entry.name}</span>,
        }))}
      />

      <p className="shrink-0 text-caption text-content-muted">
        {AGENT_FILES.find((entry) => entry.name === active)?.hint}
      </p>

      {agents.isLoading || file.isLoading || !file.data ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={22} />
        </div>
      ) : (
        <FileEditor
          key={`${agentId}:${active}`}
          fileName={active}
          initial={file.data.content}
          missing={file.data.missing}
          isSaving={save.isPending}
          onSave={(content) => save.mutate(content)}
        />
      )}
    </div>
  )
}
