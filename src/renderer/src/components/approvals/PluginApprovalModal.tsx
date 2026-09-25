import { useState } from 'react'
import { AlertDialog } from '@/components/primitives'
import { usePluginApprovalsStore, type PluginDecision } from '@/stores/plugin-approvals.store'
import { useToast } from '@/components/patterns'

const LABEL: Record<PluginDecision, string> = { 'allow-once': 'Allow once', 'allow-always': 'Always allow', deny: 'Deny' }
const PRIMARY_BUTTON = 'h-8 rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white disabled:opacity-45'
const QUIET_BUTTON = 'h-8 rounded-full px-4 text-body-sm font-medium hover:bg-fill-strong disabled:opacity-45'
/** Allow once is the primary action; the others stay quiet. */
const BUTTON: Record<PluginDecision, string> = { 'allow-once': PRIMARY_BUTTON, 'allow-always': QUIET_BUTTON, deny: QUIET_BUTTON }

/** Global prompt for plugin approvals (e.g. a Wallet card request). Mounted once at the shell root. */
export function PluginApprovalModal() {
  const toast = useToast()
  const current = usePluginApprovalsStore((state) => state.queue[0] ?? null)
  const pending = usePluginApprovalsStore((state) => state.queue.length)
  const resolve = usePluginApprovalsStore((state) => state.resolve)
  const [busy, setBusy] = useState(false)

  async function decide(decision: PluginDecision): Promise<void> {
    if (!current) return
    setBusy(true)
    try {
      await resolve(current.id, decision)
    } catch (error) {
      toast.show({ title: 'Could not send your decision', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const order: PluginDecision[] = ['deny', 'allow-always', 'allow-once']
  return (
    <AlertDialog open={current !== null} onOpenChange={(open) => { if (!open && current) void decide('deny') }}>
      {current && (
        <>
          <AlertDialog.Title className="text-headline font-semibold text-content-primary">{current.title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-body-sm text-content-secondary">{current.description}</AlertDialog.Description>
          {pending > 1 && <p className="mt-2 text-footnote text-content-tertiary">{pending - 1} more waiting</p>}
          <div className="mt-6 flex justify-end gap-2">
            {order.filter((decision) => current.allowedDecisions.includes(decision)).map((decision) => (
              <button
                key={decision}
                type="button"
                disabled={busy}
                onClick={() => void decide(decision)}
                className={BUTTON[decision]}
              >
                {LABEL[decision]}
              </button>
            ))}
          </div>
        </>
      )}
    </AlertDialog>
  )
}
