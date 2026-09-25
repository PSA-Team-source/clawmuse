import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FavouriteIcon, FingerPrintIcon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { Spinner } from '@/components/brand'
import { useToast } from '@/components/patterns'
import { Dialog, Icon } from '@/components/primitives'
import { AgentAvatar } from '@/components/status/AgentAvatar'
import { MeshGradientBackdrop } from '@/components/status/MeshGradientBackdrop'
import { StatusNullState } from '@/components/status/StatusParts'
import { errorMessage } from '@/hooks'
import { LookEditor } from '@/features/avatar/LookEditor'
import { AGENT_ID, agentIdentityKey, useAgentAvatar, useAgentIdentity } from '@/lib/identity'
import { FileEditor } from '@/routes/chat/AgentFilesPanel'
import { gatewayWS } from '@/services/gateway-ws.service'
import { parseIdentityMarkdown } from './identity-file'

interface WorkspaceFile { name: string; missing: boolean; updatedAtMs?: number }

// Under the same 'agent-files' root as AgentFilesPanel, so a save in either invalidates both.
const filesKey = ['agent-files', AGENT_ID, 'status'] as const
const fileKey = (name: string) => [...filesKey, 'file', name] as const
const listKey = [...filesKey, 'list'] as const

/** A file that was never written comes back `missing`, which is a normal state — content is just empty. */
function useAgentFile(name: string, enabled = true) {
  return useQuery({
    queryKey: fileKey(name),
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const response = await gatewayWS.agentFilesGet(AGENT_ID, name)
        return { content: response?.file?.content ?? '', error: null as string | null }
      } catch (cause) {
        return { content: '', error: errorMessage(cause) }
      }
    },
  })
}

/** Muse formatShortDate: MM.DD.YY. */
function shortDate(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}.${String(date.getFullYear()).slice(-2)}`
}

/**
 * Muse's file dialog, opened from the Identity tab: the workspace file in the
 * same editor the chat's agent-files panel uses, saved through
 * `agents.files.set`. Saving refreshes the resolved identity so the avatar,
 * name and this card update everywhere.
 */
function AgentFileDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const { show } = useToast()
  const queryClient = useQueryClient()
  const file = useAgentFile(name)
  const save = useMutation({
    mutationFn: (content: string) => gatewayWS.agentFilesSet(AGENT_ID, name, content),
    onSuccess: async (_result, content) => {
      queryClient.setQueryData(fileKey(name), { content, error: null })
      show({ title: `${name} saved`, variant: 'success' })
      onClose()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agent-files'] }),
        queryClient.invalidateQueries({ queryKey: agentIdentityKey }),
        queryClient.invalidateQueries({ queryKey: ['agent-avatar'] }),
      ])
    },
    onError: (error) => show({ title: `Could not save ${name}`, description: errorMessage(error), variant: 'error' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={name} className="flex h-[70vh] w-[640px] flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {file.data ? (
          <FileEditor
            key={name}
            fileName={name}
            initial={file.data.content}
            missing={file.data.error}
            isSaving={save.isPending}
            onSave={(content) => save.mutate(content)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center"><Spinner size={22} /></div>
        )}
      </div>
    </Dialog>
  )
}

function IdentitySection({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4">
      <div className="pb-1.5 pt-4">
        <span className="text-footnote font-medium uppercase text-content-secondary">{label}</span>
      </div>
      <p className="text-body-sm text-content-primary">{value}</p>
    </div>
  )
}

/** Muse HatchIdentitySpecialFiles: each card's mesh gradient, verbatim. */
const MESH = {
  soul: { colors: ['#d4233c', '#a11b2e', '#7a1425', '#b82a3a'], speed: 0.23, swirl: 0.15, distortion: 0.9 },
  memory: { colors: ['#241d9a', '#3a4ec9', '#4b8bb5', '#2a5080'], speed: 0.35, swirl: 1, distortion: 0.7, rotation: 180 },
} as const

/** Muse HatchIdentitySpecialFiles FileCard: title, mono kicker, modified date and icon over the file's mesh gradient. */
function FileCard({ title, tone, modifiedAt, onClick }: { title: string; tone: 'soul' | 'memory'; modifiedAt?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${title}.md`}
      className="muse-file-card relative flex min-h-[140px] w-full cursor-pointer flex-col justify-between overflow-hidden p-4 text-start transition-opacity hover:opacity-90 active:opacity-80"
    >
      <MeshGradientBackdrop {...MESH[tone]} colors={[...MESH[tone].colors]} />
      <div className="relative">
        <span className="block text-body font-semibold text-white">{title}</span>
        <span className="muse-file-card-kicker mt-0.5 block">Access with care</span>
      </div>
      <div className="muse-file-card-date flex items-center justify-between">
        {modifiedAt != null ? <span>{shortDate(modifiedAt)}</span> : <span />}
        <Icon icon={FavouriteIcon} size={24} className="text-current" />
      </div>
    </button>
  )
}

