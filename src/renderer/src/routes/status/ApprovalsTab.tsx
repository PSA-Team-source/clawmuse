import { useState } from 'react'
import { Alert02Icon, ArrowDown01Icon, CommandLineIcon, PuzzleIcon, SecurityCheckIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/primitives'
import { useToast } from '@/components/patterns'
import { StatusListCell, StatusNullState, StatusSectionHeading, compactAge } from '@/components/status/StatusParts'
import { cn } from '@/lib/cn'
import {
  approvalBotId,
  useApprovalHistoryStore,
  useApprovalsStore,
  type ApprovalDecision,
  type ApprovalHistoryEntry,
  type ApprovalOutcome,
} from '@/stores/approvals.store'
import { useBotsStore } from '@/stores/bots.store'
import { usePluginApprovalsStore } from '@/stores/plugin-approvals.store'
import { useQuestionsStore, type QuestionRequest } from '@/stores/questions.store'
import { QuestionCard } from '@/components/questions'

/** The wording the approval modals use, so a decision reads the same everywhere. */
const DECISION_LABEL: Record<ApprovalDecision, string> = { 'allow-once': 'Allow once', 'allow-always': 'Always allow', deny: 'Deny' }
/** Muse approvalOutcomeLabel. */
const OUTCOME_LABEL: Record<ApprovalOutcome, string> = { 'allow-once': 'Allowed once', 'allow-always': 'Always allowed', deny: 'Denied', 'timed-out': 'Timed out' }
const OUTCOME_TONE: Record<ApprovalOutcome, string> = { 'allow-once': 'text-success', 'allow-always': 'text-success', deny: 'text-error', 'timed-out': 'text-content-tertiary' }
const PRIMARY_BUTTON = 'h-8 rounded-full bg-muse-blue px-3 text-footnote font-medium text-white disabled:opacity-45'
const QUIET_BUTTON = 'h-8 rounded-full px-3 text-footnote font-medium text-content-primary hover:bg-fill-strong disabled:opacity-45'
const BUTTON: Record<ApprovalDecision, string> = { 'allow-once': PRIMARY_BUTTON, 'allow-always': QUIET_BUTTON, deny: QUIET_BUTTON }
/** Deny first, the primary action last — the order the modals use. */
const BUTTON_ORDER: ApprovalDecision[] = ['deny', 'allow-always', 'allow-once']
const KIND_ICON = { exec: CommandLineIcon, plugin: PuzzleIcon }

/** One pending request, exec or plugin, in the shape the panel renders. */
export interface PendingItem {
  key: string
  kind: 'exec' | 'plugin'
  id: string
  title: string
  /** Command line or the plugin's description. */
  detail: string | null
  /** Shown in a monospace block (a command) rather than as prose. */
  detailIsCode: boolean
  cwd: string | null
  warning: string | null
  allowed: ApprovalDecision[]
  requestedAtMs: number
}

type ExecQueue = ReturnType<typeof useApprovalsStore.getState>['queue']
type PluginQueue = ReturnType<typeof usePluginApprovalsStore.getState>['queue']

/**
 * Both queues as one list, oldest first — the order the agents started
 * waiting. `botName` turns an agent id into the name the roster shows.
 */
export function pendingItems(exec: ExecQueue, plugin: PluginQueue, botName: (agentId: string | null) => string, now = Date.now()): PendingItem[] {
  const execItems = exec.map((approval): PendingItem => ({
    key: `exec:${approval.id}`,
    kind: 'exec',
    id: approval.id,
    title: `${botName(approvalBotId(approval))} wants to run a command`,
    detail: approval.command ?? (typeof approval.args === 'string' ? approval.args : approval.tool),
    detailIsCode: true,
    cwd: approval.cwd ?? null,
    warning: approval.warningText ?? null,
    allowed: approval.allowedDecisions ?? ['allow-once', 'deny'],
    requestedAtMs: approval.receivedAt,
  }))
  const pluginItems = plugin.map((approval): PendingItem => ({
    key: `plugin:${approval.id}`,
    kind: 'plugin',
    id: approval.id,
    title: approval.title,
    detail: approval.description || null,
    detailIsCode: false,
    cwd: null,
    warning: null,
    allowed: approval.allowedDecisions,
    requestedAtMs: approval.createdAtMs ?? now,
  }))
  return [...execItems, ...pluginItems].sort((a, b) => a.requestedAtMs - b.requestedAtMs)
}

/** Muse HatchBackgroundApprovalsPanel: "Needs review" over "Approvals history". */
export default function ApprovalsTab() {
  const execQueue = useApprovalsStore((state) => state.queue)
  const pluginQueue = usePluginApprovalsStore((state) => state.queue)
  const history = useApprovalHistoryStore((state) => state.entries)
  const questions = useQuestionsStore((state) => state.pending)
  const bots = useBotsStore((state) => state.bots)

  function botName(agentId: string | null): string {
    const bot = bots.find((entry) => entry.id === (agentId ?? 'main'))
    return bot?.name ?? 'Your agent'
  }

  const pending = pendingItems(execQueue, pluginQueue, botName)

  if (pending.length === 0 && questions.length === 0 && history.length === 0) {
    return <StatusNullState icon={SecurityCheckIcon} title="Approvals" subtitle="No approvals yet" />
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-3">
      {(pending.length > 0 || questions.length > 0) && <NeedsReview items={pending} questions={questions} />}
      {history.length > 0 && <ApprovalsHistory entries={history} botName={botName} />}
    </div>
  )
}

/**
 * Agent questions sit here too: Muse has one "pending user confirmation"
 * surface, and a question asked in a thread that is not open — or by a
 * background run — has nowhere else to be answered.
 */
function NeedsReview({ items, questions }: { items: PendingItem[]; questions: QuestionRequest[] }) {
  // Muse keeps one card open at a time, the first by default.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const open = items.some((item) => item.key === openKey) ? openKey : (items[0]?.key ?? null)

  return (
    <section aria-label="Needs review" className="flex flex-col gap-2">
      <StatusSectionHeading>Needs review</StatusSectionHeading>
      <div className="flex flex-col gap-2">
        {questions.map((request) => <QuestionCard key={request.id} request={request} layout="panel" />)}
        {items.map((item) =>
          item.key === open ? (
            <PendingCard key={item.key} item={item} />
          ) : (
            <StatusListCell
              key={item.key}
              icon={KIND_ICON[item.kind]}
              iconClassName="text-content-secondary"
              title={item.title}
              lines={2}
              subtitle={item.detail ?? undefined}
              trailing={<span className="text-muse-artifact-meta text-content-tertiary tabular-nums">{compactAge(item.requestedAtMs)}</span>}
              onClick={() => setOpenKey(item.key)}
            />
          ),
        )}
      </div>
    </section>
  )
}

function PendingCard({ item }: { item: PendingItem }) {
  const toast = useToast()
  const resolveExec = useApprovalsStore((state) => state.resolve)
  const resolvePlugin = usePluginApprovalsStore((state) => state.resolve)
  const [busy, setBusy] = useState(false)

  async function decide(decision: ApprovalDecision): Promise<void> {
    setBusy(true)
    try {
      if (item.kind === 'exec') await resolveExec(item.id, decision)
      else await resolvePlugin(item.id, decision)
    } catch (error) {
      toast.show({ title: 'Could not send your decision', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-box bg-fill-raised p-3">
      <div className="flex items-start gap-2.5">
        <Icon icon={KIND_ICON[item.kind]} size={20} className="mt-0.5 shrink-0 text-content-primary" />
        <p className="min-w-0 flex-1 text-body-sm font-medium break-words text-content-primary">{item.title}</p>
      </div>
      {item.detail &&
        (item.detailIsCode ? (
          <pre className="selectable max-h-32 overflow-auto rounded-field bg-fill p-2 font-mono text-caption break-all whitespace-pre-wrap text-content-primary">{item.detail}</pre>
        ) : (
          <p className="text-footnote break-words whitespace-pre-wrap text-content-secondary">{item.detail}</p>
        ))}
      {item.cwd && <p className="truncate text-caption text-content-tertiary" title={item.cwd}>in {item.cwd}</p>}
      {item.warning && (
        <p className="flex items-start gap-1 text-caption text-content-primary">
          <Icon icon={Alert02Icon} size={14} className="mt-0.5 shrink-0 text-warning" />
          <span className="min-w-0 break-words whitespace-pre-wrap">{item.warning}</span>
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-1">
        {BUTTON_ORDER.filter((decision) => item.allowed.includes(decision)).map((decision) => (
          <button key={decision} type="button" disabled={busy} onClick={() => void decide(decision)} className={BUTTON[decision]}>
            {DECISION_LABEL[decision]}
          </button>
        ))}
      </div>
    </div>
  )
}

function ApprovalsHistory({ entries, botName }: { entries: ApprovalHistoryEntry[]; botName: (agentId: string | null) => string }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <section aria-label="Approvals history" className="flex flex-col gap-2">
      <StatusSectionHeading>Approvals history</StatusSectionHeading>
      <div className="flex flex-col gap-px">
        {entries.map((entry) => {
          const key = `${entry.kind}:${entry.id}`
          const isOpen = expanded === key
          const who = entry.kind === 'exec' ? botName(entry.agentId ?? null) : null
          return (
            <div key={key}>
              <StatusListCell
                icon={KIND_ICON[entry.kind]}
                iconClassName="text-content-secondary"
                title={entry.title}
                lines={2}
                subtitle={
                  <>
                    <span className={OUTCOME_TONE[entry.outcome]}>{OUTCOME_LABEL[entry.outcome]}</span>
                    {` · ${compactAge(entry.decidedAtMs)}`}
                    {who && ` · ${who}`}
                  </>
                }
                trailing={entry.detail ? <Icon icon={ArrowDown01Icon} size={16} className={cn('mt-0.5 text-content-tertiary motion-safe:transition-transform', isOpen && 'rotate-180')} /> : undefined}
                selected={isOpen}
                onClick={entry.detail ? () => setExpanded(isOpen ? null : key) : undefined}
              />
              {isOpen && entry.detail && (
                <div className="mb-2 ms-10 max-h-32 overflow-auto rounded-field bg-fill-raised p-3">
                  <p className={cn('selectable text-caption break-words whitespace-pre-wrap text-content-secondary', entry.kind === 'exec' && 'font-mono')}>{entry.detail}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
