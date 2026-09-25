import { useState } from 'react'
import { DEVICE, IS_WINDOWS } from '@/lib/platform'
import { SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { AlertDialog } from '@/components/primitives'

/**
 * Muse's Settings > Data controls (SettingsDataPrivacyTab): "Download your
 * agent data", backed by OpenClaw's own verified backup archive.
 */
export default function DataControlsScreen() {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState<'ask' | 'working' | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'working' } | { kind: 'done'; name: string } | { kind: 'error'; message: string }>({ kind: 'idle' })

  async function download(): Promise<void> {
    setConfirming(false)
    setState({ kind: 'working' })
    const result = await window.clawmuse.runtime.exportData()
    setState(result.ok ? { kind: 'done', name: result.path.split('/').pop() ?? result.path } : { kind: 'error', message: result.error })
  }

  async function remove(): Promise<void> {
    setRemoving('working')
    setRemoveError(null)
    const result = await window.clawmuse.runtime.removeApp()
    // On success the app quits; only a failure comes back here.
    if (!result.ok) {
      setRemoving(null)
      setRemoveError(result.error)
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">Data controls</h1>
        <div className="flex flex-col gap-2">
          <SettingsGroup className="mb-0">
            <SettingsRow
              label="Download your agent data"
              description={state.kind === 'done' ? `Saved to Downloads as ${state.name}` : state.kind === 'error' ? state.message : 'Chats, files, settings and credentials in one archive'}
              right={<SettingsButton disabled={state.kind === 'working'} onClick={() => setConfirming(true)}>{state.kind === 'working' ? 'Preparing download…' : 'Download'}</SettingsButton>}
            />
          </SettingsGroup>
          <p className="px-3 text-footnote text-content-secondary">The archive includes your API keys — keep it private. Restore it with “openclaw backup restore”.</p>
        </div>
        <div className="flex flex-col gap-2">
          <SettingsGroup className="mb-0">
            <SettingsRow
              label={`Remove ClawMuse from this ${DEVICE}`}
              danger
              description={removeError ?? 'Stops the agent and deletes your chats, bots, files, keys and settings, then moves the app to the Trash'}
              right={<SettingsButton disabled={removing === 'working'} onClick={() => setRemoving('ask')}>{removing === 'working' ? 'Removing…' : 'Remove'}</SettingsButton>}
            />
          </SettingsGroup>
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Title className="text-headline font-semibold text-content-primary">Download your agent data?</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-body-sm text-content-secondary">This will download a copy of your chats, files and other agent data.</AlertDialog.Description>
        <div className="mt-6 flex justify-end gap-2">
          <AlertDialog.Close className="h-8 rounded-full px-4 text-body-sm font-medium hover:bg-fill-strong">Cancel</AlertDialog.Close>
          <button type="button" onClick={() => void download()} className="h-8 rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white">Download</button>
        </div>
      </AlertDialog>

      <AlertDialog open={removing === 'ask'} onOpenChange={(open) => setRemoving(open ? 'ask' : null)}>
        <AlertDialog.Title className="text-headline font-semibold text-content-primary">Remove ClawMuse from this {DEVICE}?</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-body-sm text-content-secondary">
          This stops the agent and permanently deletes your chats, bots, files, API keys, feed and settings, then {IS_WINDOWS ? 'uninstalls ClawMuse' : 'moves ClawMuse to the Trash'}. It cannot be undone — download your agent data first if you may want it back. Other OpenClaw setups on this {DEVICE} are not touched.
        </AlertDialog.Description>
        <div className="mt-6 flex justify-end gap-2">
          <AlertDialog.Close className="h-8 rounded-full px-4 text-body-sm font-medium hover:bg-fill-strong">Cancel</AlertDialog.Close>
          <button type="button" onClick={() => void remove()} className="h-8 rounded-full bg-error px-4 text-body-sm font-medium text-white">Remove ClawMuse</button>
        </div>
      </AlertDialog>
    </div>
  )
}
