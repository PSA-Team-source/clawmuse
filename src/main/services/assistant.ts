import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, Notification, app, nativeImage, powerMonitor } from 'electron'
import log from 'electron-log/main.js'
import {
  ASSISTANT_JOBS,
  DEFAULT_ASSISTANT_SETTINGS,
  DEFAULT_FEED_PROMPT,
  checkInBlocked,
  checkInRequest,
  dailyDue,
  atLocal,
  feedQueriesRequest,
  feedWriteRequest,
  ideasRequest,
  isLegacyAppRunChat,
  isUserChat,
  mergeNews,
  parseAssistantSettings,
  parseCheckIn,
  parseEdition,
  parseIdeas,
  parseQueries,
  type AssistantContext,
  type AssistantJob,
  type AssistantSettings,
  type AssistantState,
  type CheckIn,
  type FeedUnit,
  type Goal,
  type Idea,
  type JobStatus,
} from '@shared/assistant'
import { allowedNumbers, computeWeekFacts, hasActivity, isAppPrompt, nextRecapAt, recapDue, recapRequest, parseRecap, recapSlot, weekOf, type UserMessage, type WeeklyRecap } from '@shared/recap'
import { PROTOCOL, resourcePath } from '../env.js'
import { handleDeepLink } from './deeplink.js'
import { run } from './local-runtime/exec.js'
import { PROFILE, openclawEnv, paths } from './local-runtime/paths.js'
import { findClaudeBin } from './local-runtime/claude-cli.js'
import { resolveOpenclaw } from './local-runtime/resolve.js'
import { searchNews } from './news.js'

/**
 * The built-in assistant engine: Feed, Ideas, check-ins and the Weekly Recap run here, in main,
 * so they keep working with every window closed (the app lives on in the
 * tray) and never create a chat.
 *
 * - Model work is `openclaw infer model run` — one tool-free completion with
 *   no session or transcript.
 * - A check-in is delivered with the gateway's own `chat.inject` (an assistant
 *   note in the Main chat, no agent run), so answering it is just chatting.
 * - Presence comes from the OS (`powerMonitor`), which is why the check-in
 *   gate lives in the app rather than in OpenClaw's heartbeat: the gateway
 *   cannot tell whether anyone is at this Mac.
 */

const MAIN_SESSION_KEY = 'webchat:main'
const TICK_MS = 60_000
const INFER_TIMEOUT_MS = 180_000
const FEED_CAP = 60
const CHECKIN_HISTORY = 50
const RECAP_HISTORY = 12
/** An undelivered check-in older than this is stale — dropped, not sent late. */
const PENDING_TTL_MS = 2 * 3600_000

interface Persisted extends Omit<AssistantState, 'available'> {
  context: AssistantContext
  lastEvaluatedAt: string | null
  legacyImported: boolean
  /** The side chats old Feed/Ideas runs left behind have been archived. */
  oldChatsArchived: boolean
  /** When the app last told the engine what it knows (goals, asks). Null until the first sync — nothing is scheduled before then. */
  contextAt: string | null
}

const JOBS = ASSISTANT_JOBS
const idleJob = (): JobStatus => ({ running: null, lastRunAt: null, lastSuccessAt: null, lastError: null, note: null, nextRunAt: null })

const file = () => join(app.getPath('userData'), 'assistant.json')

function fresh(): Persisted {
  return {
    settings: { ...DEFAULT_ASSISTANT_SETTINGS },
    feedPrompt: DEFAULT_FEED_PROMPT,
    feed: [],
    hiddenFeed: [],
    likedFeed: [],
    ideas: [],
    hiddenIdeas: [],
    checkIns: [],
    pendingCheckIn: null,
    recaps: [],
    jobs: { feed: idleJob(), ideas: idleJob(), checkin: idleJob(), recap: idleJob() },
    context: { goals: [], recentAsks: [], lastUserMessageAt: null, notificationsEnabled: true },
    lastEvaluatedAt: null,
    legacyImported: false,
    oldChatsArchived: false,
    contextAt: null,
  }
}

const strings = (value: unknown, cap: number): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, cap) : [])

