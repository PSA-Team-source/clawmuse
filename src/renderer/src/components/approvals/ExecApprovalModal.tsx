import { useState } from 'react'
import { ShieldUserIcon } from '@hugeicons/core-free-icons'
import { approvalBotId, type PendingApproval } from '@/stores/approvals.store'
import { useBotsStore } from '@/stores/bots.store'
import { GhostButton, GradientButton } from '@/components/brand'
import { BotAvatar } from '@/components/chat'
import { Icon } from '@/components/primitives'
import { AlertDialog } from '@/components/primitives'

interface ExecApprovalModalProps {
  approval: PendingApproval | null
  pendingCount: number
  onResolve: (id: string, approved: boolean) => void
}

function formatArgs(args: unknown): string {
  if (args == null) return ''
  if (typeof args === 'string') return args
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

/**
 * Global modal for `exec.approval.requested`. The agent is blocked until this
 * is answered, so it must render above whatever screen the user is on —
 * mount once at the app shell root.
 *
 * Two things it must say plainly, both of which are easy to leave out:
 *
 *   - **which bot is asking.** With a roster, "your agent wants to run exec" is
 *     not an answer; the user approves for a named teammate with a known job.
 *   - **what approving does and does not cover.** An approval gates the action
 *     being *proposed*. Anything already done — a file written, a page
 *     submitted — stays done, and a dialog that implies otherwise is selling a
 *     rollback that does not exist.
 */
export function ExecApprovalModal({ approval, pendingCount, onResolve }: ExecApprovalModalProps) {
  const [busy, setBusy] = useState(false)
  const bots = useBotsStore((state) => state.bots)
  const open = !!approval
  const args = formatArgs(approval?.args)
  const botId = approval ? approvalBotId(approval) : null
  const bot = bots.find((entry) => entry.id === (botId ?? 'main'))

  function decide(approved: boolean) {
    if (!approval) return
    setBusy(true)
    try {
      onResolve(approval.id, approved)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !next && decide(false)}
      layer="critical"
      className="w-[420px]"
    >
      <div className="flex flex-col items-center gap-2.5 text-center">
        {bot ? (
          <BotAvatar
            id={bot.id}
            name={bot.name}
            emoji={bot.emoji}
            avatar={bot.avatar}
            size={56}
            className="mb-0.5"
          />
        ) : (
          <div className="mb-0.5 flex size-14 items-center justify-center rounded-full bg-fill-accent">
            <Icon icon={ShieldUserIcon} size={28} className="text-primary-light" />
          </div>
        )}
        <AlertDialog.Title className="text-headline font-bold text-content-primary">
          {bot ? `${bot.name} needs approval` : 'Approve tool action?'}
        </AlertDialog.Title>
        <AlertDialog.Description className="text-body-sm leading-5 text-content-body">
          {bot ? 'It wants to run' : 'Your agent wants to run'}{' '}
          <span className="font-bold text-primary-light">{approval?.tool ?? 'a tool'}</span>.
        </AlertDialog.Description>

        {args && (
          <pre className="selectable mt-1.5 max-h-[180px] w-full overflow-auto rounded-field border border-line-subtle bg-fill p-3 text-left font-mono text-caption leading-code text-content-secondary">
            {args}
          </pre>
        )}

        {pendingCount > 1 && (
          <p className="mt-0.5 text-caption text-content-muted">+{pendingCount - 1} more pending</p>
        )}

        <p className="mt-0.5 text-caption text-content-faint">
          This covers what it is about to do. Anything already done stays done.
        </p>

        <div className="mt-3 flex w-full gap-3">
          <GhostButton
            onClick={() => decide(false)}
            disabled={busy}
            size="lg"
            className="flex-1 border-error/40 bg-error/[0.08] text-error"
          >
            Deny
          </GhostButton>
          <GradientButton onClick={() => decide(true)} loading={busy} size="lg" className="flex-1">
            Approve
          </GradientButton>
        </div>
      </div>
    </AlertDialog>
  )
}
