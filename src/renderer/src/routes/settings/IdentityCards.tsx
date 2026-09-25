import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SettingsButton, SettingsGroup } from '@/components/settings'
import { TextField, useToast } from '@/components/patterns'
import { Dialog } from '@/components/primitives'
import { gatewayWS } from '@/services/gateway-ws.service'
import { squareAvatar } from '@/lib/avatar'
import { agentIdentityKey, ownerProfileKey, useAgentAvatar, useAgentIdentity, useOwnerAvatarUrl, useOwnerProfile } from '@/lib/identity'

interface EditState { kind: 'owner' | 'agent'; name: string; image: string | null; file: { mime: 'image/png'; base64: string; dataUrl: string } | null }

/**
 * Muse opens General with the account card. ClawMuse has no cloud account,
 * so the same place holds the two identities that do exist locally: you (the
 * gateway owner profile) and your agent (IDENTITY.md) — both editable.
 */
export function IdentityCards() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const owner = useOwnerProfile()
  const agent = useAgentIdentity()
  const ownerAvatar = useOwnerAvatarUrl(owner.data)
  const agentImage = useAgentAvatar(agent.data)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function pick(file: File | undefined): Promise<void> {
    if (!file || !edit) return
    try {
      const resized = await squareAvatar(file)
      setEdit({ ...edit, file: resized, image: resized.dataUrl })
    } catch {
      toast.show({ title: 'That image could not be read', variant: 'error' })
    }
  }

  async function save(): Promise<void> {
    if (!edit) return
    const name = edit.name.trim()
    setSaving(true)
    try {
      if (edit.kind === 'owner' && owner.data) {
        if (name !== (owner.data.displayName ?? '')) await gatewayWS.call('users.setDisplayName', { profileId: owner.data.id, displayName: name || null })
        if (edit.file) await gatewayWS.call('users.setAvatar', { profileId: owner.data.id, mime: edit.file.mime, avatarBase64: edit.file.base64 })
        await queryClient.invalidateQueries({ queryKey: ownerProfileKey })
      } else if (edit.kind === 'agent') {
        const result = await window.clawmuse.runtime.setAgentIdentity({ ...(name && name !== agent.data?.name ? { name } : {}), ...(edit.file ? { pngBase64: edit.file.base64 } : {}) })
        if (!result.ok && result.error !== 'Nothing to change') throw new Error(result.error)
        await queryClient.invalidateQueries({ queryKey: agentIdentityKey })
        await queryClient.invalidateQueries({ queryKey: ['agent-avatar'] })
      }
      setEdit(null)
    } catch (error) {
      toast.show({ title: 'Could not save', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const circle = (src: string | null, fallback?: string) => src
    ? <img src={src} alt="" className="size-10 shrink-0 rounded-full object-cover" />
    : fallback ? <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill-strong text-title-3">{fallback}</span> : null

  return (
    <>
      <SettingsGroup className="mb-0">
        {owner.data && (
          <div className="settings-row flex w-full items-center gap-3">
            {circle(ownerAvatar)}
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-content-primary">{owner.data.displayName || 'You'}</p>
              <p className="text-caption text-content-secondary">Your profile on this computer</p>
            </div>
            <SettingsButton onClick={() => setEdit({ kind: 'owner', name: owner.data!.displayName ?? '', image: ownerAvatar, file: null })}>Edit</SettingsButton>
          </div>
        )}
        {agent.data && (
          <div className="settings-row flex w-full items-center gap-3">
            {circle(agentImage, agent.data.emoji)}
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-content-primary">{agent.data.name || 'Your agent'}</p>
              <p className="text-caption text-content-secondary">Your agent's name and avatar</p>
            </div>
            <SettingsButton onClick={() => setEdit({ kind: 'agent', name: agent.data!.name ?? '', image: agentImage, file: null })}>Edit</SettingsButton>
          </div>
        )}
      </SettingsGroup>

      <Dialog open={edit !== null} onOpenChange={(open) => !open && setEdit(null)} title={edit?.kind === 'owner' ? 'Your profile' : 'Your agent'} className="w-[380px] p-5">
        {edit && (
          <form onSubmit={(event) => { event.preventDefault(); void save() }} className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {circle(edit.image, edit.kind === 'agent' ? agent.data?.emoji : undefined)}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void pick(event.target.files?.[0])} />
              <SettingsButton onClick={() => fileRef.current?.click()}>{edit.image ? 'Change photo' : 'Add photo'}</SettingsButton>
            </div>
            <TextField label="Name" value={edit.name} onChange={(name) => setEdit({ ...edit, name: name.slice(0, 64) })} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEdit(null)} className="h-8 rounded-full px-4 text-body-sm font-medium hover:bg-fill-strong">Cancel</button>
              <button type="submit" disabled={saving} className="h-8 rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white disabled:opacity-45">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  )
}