function load(): Persisted {
  const base = fresh()
  try {
    if (!existsSync(file())) return base
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Persisted>
    const jobs = { ...base.jobs }
    for (const job of JOBS) {
      // A run cannot survive a restart: whatever was "running" was cut off.
      // An interrupted run was not a failed attempt, so it does not wait out
      // the retry pause either — a missed edition catches up on next launch.
      const saved = raw.jobs?.[job]
      if (saved) jobs[job] = { ...idleJob(), ...saved, running: null, ...(saved.running ? { lastRunAt: saved.lastSuccessAt } : {}) }
    }
    return {
      ...base,
      settings: parseAssistantSettings(raw.settings),
      feedPrompt: typeof raw.feedPrompt === 'string' && raw.feedPrompt.trim() ? raw.feedPrompt : base.feedPrompt,
      feed: Array.isArray(raw.feed) ? raw.feed : [],
      hiddenFeed: strings(raw.hiddenFeed, 2000),
      likedFeed: strings(raw.likedFeed, 2000),
      ideas: Array.isArray(raw.ideas) ? raw.ideas : [],
      hiddenIdeas: strings(raw.hiddenIdeas, 2000),
      checkIns: Array.isArray(raw.checkIns) ? raw.checkIns : [],
      pendingCheckIn: raw.pendingCheckIn ?? null,
      recaps: Array.isArray(raw.recaps) ? raw.recaps.slice(0, RECAP_HISTORY) : [],
      jobs,
      context: { ...base.context, ...raw.context },
      lastEvaluatedAt: raw.lastEvaluatedAt ?? null,
      legacyImported: raw.legacyImported === true,
      oldChatsArchived: raw.oldChatsArchived === true,
      contextAt: typeof raw.contextAt === 'string' ? raw.contextAt : null,
    }
  } catch (err) {
    log.warn('[assistant] state unreadable, starting fresh:', (err as Error).message)
    return base
  }
}

let state: Persisted | null = null
let available = false
let timer: NodeJS.Timeout | null = null
let ticking = false
let awaySince: number | null = null
const controllers = new Map<AssistantJob, AbortController>()
const reruns = new Set<AssistantJob>()

function current(): Persisted {
  state ??= load()
  return state
}

function save(): void {
  const target = file()
  try {
    // Atomic: a crash mid-write leaves the previous file, never half of one.
    writeFileSync(`${target}.tmp`, JSON.stringify(current()))
    renameSync(`${target}.tmp`, target)
  } catch (err) {
    log.warn('[assistant] could not persist:', (err as Error).message)
  }
}

export function getAssistantState(): AssistantState {
  const { context: _context, lastEvaluatedAt: _evaluated, legacyImported: _imported, oldChatsArchived: _archived, contextAt: _contextAt, ...visible } = current()
  return { ...visible, jobs: withNextRuns(visible.jobs, visible.settings), available }
}

function publish(): void {
  save()
  const snapshot = getAssistantState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('assistant-state', snapshot)
  }
}

function setJob(job: AssistantJob, patch: Partial<JobStatus>): void {
  const s = current()
  s.jobs = { ...s.jobs, [job]: { ...s.jobs[job], ...patch } }
  publish()
}

function nextDaily(now: Date, time: string, lastSuccessAt: string | null): string {
  const slot = atLocal(now, time)
  const doneToday = lastSuccessAt !== null && Date.parse(lastSuccessAt) >= slot.getTime()
  if (now < slot || !doneToday) return (now < slot ? slot : now).toISOString()
  slot.setDate(slot.getDate() + 1)
  return slot.toISOString()
}

function withNextRuns(jobs: Record<AssistantJob, JobStatus>, settings: AssistantSettings): Record<AssistantJob, JobStatus> {
  const now = new Date()
  return {
    feed: { ...jobs.feed, nextRunAt: settings.dailyFeed ? nextDaily(now, settings.feedTime, jobs.feed.lastSuccessAt) : null },
    ideas: { ...jobs.ideas, nextRunAt: settings.dailyIdeas ? nextDaily(now, settings.feedTime, jobs.ideas.lastSuccessAt) : null },
    checkin: { ...jobs.checkin, nextRunAt: null },
    recap: { ...jobs.recap, nextRunAt: settings.weeklyRecap ? nextRecapAt(now, settings, jobs.recap.lastSuccessAt).toISOString() : null },
  }
}

// ── OpenClaw calls ─────────────────────────────────────────────────────────

async function openclawBin(): Promise<string> {
  const bin = (await resolveOpenclaw())?.bin
  if (!bin) throw new Error('The local agent is not installed yet')
  return bin
}

