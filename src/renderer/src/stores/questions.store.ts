import { create } from 'zustand'
import { gatewayErrorReason, gatewayWS } from '@/services/gateway-ws.service'
import { canonicalSessionKey } from '@/services/session-key'
import type { GatewayEventFrame } from '@/types'

/**
 * OpenClaw agent questions (`question.*`, gateway protocol 2026.7+).
 *
 * The agent's built-in `ask_user` tool registers a question with
 * `question.request`, broadcasts `question.requested`, and blocks in
 * `question.waitAnswer` until someone calls `question.resolve` — or the
 * deadline passes and the tool tells the model "No answer arrived; proceed with
 * best judgment." This store is the ClawMuse end of that contract: it holds the
 * pending questions, answers them, and forgets them on `question.resolved`
 * (answered here, in the Control UI, by a typed reply, cancelled, or expired).
 */

export interface QuestionOption {
  label: string
  description?: string
}

/** Where a credential answer is stored instead of being handed to the model (the `secrets` tool). */
export interface SecretStoreBinding {
  name: string
  kind: 'secret' | 'env'
  allowedHosts?: string[]
  reason?: string
}

export interface AgentQuestion {
  /** snake_case answer key. */
  questionId: string
  /** ≤ 12-character chip label. */
  header: string
  question: string
  /** 0 (free text only) or 2–4. */
  options: QuestionOption[]
  multiSelect: boolean
  /** A free-text answer is accepted alongside the options. */
  isOther: boolean
  isSecret: boolean
  /** An external step to complete before answering. */
  url?: string
  secretStore?: SecretStoreBinding
  secretStoreExisting?: { updatedAtMs: number; updatedBy?: string }
}

export interface QuestionRequest {
  /** Gateway record id — what `question.resolve` takes. */
  id: string
  /** 1–3, asked in order. */
  questions: AgentQuestion[]
  agentId?: string
  sessionKey?: string
  createdAtMs: number
  expiresAtMs: number
}

/** One question's draft: chosen option labels plus any free text. */
export interface QuestionDraft {
  selected: string[]
  other: string
}

const QUESTION_ID = /^[a-z][a-z0-9_]*$/
const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined)

function parseSecretStore(raw: unknown): SecretStoreBinding | null | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) return null
  const { name, kind, allowedHosts, reason } = raw
  if (typeof name !== 'string' || !SECRET_NAME.test(name) || (kind !== 'secret' && kind !== 'env')) return null
  if (allowedHosts !== undefined && (!Array.isArray(allowedHosts) || !allowedHosts.every((host) => typeof host === 'string' && host))) return null
  return {
    name,
    kind,
    ...(allowedHosts ? { allowedHosts: [...(allowedHosts as string[])] } : {}),
    ...(typeof reason === 'string' && reason ? { reason } : {}),
  }
}

