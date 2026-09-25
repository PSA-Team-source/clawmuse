import { useEffect, useState, type KeyboardEvent } from 'react'
import { ArrowUpRight01Icon, Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { IconButton } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { cn } from '@/lib/cn'
import { agentIdFromSessionKey } from '@/services/session-key'
import { useBotsStore } from '@/stores/bots.store'
import {
  draftComplete,
  questionInSessions,
  useQuestionsStore,
  type AgentQuestion,
  type QuestionDraft,
  type QuestionRequest,
} from '@/stores/questions.store'

type Layout = 'chat' | 'panel'

/**
 * Chat: Muse's inline approval card above the composer (bg-fill-blur-thick,
 * rounded-24, elevation-01, 16px padding). Panel: the status panel's Needs
 * review card.
 */
const SURFACE: Record<Layout, string> = {
  chat: 'muse-question-card material-thick shadow-raised mb-3 gap-4 p-4',
  panel: 'rounded-box bg-fill-raised gap-3 p-3',
}
/** Muse HatchSurveyQuestion prompt: title-3-emphasized; the narrow panel steps down to headline. */
const PROMPT: Record<Layout, string> = { chat: 'text-title-3', panel: 'text-headline' }
const OPTION_ROW = 'flex w-full items-center justify-between gap-3 rounded-sm px-2 py-4 text-start transition-colors hover:bg-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muse-blue disabled:opacity-45'
const OPTION_DIVIDER = 'border-t border-line-hairline'
const FIELD = 'selectable w-full resize-none rounded-field bg-fill px-3 py-2 text-body text-content-primary outline-none placeholder:text-content-tertiary focus-visible:ring-2 focus-visible:ring-muse-blue disabled:opacity-45'
const PRIMARY_BUTTON = 'h-9 w-full rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white disabled:opacity-45'
const QUIET_BUTTON = 'h-9 shrink-0 rounded-full px-4 text-body-sm font-medium text-content-primary hover:bg-fill-strong disabled:opacity-45'

/** OpenClaw's two secret-store kinds (Control UI secretsStore.protectedSecret / agentReadable). */
const STORE_KIND: Record<'secret' | 'env', string> = { secret: ', a protected secret.', env: ', an agent-readable environment value.' }

function remaining(expiresAtMs: number, now: number): string {
  const minutes = Math.floor((expiresAtMs - now) / 60_000)
  if (minutes < 1) return 'Closes in under a minute'
  if (minutes < 60) return `Closes in ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `Closes in ${hours} h ${minutes % 60} min`
}

/** Re-renders every 30s so the deadline line stays true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * One agent question (`ask_user`), answered in place.
 *
 * Questions are asked one at a time with Muse's survey controls — a radio
 * group of full-width rows with an accent check, a free-text box for "Other",
 * "{current} of {total}" and a full-width Next / Submit — inside the chrome of
 * Muse's inline approval card, because to the user this *is* a pending
 * confirmation: the agent is blocked until it is answered.
 */
export function QuestionCard({ request, layout = 'chat' }: { request: QuestionRequest; layout?: Layout }) {
  const answer = useQuestionsStore((state) => state.answer)
  const skip = useQuestionsStore((state) => state.skip)
  const botName = useBotsStore((state) => {
    const agentId = (request.sessionKey ? agentIdFromSessionKey(request.sessionKey) : null) ?? request.agentId ?? 'main'
    return state.bots.find((bot) => bot.id === agentId)?.name ?? null
  })
  const now = useNow()
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({})
  const [hostsDraft, setHostsDraft] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<'submit' | 'skip' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const total = request.questions.length
  const question = request.questions[Math.min(index, total - 1)]!
  const draft = drafts[question.questionId]
  const isLast = index >= total - 1
  const canAdvance = draftComplete(question, draft) && busy === null

  function update(next: QuestionDraft): void {
    setDrafts((current) => ({ ...current, [question.questionId]: next }))
    setError(null)
  }

  function choose(label: string): void {
    const selected = draft?.selected ?? []
    if (question.multiSelect) {
      update({ selected: selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label], other: draft?.other ?? '' })
    } else {
      // One answer: picking an option replaces any typed one (and vice versa below).
      update({ selected: [label], other: '' })
    }
  }

  function type(text: string): void {
    update({ selected: question.multiSelect || !text.trim() ? (draft?.selected ?? []) : [], other: text })
  }

  async function submit(): Promise<void> {
    setBusy('submit')
    setError(null)
    try {
      await answer(request, drafts, hostsDraft)
      // Success unmounts this card (the store drops the question); a credential
      // is cleared either way so it never outlives the request.
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The gateway did not accept the answer')
      setBusy(null)
    }
  }

  async function decline(): Promise<void> {
    setBusy('skip')
    setError(null)
    try {
      await skip(request.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The gateway did not accept the skip')
      setBusy(null)
    }
  }

  function advance(): void {
    if (!canAdvance) return
    if (isLast) void submit()
    else setIndex(index + 1)
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): void {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    advance()
  }

  const acceptsText = question.options.length === 0 || question.isOther
  const binding = question.secretStore

  return (
    <section
      role="group"
      aria-label={botName ? `Question from ${botName}` : 'Question from your agent'}
      data-question-id={request.id}
      className={cn('flex flex-col', SURFACE[layout])}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-content-secondary">
          {question.header && <span className="rounded-full bg-fill-strong px-2 py-0.5 font-medium text-content-primary">{question.header}</span>}
          {layout === 'panel' && botName && <span>{botName} asks</span>}
          {total > 1 && <span className="tabular-nums">{index + 1} of {total}</span>}
          <span>{remaining(request.expiresAtMs, now)}</span>
        </div>
        <IconButton icon={Cancel01Icon} label="Skip question" shape="circle" onClick={() => void decline()} disabled={busy !== null} className="-me-1 -mt-1 shrink-0 text-content-secondary" />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className={cn('break-words text-content-primary', PROMPT[layout])}>{question.question}</h2>

        {question.url && (
          <div className="flex flex-col items-start gap-1">
            <button type="button" onClick={() => void window.clawmuse.shell.openExternal(question.url!)} className="flex items-center gap-1 text-body-sm font-medium text-muse-blue hover:underline">
              Open link
              <Icon icon={ArrowUpRight01Icon} size={14} className="text-muse-blue" />
            </button>
            <p className="text-footnote text-content-secondary">Finish that step in your browser, then answer here.</p>
          </div>
        )}

        {binding && <CredentialDetails question={question} hostsDraft={hostsDraft} onHostsChange={setHostsDraft} disabled={busy !== null} />}

        {question.options.length > 0 && (
          <div role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.question} className="flex flex-col">
            {question.options.map((option, position) => {
              const checked = draft?.selected.includes(option.label) ?? false
              return (
                <button
                  key={option.label}
                  type="button"
                  role={question.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={checked}
                  aria-posinset={position + 1}
                  aria-setsize={question.options.length}
                  disabled={busy !== null}
                  onClick={() => choose(option.label)}
                  className={cn(OPTION_ROW, position > 0 && OPTION_DIVIDER)}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body text-content-primary">{option.label}</span>
                    {option.description && <span className="text-footnote text-content-secondary">{option.description}</span>}
                  </span>
                  {checked && <Icon icon={Tick02Icon} size={20} className="shrink-0 text-muse-blue" />}
                </button>
              )
            })}
          </div>
        )}

        {acceptsText && (question.isSecret ? (
          <input
            type="password"
            autoComplete="off"
            aria-label={binding ? `Value for ${binding.name}` : question.question}
            placeholder={binding ? binding.name : 'Type your answer'}
            value={draft?.other ?? ''}
            disabled={busy !== null}
            onChange={(event) => type(event.target.value)}
            onKeyDown={onFieldKeyDown}
            className={cn(FIELD, 'h-10')}
          />
        ) : (
          <textarea
            rows={2}
            aria-label={question.options.length > 0 ? `Your own answer for ${question.header || question.question}` : question.question}
            placeholder="Type your answer"
            value={draft?.other ?? ''}
            disabled={busy !== null}
            onChange={(event) => type(event.target.value)}
            onKeyDown={onFieldKeyDown}
            className={FIELD}
          />
        ))}
      </div>

      {error && <p role="alert" className="text-footnote text-error">Could not send your answer: {error}</p>}

      <div className="flex items-center gap-2">
        {index > 0 && (
          <button type="button" disabled={busy !== null} onClick={() => setIndex(index - 1)} className={QUIET_BUTTON}>
            Back
          </button>
        )}
        <button type="button" disabled={!canAdvance} onClick={advance} className={PRIMARY_BUTTON}>
          {busy === 'submit' ? 'Sending…' : busy === 'skip' ? 'Skipping…' : isLast ? 'Submit' : 'Next'}
        </button>
      </div>
    </section>
  )
}

/** What a credential request will do with the value, before the user types it. */
function CredentialDetails({ question, hostsDraft, onHostsChange, disabled }: { question: AgentQuestion; hostsDraft: string | undefined; onHostsChange: (value: string) => void; disabled: boolean }) {
  const binding = question.secretStore!
  const existing = question.secretStoreExisting
  return (
    <div className="flex flex-col gap-2 text-footnote text-content-secondary">
      <p>
        Stored as <span className="font-medium text-content-primary">{binding.name}</span>
        {STORE_KIND[binding.kind]}
      </p>
      {binding.reason && <p className="break-words">{binding.reason}</p>}
      {existing && (
        <p>
          Replaces the value saved {new Date(existing.updatedAtMs).toLocaleString()}
          {existing.updatedBy ? ` by ${existing.updatedBy}` : ''}.
        </p>
      )}
      {binding.kind === 'secret' && (
        <label className="flex flex-col gap-1">
          <span className="font-medium text-content-primary">Allowed hosts</span>
          <input
            type="text"
            autoComplete="off"
            value={hostsDraft ?? binding.allowedHosts?.join(', ') ?? ''}
            disabled={disabled}
            onChange={(event) => onHostsChange(event.target.value)}
            className={cn(FIELD, 'h-10')}
          />
          <span>Comma-separated.</span>
        </label>
      )}
    </div>
  )
}

/**
 * The questions waiting on this thread, stacked above its composer the way
 * Muse stacks blocking confirmations. Renders nothing when there are none.
 */
export function PendingQuestions({ sessionKeys }: { sessionKeys: readonly string[] }) {
  const pending = useQuestionsStore((state) => state.pending)
  const mine = pending.filter((request) => questionInSessions(request, sessionKeys))
  if (mine.length === 0) return null
  return (
    <div className="flex flex-col">
      {mine.map((request) => <QuestionCard key={request.id} request={request} />)}
    </div>
  )
}