/** Parses the CLI's JSON envelope; log lines may precede it on stdout. */
function envelope(stdout: string): Record<string, unknown> | null {
  const start = stdout.search(/^\{/m)
  if (start < 0) return null
  try {
    return JSON.parse(stdout.slice(start)) as Record<string, unknown>
  } catch {
    return null
  }
}

function envelopeError(data: Record<string, unknown> | null, fallback: string): string {
  const error = data?.error
  const message = typeof error === 'string' ? error : (error as { message?: unknown } | undefined)?.message
  return typeof message === 'string' && message.trim() ? message.trim() : fallback
}

/**
 * One tool-free completion with the user's configured model.
 *
 * `thinking` is explicit: these are structured writing/extraction tasks, and
 * the chat's default reasoning level (often "high") turned a 9-second edition
 * into a multi-minute one on reasoning models.
 */
async function infer(prompt: string, signal: AbortSignal, thinking: 'off' | 'low'): Promise<string> {
  const claude = await claudeRuntimeBin()
  if (claude) return inferWithClaude(claude, prompt, signal)
  const result = await run(await openclawBin(), ['--profile', PROFILE, 'infer', 'model', 'run', '--thinking', thinking, '--prompt', prompt, '--json'], { env: openclawEnv(), timeoutMs: INFER_TIMEOUT_MS, signal })
  if (signal.aborted) throw new AbortError()
  if (result.timedOut) throw new Error('The model took too long to answer')
  const data = envelope(result.stdout)
  if (!data?.ok) throw new Error(envelopeError(data, 'The model call failed'))
  const text = (Array.isArray(data.outputs) ? data.outputs : []).map((output) => (output as { text?: unknown }).text).filter((text): text is string => typeof text === 'string').join('\n').trim()
  if (!text) throw new Error('The model returned an empty answer')
  return text
}

/**
 * The Claude Code binary when the configured model runs through it
 * (`agentRuntime: claude-cli`), else null. `infer model run` is a raw provider
 * call that needs an API key, so it cannot use that login.
 */
async function claudeRuntimeBin(): Promise<string | null> {
  try {
    const config = JSON.parse(readFileSync(paths.config, 'utf8')) as { agents?: { defaults?: { model?: { primary?: string }; models?: Record<string, { agentRuntime?: { id?: string } }> } } }
    const defaults = config.agents?.defaults
    const primary = defaults?.model?.primary
    if (!primary || defaults?.models?.[primary]?.agentRuntime?.id !== 'claude-cli') return null
  } catch {
    return null
  }
  return findClaudeBin()
}

/**
 * One tool-free completion through Claude Code's print mode, on the user's
 * Claude login. Sonnet, not the chat's model: these are short background jobs
 * and should not spend the plan's Opus limits. Run from the app's own data
 * directory so no project instructions ride along.
 */
async function inferWithClaude(bin: string, prompt: string, signal: AbortSignal): Promise<string> {
  const result = await run(bin, ['-p', prompt, '--output-format', 'json', '--tools', '', '--model', 'sonnet'], { cwd: app.getPath('userData'), timeoutMs: INFER_TIMEOUT_MS, signal })
  if (signal.aborted) throw new AbortError()
  if (result.timedOut) throw new Error('The model took too long to answer')
  let data: { result?: unknown; is_error?: unknown } | null = null
  try {
    data = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as { result?: unknown; is_error?: unknown }
  } catch { /* reported below */ }
  const text = typeof data?.result === 'string' ? data.result.trim() : ''
  if (!data || data.is_error === true || !text) throw new Error(text || result.stderr.trim().split('\n').pop() || 'Claude Code did not answer')
  return text
}

async function gatewayCall(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await run(await openclawBin(), ['--profile', PROFILE, 'gateway', 'call', method, '--params', JSON.stringify(params), '--json', '--timeout', '15000'], { env: openclawEnv(), timeoutMs: 30_000 })
  const data = envelope(result.stdout)
  if (!data || data.ok === false || result.code !== 0) throw new Error(envelopeError(data, `${method} failed`))
  return data
}

class AbortError extends Error {
  constructor() {
    super('Stopped')
  }
}

/** Transient model/network failures get two more tries; a Stop never retries. */
async function withRetry<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let lastError: unknown
  for (const delay of [0, 3_000, 10_000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    if (signal.aborted) throw new AbortError()
    try {
      return await work()
    } catch (err) {
      if (err instanceof AbortError || signal.aborted) throw new AbortError()
      lastError = err
    }
  }
  throw lastError
}

// ── Jobs ───────────────────────────────────────────────────────────────────

function openGoals(): Goal[] {
  return current().context.goals.filter((goal) => !goal.completed)
}

/** Keeps a picture only if it actually loads (a 48px copy is fetched and decoded) — no broken image ever reaches the Feed. */
async function usableHero(url: string): Promise<boolean> {
  try {
    const small = new URL(url)
    small.searchParams.set('w', '48')
    small.searchParams.set('h', '27')
    const response = await fetch(small, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return false
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()))
    return !image.isEmpty()
  } catch {
    return false
  }
}