/**
 * Muse HatchStatusIdentityTab: who the agent is (name, tagline — or OpenClaw's Theme when none is set,
 * creature, vibe, emoji) straight from IDENTITY.md with an Edit button, then
 * the SOUL and MEMORY files with their last-modified dates.
 */
export default function IdentityTab() {
  const identity = useAgentIdentity()
  const identityFile = useAgentFile('IDENTITY.md')
  const files = useQuery({
    queryKey: listKey,
    staleTime: 30_000,
    queryFn: () => gatewayWS.call<{ files?: WorkspaceFile[] }>('agents.files.list', { agentId: AGENT_ID }),
  })
  const [openFile, setOpenFile] = useState<string | null>(null)
  const photo = useAgentAvatar(identity.data)

  if (identity.isPending || identityFile.isPending) {
    return <div className="flex justify-center pt-8"><Spinner size={22} /></div>
  }
  if (identity.isError && identityFile.data?.error) {
    return <StatusNullState icon={FingerPrintIcon} title="Identity unavailable" subtitle={errorMessage(identity.error)} />
  }

  const fields = parseIdentityMarkdown(identityFile.data?.content ?? '')
  const tagline = fields.tagline ?? fields.theme
  const name = identity.data?.name?.trim() || fields.name || ''
  const modified = (fileName: string) => {
    const entry = files.data?.files?.find((file) => file.name === fileName)
    return entry && !entry.missing ? entry.updatedAtMs : undefined
  }

  return (
    <div className="space-y-5 px-4 pb-3 pt-2">
      <div className="muse-identity-card relative bg-fill-raised pb-4 pt-3">
        {/* The agent's face, as everywhere else: its photo or the ClawMuse avatar, not the identity emoji. */}
        <AgentAvatar size={36} className="absolute end-4 top-3 bg-fill-strong" />
        <div className="pe-14 ps-4">
          <h3 className="text-body font-medium text-content-primary">{name || 'Unnamed'}</h3>
          {tagline && <p className="mt-0.5 truncate text-footnote text-content-secondary" title={tagline}>{tagline}</p>}
        </div>
        {fields.creature && <IdentitySection label="Creature" value={fields.creature} />}
        {fields.vibe && <IdentitySection label="Vibe" value={fields.vibe} />}
        <div className="mt-3 px-4">
          <button
            type="button"
            onClick={() => setOpenFile('IDENTITY.md')}
            className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-fill-strong text-body-sm font-medium text-content-primary transition-colors hover:bg-fill-stronger"
          >
            <Icon icon={PencilEdit02Icon} size={18} className="text-current" />
            Edit
          </button>
        </div>
      </div>

      {/* A photo avatar replaces the 3D character, so its look only matters without one. */}
      {!photo && (
        <div className="muse-identity-card bg-fill-raised px-4 pb-4 pt-3">
          <h3 className="mb-3 text-body font-medium text-content-primary">Avatar</h3>
          <LookEditor />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FileCard title="SOUL" tone="soul" modifiedAt={modified('SOUL.md')} onClick={() => setOpenFile('SOUL.md')} />
        <FileCard title="MEMORY" tone="memory" modifiedAt={modified('MEMORY.md')} onClick={() => setOpenFile('MEMORY.md')} />
      </div>

      {openFile && <AgentFileDialog name={openFile} onClose={() => setOpenFile(null)} />}
    </div>
  )
}
