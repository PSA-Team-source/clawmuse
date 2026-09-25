import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftValues, parseQuestionRequest, questionInSessions, resolveParams, useQuestionsStore } from '@/stores/questions.store'
import { gatewayWS } from '@/services/gateway-ws.service'

const NOW = 1_000_000
/** The record ask_user registers (question.requested / question.list row). */
const record = (overrides: Record<string, unknown> = {}) => ({
  id: 'ask_0123456789abcdef0123456789abcdef',
  questions: [
    { questionId: 'deploy_target', header: 'Target', question: 'Where should it deploy?', options: [{ label: 'Staging', description: 'Safe' }, { label: 'Production' }], isOther: true },
    { questionId: 'checks', header: 'Checks', question: 'Which checks?', options: [{ label: 'Lint' }, { label: 'Tests' }, { label: 'Types' }], multiSelect: true, isOther: true },
  ],
  agentId: 'main',
  sessionKey: 'agent:main:webchat:main:conv:abc',
  createdAtMs: NOW - 10,
  expiresAtMs: NOW + 900_000,
  status: 'pending',
  ...overrides,
})

describe('agent questions (ask_user)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useQuestionsStore.setState({ pending: [] })
  })

  it('parses a pending record and refuses anything unanswerable', () => {
    const parsed = parseQuestionRequest(record(), NOW)!
    expect(parsed.questions.map((q) => [q.questionId, q.multiSelect, q.isOther, q.options.length])).toEqual([['deploy_target', false, true, 2], ['checks', true, true, 3]])
    expect(parseQuestionRequest(record({ status: 'answered' }), NOW)).toBeNull()
    expect(parseQuestionRequest(record({ expiresAtMs: NOW }), NOW)).toBeNull()
    expect(parseQuestionRequest(record({ questions: [] }), NOW)).toBeNull()
    expect(parseQuestionRequest(record({ questions: [{ questionId: 'BadId', header: 'x', question: 'q', options: [] }] }), NOW)).toBeNull()
    // A credential binding is only answerable as one masked free-text question.
    const secret = { questionId: 'token', header: 'Token', question: 'Paste the token', options: [], isSecret: true, secretStore: { name: 'GITHUB_TOKEN', kind: 'secret', allowedHosts: ['api.github.com'] } }
    expect(parseQuestionRequest(record({ questions: [secret] }), NOW)?.questions[0]?.secretStore?.name).toBe('GITHUB_TOKEN')
    expect(parseQuestionRequest(record({ questions: [{ ...secret, isSecret: false }] }), NOW)).toBeNull()
  })

  it('builds the answers question.resolve validates against', () => {
    const request = parseQuestionRequest(record(), NOW)!
    const [single, multi] = request.questions
    // Single-select: typed text replaces the option, as the gateway allows one value.
    expect(draftValues(single!, { selected: ['Staging'], other: '  ' })).toEqual(['Staging'])
    expect(draftValues(single!, { selected: ['Staging'], other: ' eu-west ' })).toEqual(['eu-west'])
    // Multi-select: options in declared order, then the free text.
    expect(draftValues(multi!, { selected: ['Types', 'Lint'], other: 'e2e' })).toEqual(['Lint', 'Types', 'e2e'])
    expect(resolveParams(request, { deploy_target: { selected: ['Production'], other: '' }, checks: { selected: ['Tests'], other: '' } }))
      .toEqual({ id: request.id, answers: { answers: { deploy_target: ['Production'], checks: ['Tests'] } } })

    const secret = parseQuestionRequest(record({ questions: [{ questionId: 'token', header: 'Token', question: 'Paste it', options: [], isSecret: true, secretStore: { name: 'API_KEY', kind: 'secret', allowedHosts: ['a.io'] } }] }), NOW)!
    // Sent untrimmed; untouched hosts keep the agent's, edited ones are split and de-duplicated.
    expect(resolveParams(secret, { token: { selected: [], other: ' s3cret ' } })).toEqual({ id: secret.id, answers: { answers: { token: [' s3cret '] } }, secretStoreAllowedHosts: ['a.io'] })
    expect(resolveParams(secret, { token: { selected: [], other: 'x' } }, 'a.io, b.io a.io').secretStoreAllowedHosts).toEqual(['a.io', 'b.io'])
  })

  it('matches the gateway key to the app thread', () => {
    expect(questionInSessions({ sessionKey: 'agent:main:webchat:main:conv:abc' }, ['webchat:main:conv:abc'])).toBe(true)
    expect(questionInSessions({ sessionKey: 'agent:scout:webchat:main' }, ['webchat:main'])).toBe(false)
    expect(questionInSessions({ sessionKey: 'agent:scout:webchat:group:g1' }, ['agent:scout:webchat:group:g1'])).toBe(true)
    expect(questionInSessions({}, ['webchat:main'])).toBe(false)
  })

  it('tracks requested → resolved, reconciles on reconnect, and drops a question that already closed', async () => {
    const store = useQuestionsStore.getState()
    const live = record({ createdAtMs: Date.now(), expiresAtMs: Date.now() + 60_000 })
    store.handleEvent({ type: 'event', event: 'question.requested', payload: live })
    store.handleEvent({ type: 'event', event: 'question.requested', payload: live })
    expect(useQuestionsStore.getState().pending).toHaveLength(1)
    store.handleEvent({ type: 'event', event: 'question.resolved', payload: { id: live.id, status: 'expired' } })
    expect(useQuestionsStore.getState().pending).toHaveLength(0)

    // Reconnect: the list is the truth — a held question it omits is gone.
    store.handleEvent({ type: 'event', event: 'question.requested', payload: live })
    const other = { ...live, id: 'ask_ffffffffffffffffffffffffffffffff' }
    vi.spyOn(gatewayWS, 'call').mockResolvedValueOnce({ questions: [other] })
    await store.load()
    expect(useQuestionsStore.getState().pending.map((q) => q.id)).toEqual([other.id])

    // Answered elsewhere between render and click: dropped, not an error.
    const gone = Object.assign(new Error('already answered'), { detailReason: 'QUESTION_ALREADY_TERMINAL' })
    vi.spyOn(gatewayWS, 'call').mockRejectedValueOnce(gone)
    const request = useQuestionsStore.getState().pending[0]!
    await expect(store.answer(request, { deploy_target: { selected: ['Staging'], other: '' }, checks: { selected: ['Lint'], other: '' } })).resolves.toBe(false)
    expect(useQuestionsStore.getState().pending).toHaveLength(0)
  })
})