async function feedJob(signal: AbortSignal): Promise<string | null> {
  const s = current()
  setJob('feed', { running: { phase: 'Choosing what to look up…', startedAt: new Date().toISOString() } })
  const reply = await withRetry(() => infer(feedQueriesRequest(s.feedPrompt, s.context.goals, s.context.recentAsks), signal, 'off'), signal)
  const queries = parseQueries(reply) ?? openGoals().map((goal) => goal.title).slice(0, 3)
  if (queries.length === 0) throw new Error("I couldn't work out what to look up. Add a goal or edit the feed prompt.")

  setJob('feed', { running: { phase: 'Reading the latest news…', startedAt: s.jobs.feed.running?.startedAt ?? new Date().toISOString() } })
  const batches = await Promise.all(queries.map((query) => searchNews(query, 5).catch((err: Error) => {
    log.warn('[assistant] news search failed:', query, err.message)
    return []
  })))
  if (signal.aborted) throw new AbortError()
  const news = mergeNews(batches)
  if (news.length === 0) throw new Error("I couldn't find recent news for these topics. I'll try again later.")

  setJob('feed', { running: { phase: 'Writing your feed from the latest news…', startedAt: current().jobs.feed.running?.startedAt ?? new Date().toISOString() } })
  const edition = await withRetry(() => infer(feedWriteRequest(s.feedPrompt, s.context.goals, news), signal, 'off'), signal)
  const at = new Date().toISOString()
  const units = parseEdition(Date.now().toString(36), edition, news, at)
  if (units.length === 0) throw new Error("I couldn't turn the news into an edition. I'll try again later.")
  const heroes = await Promise.all(units.map((unit) => (unit.image ? usableHero(unit.image) : false)))
  units.forEach((unit, index) => { if (!heroes[index]) delete unit.image })
  const next = current()
  next.feed = [...units, ...next.feed].slice(0, FEED_CAP)
  return null
}

async function ideasJob(signal: AbortSignal): Promise<string | null> {
  const s = current()
  setJob('ideas', { running: { phase: 'Thinking of ideas for you…', startedAt: new Date().toISOString() } })
  const reply = await withRetry(() => infer(ideasRequest(s.context.goals, s.context.recentAsks), signal, 'low'), signal)
  const ideas = parseIdeas(reply, `i${Date.now().toString(36)}`)
  if (ideas.length === 0) throw new Error("I couldn't turn that into ideas. I'll try again later.")
  current().ideas = ideas
  return null
}

async function deliver(checkIn: CheckIn): Promise<void> {
  // No `label`: the gateway prints it into the message as "[Check-in]", which reads as machine text.
  try {
    await gatewayCall('chat.inject', { sessionKey: MAIN_SESSION_KEY, message: checkIn.message })
  } catch (err) {
    // No Main chat yet (never used): nothing to post into — not a failure to retry.
    if (/session not found/i.test((err as Error).message)) {
      current().pendingCheckIn = null
      throw new Error('Say hi in Main chat first — check-ins arrive there.', { cause: err })
    }
    throw err
  }
  // Best effort: the unread dot is a nicety; the message itself already landed.
  await gatewayCall('sessions.patch', { key: MAIN_SESSION_KEY, unread: true }).catch(() => undefined)
  const s = current()
  s.checkIns = [checkIn, ...s.checkIns].slice(0, CHECKIN_HISTORY)
  s.pendingCheckIn = null
  notify('check-in', checkIn.message, 'chat')
}