function parseQuestion(raw: unknown): AgentQuestion | null {
  if (!isRecord(raw)) return null
  const questionId = nonEmpty(raw.questionId)
  const question = nonEmpty(raw.question)
  if (!questionId || !QUESTION_ID.test(questionId) || !question || typeof raw.header !== 'string') return null
  if (!Array.isArray(raw.options) || raw.options.length > 4 || raw.options.length === 1) return null
  const options: QuestionOption[] = []
  for (const option of raw.options) {
    if (!isRecord(option)) return null
    const label = nonEmpty(option.label)
    if (!label) return null
    options.push({ label, ...(typeof option.description === 'string' && option.description.trim() ? { description: option.description } : {}) })
  }
  const secretStore = parseSecretStore(raw.secretStore)
  if (secretStore === null) return null
  const existing = isRecord(raw.secretStoreExisting) && typeof raw.secretStoreExisting.updatedAtMs === 'number'
    ? { updatedAtMs: raw.secretStoreExisting.updatedAtMs, ...(nonEmpty(raw.secretStoreExisting.updatedBy) ? { updatedBy: raw.secretStoreExisting.updatedBy as string } : {}) }
    : undefined
  const url = nonEmpty(raw.url)
  return {
    questionId,
    // The gateway already caps it at 12; a longer one would break the chip.
    header: [...raw.header].slice(0, 12).join(''),
    question,
    options,
    multiSelect: raw.multiSelect === true,
    isOther: raw.isOther === true,
    isSecret: raw.isSecret === true,
    ...(url && /^https?:\/\//i.test(url) ? { url } : {}),
    ...(secretStore ? { secretStore } : {}),
    ...(existing ? { secretStoreExisting: existing } : {}),
  }
}

/**
 * A pending question as `question.requested` / `question.list` send it.
 *
 * Anything not pending, malformed or already past its deadline is `null`: an
 * unanswerable card is worse than none, because answering it can only fail.
 */
export function parseQuestionRequest(raw: unknown, now = Date.now()): QuestionRequest | null {
  if (!isRecord(raw)) return null
  const id = nonEmpty(raw.id)
  if (!id || (raw.status !== undefined && raw.status !== 'pending')) return null
  if (typeof raw.createdAtMs !== 'number' || typeof raw.expiresAtMs !== 'number' || raw.expiresAtMs <= now) return null
  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > 3) return null
  const questions = raw.questions.map(parseQuestion)
  if (questions.some((question) => question === null)) return null
  const parsed = questions as AgentQuestion[]
  // A credential request is one masked free-text question; any other shape
  // carrying a secret binding is not something this client may answer.
  if (parsed.some((question) => question.secretStore) && (parsed.length !== 1 || parsed[0]!.options.length > 0 || parsed[0]!.multiSelect || !parsed[0]!.isSecret)) return null
  const agentId = nonEmpty(raw.agentId)
  const sessionKey = nonEmpty(raw.sessionKey)
  return { id, questions: parsed, ...(agentId ? { agentId } : {}), ...(sessionKey ? { sessionKey } : {}), createdAtMs: raw.createdAtMs, expiresAtMs: raw.expiresAtMs }
}

/** Values one question's draft submits, in the order the gateway validates them. */
export function draftValues(question: AgentQuestion, draft: QuestionDraft | undefined): string[] {
  if (!draft) return []
  const selected = question.options.filter((option) => draft.selected.includes(option.label)).map((option) => option.label)
  const acceptsText = question.options.length === 0 || question.isOther
  // A credential is sent exactly as typed; everything else is trimmed, as the gateway would.
  const text = acceptsText ? (question.isSecret ? draft.other : draft.other.trim()) : ''
  if (!question.multiSelect && text) return [text]
  return text ? [...selected, text] : selected
}

export function draftComplete(question: AgentQuestion, draft: QuestionDraft | undefined): boolean {
  return draftValues(question, draft).length > 0
}

export interface ResolveParams {
  id: string
  answers: { answers: Record<string, string[]> }
  secretStoreAllowedHosts?: string[]
}

/**
 * The `question.resolve` params for a set of drafts.
 *
 * `hostsDraft` is the editable allowed-hosts line of a credential request;
 * left untouched (`undefined`) it keeps the hosts the agent asked for, as the
 * Control UI does.
 */
export function resolveParams(request: QuestionRequest, drafts: Record<string, QuestionDraft>, hostsDraft?: string): ResolveParams {
  const answers = Object.fromEntries(request.questions.map((question) => [question.questionId, draftValues(question, drafts[question.questionId])]))
  const binding = request.questions[0]?.secretStore
  const hosts = binding?.kind === 'secret'
    ? hostsDraft === undefined ? binding.allowedHosts : [...new Set(hostsDraft.split(/[,\s]+/u).map((host) => host.trim()).filter(Boolean))]
    : undefined
  return { id: request.id, answers: { answers }, ...(hosts ? { secretStoreAllowedHosts: hosts } : {}) }
}

/**
 * Whether a question belongs to one of these threads.
 *
 * The gateway reports the key as it stores it (`agent:main:webchat:main`),
 * while ClawMuse names the default bot's threads unprefixed (`webchat:main`);
 * `canonicalSessionKey` brings both to the app's form, and keys are compared
 * case-insensitively because the gateway folds case when it stores them.
 */
