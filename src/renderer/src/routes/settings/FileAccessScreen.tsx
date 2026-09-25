import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { useToast } from '@/components/patterns'
import { Switch } from '@/components/primitives'
import { gatewayWS } from '@/services/gateway-ws.service'

const FS_KEY = ['gateway-config', 'tools.fs'] as const

/**
 * Muse's Settings > File system access (HatchFileSystemAccessSettingsTab),
 * mapped onto what is real here: the macOS Full Disk Access grant the local
 * agent runs under, OpenClaw's tools.fs.workspaceOnly limit, and the folders
 * ClawMuse's Library can browse.
 */
export default function FileAccessScreen() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [fullDisk, setFullDisk] = useState<'granted' | 'denied' | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const refresh = () => void window.clawmuse.app.fullDiskAccess().then(setFullDisk).catch(() => setFullDisk(null))
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const workspaceOnly = useQuery({
    queryKey: FS_KEY,
    queryFn: async () => {
      const current = await gatewayWS.getConfig()
      const source = (current.sourceConfig ?? current.config ?? {}) as { tools?: { fs?: { workspaceOnly?: unknown } } }
      return source.tools?.fs?.workspaceOnly === true
    },
  })
  const roots = useQuery({ queryKey: ['fs-roots'], queryFn: () => window.clawmuse.fs.roots() })

  async function setAnywhere(anywhere: boolean): Promise<void> {
    setSaving(true)
    try {
      await gatewayWS.setConfig('tools.fs.workspaceOnly', !anywhere)
      queryClient.setQueryData(FS_KEY, !anywhere)
      toast.show({ title: anywhere ? 'The agent can use files anywhere' : 'The agent is limited to its workspace', description: 'Restart the agent to apply.' })
    } catch (error) {
      toast.show({ title: 'Could not update file access', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">File system access</h1>

        <div className="flex flex-col gap-2">
          <SettingsGroup title="Permissions required" className="mb-0">
            <SettingsRow
              label="Full Disk Access"
              right={fullDisk === null ? undefined : fullDisk === 'granted'
                ? <span className="text-body-sm text-content-secondary">Allowed</span>
                : <SettingsButton onClick={() => void window.clawmuse.app.openFullDiskAccessSettings()}>Open System Settings</SettingsButton>}
            />
          </SettingsGroup>
          <p className="px-3 text-footnote text-content-secondary">Full Disk Access enables ClawMuse to read and interact with your files and apps. After allowing it, restart ClawMuse.</p>
        </div>

        <div className="flex flex-col gap-2">
          <SettingsGroup title="Agent file access" className="mb-0">
            <SettingsRow
              label="Files outside the workspace"
              description="Let the agent read, write and edit files anywhere it has permission, not only in its workspace"
              right={workspaceOnly.data === undefined ? undefined : <Switch checked={!workspaceOnly.data} disabled={saving} onCheckedChange={(on) => void setAnywhere(on)} aria-label="Files outside the workspace" />}
            />
          </SettingsGroup>
          <p className="px-3 text-footnote text-content-secondary">Shell commands follow Permissions → Running commands.</p>
        </div>

        {(roots.data?.length ?? 0) > 0 && (
          <SettingsGroup title="Library folders" className="mb-0">
            {roots.data!.map((root) => <SettingsRow key={root.id} label={root.label} description={root.path} />)}
          </SettingsGroup>
        )}
      </div>
    </div>
  )
}