/** A banner for something the assistant delivered; clicking it opens `route`. */
function notify(what: string, message: string, route: string, title = 'ClawMuse'): void {
  if (!current().context.notificationsEnabled || !Notification.isSupported()) {
    log.info(`[assistant] ${what} notification skipped: notifications off or unsupported`)
    return
  }
  // Someone looking at the app sees the message land; a banner on top is noise.
  if (BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused())) {
    log.info(`[assistant] ${what} notification skipped: app is focused`)
    return
  }
  const notification = new Notification({ title, body: message.length > 180 ? `${message.slice(0, 177)}…` : message, icon: resourcePath('icon.png') })
  notification.on('click', () => handleDeepLink(`${PROTOCOL}://${route}`))
  // macOS reports neither a denied permission nor Focus mode; these two lines
  // are how a "never saw the banner" report gets diagnosed.
  notification.on('show', () => log.info(`[assistant] ${what} notification shown`))
  notification.on('failed', (_event, error) => log.warn(`[assistant] ${what} notification failed:`, error))
  notification.show()
}

async function checkInJob(signal: AbortSignal, manual: boolean): Promise<string | null> {
  const s = current()
  if (s.pendingCheckIn) {
    setJob('checkin', { running: { phase: 'Sending…', startedAt: new Date().toISOString() } })
    await deliver(s.pendingCheckIn)
    return null
  }
  setJob('checkin', { running: { phase: 'Seeing if there is anything worth saying…', startedAt: new Date().toISOString() } })
  const now = new Date()
  const reply = await withRetry(() => infer(checkInRequest({
    now,
    goals: s.context.goals,
    recentAsks: s.context.recentAsks,
    hoursSinceUser: s.context.lastUserMessageAt === null ? null : (now.getTime() - s.context.lastUserMessageAt) / 3600_000,
    feed: s.feed.filter((unit) => !s.hiddenFeed.includes(unit.id)),
    ideas: s.ideas.filter((idea) => !s.hiddenIdeas.includes(idea.id)),
    previous: s.checkIns,
  }), signal, 'low'), signal)
  s.lastEvaluatedAt = now.toISOString()
  const message = parseCheckIn(reply)
  if (!message) return manual ? 'Nothing specific to say right now — I will message you when there is.' : null
  const checkIn = { at: now.toISOString(), message }
  s.pendingCheckIn = checkIn
  save()
  await deliver(checkIn)
  return null
}

// ── Weekly Recap ───────────────────────────────────────────────────────────

/** A transcript entry's text, whether stored as a string or as content blocks. */
function entryText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block) => (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : '')).join('')
}

/**
 * Every message the user sent in their own chats since `since`, read from the
 * gateway's transcripts (archived chats included) — or null when that cannot
 * be read completely, so the recap leaves message counts out rather than
 * printing a short one.
 */
async function userMessagesSince(since: number): Promise<UserMessage[] | null> {
  try {
    const sessions: Record<string, unknown>[] = []
    for (const archived of [false, true]) {
      const data = await gatewayCall('sessions.list', { limit: 500, ...(archived ? { archived: true } : {}) })
      const list = (data.sessions ?? (data.result as { sessions?: unknown } | undefined)?.sessions) as Record<string, unknown>[] | undefined
      if (!Array.isArray(list) || data.hasMore === true) return null
      sessions.push(...list)
    }
    const moved = (entry: Record<string, unknown>) => Math.max(...[entry.lastInteractionAt, entry.lastActivityAt, entry.endedAt, entry.updatedAt].map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)))
    const keys = [...new Set(sessions.filter((entry) => typeof entry.key === 'string' && isUserChat(entry.key) && moved(entry) >= since).map((entry) => entry.key as string))]
    const messages: UserMessage[] = []
    for (const key of keys) {
      const data = await gatewayCall('chat.history', { sessionKey: key, limit: 1000 })
      const entries = (Array.isArray(data.messages) ? data.messages : []) as Record<string, unknown>[]
      const stamps = entries.map((entry) => (typeof entry.timestamp === 'number' ? entry.timestamp : Number.NaN))
      // ponytail: one page of up to 1000 entries per chat. A chat busier than
      // that in one week makes the counts incomplete, so they are left out;
      // paging with `cursor` would lift the ceiling.
      if (data.hasMore === true && !(Math.min(...stamps.filter(Number.isFinite)) < since)) return null
      entries.forEach((entry, index) => {
        const at = stamps[index]!
        if (entry.role === 'user' && at >= since && !isAppPrompt(entryText(entry.content))) messages.push({ chat: key, at })
      })
    }
    return messages
  } catch (err) {
    log.warn('[assistant] recap could not read chat history:', (err as Error).message)
    return null
  }
}