export function questionInSessions(request: Pick<QuestionRequest, 'sessionKey' | 'agentId'>, sessionKeys: readonly string[]): boolean {
  if (!request.sessionKey) return false
  const scoped = request.agentId && !request.sessionKey.startsWith('agent:') ? `agent:${request.agentId}:${request.sessionKey}` : request.sessionKey
  const key = canonicalSessionKey(scoped).toLowerCase()
  return sessionKeys.some((candidate) => canonicalSessionKey(candidate).toLowerCase() === key)
}

/** Reasons meaning "nobody is waiting for this any more" — drop it rather than show an error. */
const GONE = new Set(['QUESTION_ALREADY_TERMINAL', 'QUESTION_NOT_FOUND', 'QUESTION_REQUESTER_INACTIVE'])

/** One timer per pending question — the deadline is authoritative even if the `question.resolved` broadcast is missed. */
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

interface QuestionsState {
  /** Pending questions, oldest first. */
  pending: QuestionRequest[]
  handleEvent: (frame: GatewayEventFrame) => void
  /** Re-reads the gateway's pending list (connect / reconnect). */
  load: () => Promise<void>
  /** Sends the answers. Resolves `false` when the question had already closed. */
  answer: (request: QuestionRequest, drafts: Record<string, QuestionDraft>, hostsDraft?: string) => Promise<boolean>
  /** Declines to answer: the agent is told the question was cancelled and carries on. */
  skip: (id: string) => Promise<void>
}

export const useQuestionsStore = create<QuestionsState>((set, get) => {
  function drop(id: string): void {
    clearTimeout(expiryTimers.get(id))
    expiryTimers.delete(id)
    if (get().pending.some((item) => item.id === id)) set({ pending: get().pending.filter((item) => item.id !== id) })
  }

  function add(request: QuestionRequest, announce: boolean): void {
    if (get().pending.some((item) => item.id === request.id)) return
    set({ pending: [...get().pending, request].sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id)) })
    expiryTimers.set(request.id, setTimeout(() => drop(request.id), Math.max(0, request.expiresAtMs - Date.now())))
    // A blocked agent in a background window is exactly when the app must speak up.
    if (announce && !document.hasFocus()) {
      const first = request.questions[0]!
      void window.clawmuse?.notifications.show({
        title: 'Your agent has a question',
        body: first.secretStore ? `It needs ${first.secretStore.name} to continue.` : first.question,
        route: request.sessionKey ? `chat/${encodeURIComponent(canonicalSessionKey(request.sessionKey))}` : 'chat',
      })
    }
  }

  async function resolve(params: ResolveParams | { id: string; cancel: true }): Promise<boolean> {
    try {
      await gatewayWS.call('question.resolve', params)
      drop(params.id)
      return true
    } catch (error) {
      if (!GONE.has(gatewayErrorReason(error) ?? '')) throw error
      drop(params.id)
      return false
    }
  }

  return {
    pending: [],

    handleEvent(frame) {
      const payload = frame.payload ?? frame.data
      if (frame.event === 'question.requested') {
        const request = parseQuestionRequest(payload)
        if (request) add(request, true)
      } else if (frame.event === 'question.resolved') {
        const id = (payload as { id?: unknown } | undefined)?.id
        if (typeof id === 'string') drop(id)
      }
    },

    async load() {
      const raw = await gatewayWS.call<{ questions?: unknown[] }>('question.list', {}).catch(() => null)
      if (!raw || !Array.isArray(raw.questions)) return
      const live = raw.questions.map((entry) => parseQuestionRequest(entry)).filter((item): item is QuestionRequest => item !== null)
      const liveIds = new Set(live.map((item) => item.id))
      // Anything we held that the gateway no longer lists closed while we were away.
      for (const item of get().pending) if (!liveIds.has(item.id)) drop(item.id)
      for (const item of live) add(item, false)
    },

    answer(request, drafts, hostsDraft) {
      return resolve(resolveParams(request, drafts, hostsDraft))
    },

    async skip(id) {
      await resolve({ id, cancel: true })
    },
  }
})