async function recapJob(signal: AbortSignal, manual: boolean): Promise<string | null> {
  const s = current()
  setJob('recap', { running: { phase: 'Looking back at your week…', startedAt: new Date().toISOString() } })
  const now = new Date()
  // The scheduled recap covers the week of its Sunday slot (a Monday catch-up
  // still recaps last week); Generate now recaps the week so far.
  const week = weekOf(manual ? now : recapSlot(now, s.settings))
  const userMessages = await userMessagesSince(week.start.getTime())
  if (signal.aborted) throw new AbortError()
  const facts = computeWeekFacts({ week, now, goals: s.context.goals, feed: s.feed, feedAtCap: s.feed.length >= FEED_CAP, checkIns: s.checkIns, userMessages })
  if (!hasActivity(facts)) return 'Nothing to recap for this week yet.'

  setJob('recap', { running: { phase: 'Writing your weekly recap…', startedAt: current().jobs.recap.running?.startedAt ?? now.toISOString() } })
  const feedTitles = s.feed.filter((unit) => Date.parse(unit.at) >= week.start.getTime() && Date.parse(unit.at) < week.end.getTime()).map((unit) => unit.title)
  const previousFocus = s.recaps.find((recap) => recap.facts.weekStart !== facts.weekStart)?.focus
  const allowed = allowedNumbers(facts, s.context.goals)
  const written = await withRetry(async () => {
    const parsed = parseRecap(await infer(recapRequest({ facts, goals: s.context.goals, feedTitles, previousFocus }), signal, 'low'), allowed)
    if (!parsed) throw new Error("I couldn't write a recap that sticks to your real numbers. I'll try again later.")
    return parsed
  }, signal)
  const recap: WeeklyRecap = { id: `r${Date.now().toString(36)}`, at: new Date().toISOString(), facts, ...written }
  // One recap per week: a regenerated one replaces the week's earlier recap.
  const next = current()
  next.recaps = [recap, ...next.recaps.filter((entry) => entry.facts.weekStart !== facts.weekStart)].slice(0, RECAP_HISTORY)
  notify('recap', recap.text, 'feed', 'Your week with ClawMuse')
  return null
}

/** Runs one job; concurrent requests for the same job join the running one. */
export async function runAssistantJob(job: AssistantJob, manual = false): Promise<void> {
  if (!available) {
    available = Boolean(await resolveOpenclaw())
    if (!available) {
      setJob(job, { lastError: 'The local agent is not installed yet' })
      return
    }
  }
  if (controllers.has(job)) {
    // Asked again mid-run (new goals, a second Generate): that run started
    // from the old context, so one more follows it rather than being dropped.
    if (manual) reruns.add(job)
    return
  }
  const controller = new AbortController()
  controllers.set(job, controller)
  const startedAt = new Date().toISOString()
  setJob(job, { running: { phase: 'Starting…', startedAt }, lastRunAt: startedAt, lastError: null, note: null })
  try {
    const note = job === 'feed' ? await feedJob(controller.signal) : job === 'ideas' ? await ideasJob(controller.signal) : job === 'recap' ? await recapJob(controller.signal, manual) : await checkInJob(controller.signal, manual)
    setJob(job, { running: null, lastSuccessAt: new Date().toISOString(), note })
  } catch (err) {
    const stopped = err instanceof AbortError
    const message = stopped ? null : (err as Error).message || 'Something went wrong'
    if (!stopped) log.warn(`[assistant] ${job} failed:`, message)
    // A check-in that was written but could not be delivered stays pending.
    setJob(job, { running: null, lastError: message })
  } finally {
    controllers.delete(job)
    if (reruns.delete(job)) void runAssistantJob(job, true)
  }
}

export function stopAssistantJob(job: AssistantJob): void {
  controllers.get(job)?.abort()
}

/**
 * Feed/Ideas used to run as chats, leaving one side chat per run in the
 * list. Archived (reversible, still searchable under Archived) once; the
 * flag is only set after every one of them was archived, so a gateway that
 * is down simply means another try on a later tick.
 */
async function archiveOldAppChats(): Promise<void> {
  const s = current()
  if (s.oldChatsArchived) return
  const data = await gatewayCall('sessions.list', { limit: 500 })
  const list = (data.sessions ?? (data.result as { sessions?: unknown } | undefined)?.sessions) as { key?: unknown; displayName?: unknown; sessionId?: unknown }[] | undefined
  if (!Array.isArray(list)) throw new Error('sessions.list returned no sessions')
  const stale = list.filter((session) => typeof session.key === 'string' && typeof session.displayName === 'string' && typeof session.sessionId === 'string' && isLegacyAppRunChat(session.key, session.displayName))
  for (const session of stale) {
    await gatewayCall('sessions.patch', { key: session.key, archived: true, expectedSessionId: session.sessionId })
  }
  if (stale.length) log.info(`[assistant] archived ${stale.length} side chats left by old Feed/Ideas runs`)
  s.oldChatsArchived = true
  save()
}

// ── Scheduler ──────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    available = Boolean(await resolveOpenclaw())
    if (!available) return
    const s = current()
    if (!s.oldChatsArchived) await archiveOldAppChats().catch((err: Error) => log.warn('[assistant] archiving old run chats failed:', err.message))
    const now = new Date()
    const idleSeconds = powerMonitor.getSystemIdleTime()

    // Back after a real absence: the "recently evaluated" pause no longer applies.
    if (idleSeconds >= 30 * 60) awaySince ??= now.getTime() - idleSeconds * 1000
    else if (awaySince !== null) {
      awaySince = null
      s.lastEvaluatedAt = null
    }

    if (s.pendingCheckIn && now.getTime() - Date.parse(s.pendingCheckIn.at) > PENDING_TTL_MS) {
      s.pendingCheckIn = null
      save()
    }

    // Nothing runs on a schedule before the app has shared what it knows — on a
    // first launch that is after the goals question, so the first edition is
    // built around the answer instead of nothing.
    if (!s.contextAt) return
    const hasContext = s.context.goals.some((goal) => !goal.completed) || s.context.recentAsks.length > 0
    if (s.settings.dailyFeed && dailyDue(now, s.settings.feedTime, s.jobs.feed.lastSuccessAt, s.jobs.feed.lastRunAt)) await runAssistantJob('feed')
    if (s.settings.dailyIdeas && dailyDue(now, s.settings.feedTime, s.jobs.ideas.lastSuccessAt, s.jobs.ideas.lastRunAt)) await runAssistantJob('ideas')
    if (recapDue(new Date(), s.settings, s.jobs.recap.lastSuccessAt, s.jobs.recap.lastRunAt)) await runAssistantJob('recap')

    const blocked = s.pendingCheckIn
      ? (idleSeconds > 5 * 60 ? 'away' : null)
      : checkInBlocked({
          now: new Date(),
          settings: s.settings,
          lastUserMessageAt: s.context.lastUserMessageAt,
          lastEvaluatedAt: s.lastEvaluatedAt,
          checkIns: s.checkIns,
          systemIdleSeconds: powerMonitor.getSystemIdleTime(),
          // A check-in is a reply to a relationship: not before the user has
          // said anything (and there is no Main chat to post into yet).
          hasContext: hasContext && s.context.lastUserMessageAt !== null,
        })
    if (!blocked) await runAssistantJob('checkin')
  } catch (err) {
    log.warn('[assistant] tick failed:', (err as Error).message)
  } finally {
    ticking = false
  }
}

export function startAssistant(): void {
  current()
  // Known before the first tick, so Generate is not disabled for the first minute.
  void resolveOpenclaw().then((resolved) => {
    available = Boolean(resolved)
    publish()
  })
  // Launch, wake and unlock are when a missed 07:00 edition should catch up.
  setTimeout(() => void tick(), 20_000)
  timer = setInterval(() => void tick(), TICK_MS)
  const soon = () => setTimeout(() => void tick(), 15_000)
  powerMonitor.on('resume', soon)
  powerMonitor.on('unlock-screen', soon)
}

export function stopAssistant(): void {
  if (timer) clearInterval(timer)
  timer = null
  for (const controller of controllers.values()) controller.abort()
}

// ── Renderer inputs (validated: this is a trust boundary) ──────────────────

const text = (value: unknown, cap: number): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, cap) : null)

function parseGoals(value: unknown): Goal[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap((item): Goal[] => {
    const goal = item as Partial<Goal> | null
    const title = text(goal?.title, 300)
    if (!goal || !title || typeof goal.id !== 'string') return []
    const completedAt = goal.completed === true && typeof goal.completedAt === 'string' && Number.isFinite(Date.parse(goal.completedAt)) ? goal.completedAt : undefined
    return [{ id: goal.id.slice(0, 100), title, completed: goal.completed === true, createdAt: typeof goal.createdAt === 'string' ? goal.createdAt : '', ...(completedAt ? { completedAt } : {}) }]
  })
}

export function syncAssistantContext(value: unknown): void {
  const raw = (value ?? {}) as Partial<Record<keyof AssistantContext, unknown>>
  const s = current()
  const lastUser = typeof raw.lastUserMessageAt === 'number' && Number.isFinite(raw.lastUserMessageAt) ? raw.lastUserMessageAt : null
  s.context = {
    goals: parseGoals(raw.goals),
    recentAsks: strings(raw.recentAsks, 8).map((ask) => ask.slice(0, 500)),
    // Never moves backwards: a window with an older view must not undo a newer message.
    lastUserMessageAt: Math.max(lastUser ?? 0, s.context.lastUserMessageAt ?? 0) || null,
    notificationsEnabled: raw.notificationsEnabled !== false,
  }
  s.contextAt = new Date().toISOString()
  save()
}

export function setAssistantSettings(value: unknown): AssistantState {
  const s = current()
  s.settings = parseAssistantSettings({ ...s.settings, ...(value && typeof value === 'object' ? value : {}) })
  publish()
  return getAssistantState()
}

export function setFeedPrompt(value: unknown): AssistantState {
  const prompt = text(value, 4000)
  if (prompt) {
    current().feedPrompt = prompt
    publish()
  }
  return getAssistantState()
}

export function markFeedUnit(id: unknown, action: unknown): AssistantState {
  const s = current()
  if (typeof id !== 'string') return getAssistantState()
  if (action === 'hide') s.hiddenFeed = [...new Set([...s.hiddenFeed, id])]
  else if (action === 'like') s.likedFeed = [...new Set([...s.likedFeed, id])]
  else if (action === 'unlike') s.likedFeed = s.likedFeed.filter((item) => item !== id)
  publish()
  return getAssistantState()
}

export function hideIdea(id: unknown): AssistantState {
  const s = current()
  if (typeof id === 'string') s.hiddenIdeas = [...new Set([...s.hiddenIdeas, id])]
  publish()
  return getAssistantState()
}

/** One-time move of what the renderer used to keep in localStorage. */
export function importLegacy(value: unknown): AssistantState {
  const s = current()
  if (s.legacyImported) return getAssistantState()
  const raw = (value ?? {}) as { feed?: unknown; ideas?: unknown; hiddenFeed?: unknown; likedFeed?: unknown; hiddenIdeas?: unknown; feedPrompt?: unknown }
  const feed = Array.isArray(raw.feed) ? raw.feed.filter((unit): unit is FeedUnit => Boolean(unit && typeof unit === 'object' && typeof (unit as FeedUnit).id === 'string' && typeof (unit as FeedUnit).body === 'string')).slice(0, FEED_CAP) : []
  const ideas = Array.isArray(raw.ideas) ? raw.ideas.filter((idea): idea is Idea => Boolean(idea && typeof idea === 'object' && typeof (idea as Idea).title === 'string')).slice(0, 30) : []
  if (!s.feed.length) s.feed = feed
  if (!s.ideas.length) s.ideas = ideas
  s.hiddenFeed = [...new Set([...s.hiddenFeed, ...strings(raw.hiddenFeed, 2000)])]
  s.likedFeed = [...new Set([...s.likedFeed, ...strings(raw.likedFeed, 2000)])]
  s.hiddenIdeas = [...new Set([...s.hiddenIdeas, ...strings(raw.hiddenIdeas, 2000)])]
  const prompt = text(raw.feedPrompt, 4000)
  if (prompt) s.feedPrompt = prompt
  s.legacyImported = true
  publish()
  return getAssistantState()
}
