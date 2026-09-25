import type { WeeklyRecap } from './recap'

/**
 * ClawMuse's built-in assistant: Feed, Ideas, check-ins and the Weekly Recap.
 *
 * These are app functions, not chats. The main process runs them with
 * one-shot model calls (`openclaw infer model run`: no session, no tools, no
 * transcript), on its own schedule, and keeps the results in its own state
 * file. Only a check-in the model decides is worth sending reaches a chat — as
 * an assistant message in the Main chat, which the user can simply answer.
 *
 * Everything here is pure (prompts, parsers, schedule rules) so main and
 * renderer share one copy and it is testable without Electron.
 */

export interface Goal {
  id: string
  title: string
  completed: boolean
  createdAt: string
  /** When it was ticked off; goals completed before this was recorded have none. */
  completedAt?: string
}

export interface NewsItem {
  title: string
  /** The publisher's article (never an aggregator redirect when one can be unwrapped). */
  url: string
  source?: string
  publishedAt?: string
  /** The feed's own snippet of the article — what the writer grounds its sentences in. */
  summary?: string
  /** The article's thumbnail as the news index serves it; absent means no picture. */
  image?: string
}

export interface FeedSource {
  title: string
  url: string
  source?: string
}

/** One titled card of a Feed edition. */
export interface FeedUnit {
  id: string
  title: string
  body: string
  at: string
  /** Hero picture from the lead source's article; units without one show none. */
  image?: string
  /** The headlines the unit was written from, linked in its byline. */
  sources?: FeedSource[]
}

/** Muse's Ideas: things the agent offers to do, in its own voice. */
export interface Idea {
  id: string
  emoji?: string
  /** An offer in the agent's voice, e.g. "I can audit your Stripe rate". */
  title: string
  description: string
  /** Section heading; the first ideas of a batch are featured (no heading). */
  category: string
}

export interface CheckIn {
  at: string
  message: string
}

/** What the renderer knows and main needs for background runs (goals live in the renderer). */
export interface AssistantContext {
  goals: Goal[]
  /** The user's own recent requests, newest first. */
  recentAsks: string[]
  /** Epoch ms of the user's last message to the agent in any of their chats. */
  lastUserMessageAt: number | null
  notificationsEnabled: boolean
}

export interface AssistantSettings {
  /** Message me in the Main chat when there is something worth saying. */
  checkIns: boolean
  checkInsPerDay: 1 | 2 | 4
  /** Local "HH:MM" window check-ins may land in. */
  activeStart: string
  activeEnd: string
  /** Write a Feed edition every day at `feedTime` (local "HH:MM"). */
  dailyFeed: boolean
  feedTime: string
  /** Refresh Ideas once a day. */
  dailyIdeas: boolean
  /** Write a Weekly Recap on Sunday evening. */
  weeklyRecap: boolean
}

export type AssistantJob = 'feed' | 'ideas' | 'checkin' | 'recap'

export const ASSISTANT_JOBS: readonly AssistantJob[] = ['feed', 'ideas', 'checkin', 'recap']

export interface JobStatus {
  /** Set while the job runs; the phase the UI shows. */
  running: null | { phase: string; startedAt: string }
  lastRunAt: string | null
  lastSuccessAt: string | null
  /** The real reason the last run failed, shown as-is. */
  lastError: string | null
  /** A non-error outcome worth saying, e.g. "Nothing specific to say right now." */
  note: string | null
  /** When the scheduler will next consider this job, if it will. */
  nextRunAt: string | null
}

export interface AssistantState {
  settings: AssistantSettings
  feedPrompt: string
  feed: FeedUnit[]
  hiddenFeed: string[]
  likedFeed: string[]
  ideas: Idea[]
  hiddenIdeas: string[]
  checkIns: CheckIn[]
  /** A check-in written but not yet delivered (the gateway was down); retried, then dropped. */
  pendingCheckIn: CheckIn | null
  /** Weekly Recaps, newest first. */
  recaps: WeeklyRecap[]
  jobs: Record<AssistantJob, JobStatus>
  /** False when the local agent CLI is not installed — nothing can run. */
  available: boolean
}

export const DEFAULT_FEED_PROMPT = 'Make me a feed about my interests. Keep the tone clear and direct. Ensure it is quick to skim. Try to avoid clickbait.'

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  checkIns: true,
  checkInsPerDay: 2,
  activeStart: '09:00',
  activeEnd: '21:00',
  dailyFeed: true,
  feedTime: '07:00',
  dailyIdeas: true,
  weeklyRecap: true,
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Settings as stored or sent: anything malformed falls back to its default. */
export function parseAssistantSettings(value: unknown): AssistantSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof AssistantSettings, unknown>>
  const bool = (key: 'checkIns' | 'dailyFeed' | 'dailyIdeas' | 'weeklyRecap') => (typeof raw[key] === 'boolean' ? raw[key] as boolean : DEFAULT_ASSISTANT_SETTINGS[key])
  const time = (key: 'activeStart' | 'activeEnd' | 'feedTime') => (typeof raw[key] === 'string' && HHMM.test(raw[key] as string) ? raw[key] as string : DEFAULT_ASSISTANT_SETTINGS[key])
  return {
    checkIns: bool('checkIns'),
    checkInsPerDay: raw.checkInsPerDay === 1 || raw.checkInsPerDay === 2 || raw.checkInsPerDay === 4 ? raw.checkInsPerDay : DEFAULT_ASSISTANT_SETTINGS.checkInsPerDay,
    activeStart: time('activeStart'),
    activeEnd: time('activeEnd'),
    dailyFeed: bool('dailyFeed'),
    feedTime: time('feedTime'),
    dailyIdeas: bool('dailyIdeas'),
    weeklyRecap: bool('weeklyRecap'),
  }
}

// ── Prompts ────────────────────────────────────────────────────────────────

function list(lines: readonly string[]): string {
  return lines.map((line) => `- ${line.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
}

function about(goals: readonly Goal[], recentAsks: readonly string[]): string {
  const open = goals.filter((goal) => !goal.completed).map((goal) => goal.title)
  return [
    open.length ? `My active goals:\n${list(open)}` : '',
    recentAsks.length ? `What I have been asking you about lately:\n${list(recentAsks)}` : '',
  ].filter(Boolean).join('\n\n')
}

export function feedQueriesRequest(prompt: string, goals: readonly Goal[], recentAsks: readonly string[]): string {
  return [
    `My feed prompt: ${prompt}`,
    about(goals, recentAsks),
    'Name 3 to 5 news search queries (3 to 6 words each) that would surface what is new and relevant for me this week — the markets, companies, technologies and people around my goals. Be specific enough that a news search returns only on-topic stories: spell out industries in words, never bare acronyms or my private project and company names. Reply with ONLY a JSON array of strings.',
  ].filter(Boolean).join('\n\n')
}

export function feedWriteRequest(prompt: string, goals: readonly Goal[], items: readonly NewsItem[]): string {
  // Numbered, not linked: copying long URLs back token by token made a free
  // model take minutes per edition. The app attaches links and pictures.
  const headlines = items
    .map((item, index) => {
      const meta = [item.source, item.publishedAt?.slice(0, 10)].filter(Boolean).join(', ')
      return `[${index + 1}] ${item.title.replace(/\s+/g, ' ')}${meta ? ` (${meta})` : ''}${item.summary ? `\n    ${item.summary.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`
    })
    .join('\n')
  return [
    `My feed prompt: ${prompt}`,
    about(goals, []),
    `Recent headlines:\n${headlines}`,
    'Write my feed edition from ONLY these headlines and their snippets — no outside facts. Pick the 3 to 6 that matter most for my goals and prompt, most important first; one story may combine headlines about the same news. Leave out anything that does not clearly bear on my goals or prompt — fewer, relevant stories beat a full page. Never invent numbers, quotes or names.',
    'Reply with ONLY a JSON array, no prose, where each item is {"title": the news stated plainly in under 90 characters, "body": 2 to 3 sentences on what happened and what it means for me (**bold** allowed, no links), "sources": the numbers of the headlines it is based on, e.g. [3]}.',
  ].filter(Boolean).join('\n\n')
}

export function ideasRequest(goals: readonly Goal[], recentAsks: readonly string[]): string {
  const known = about(goals, recentAsks)
  return [
    known
      ? 'Suggest 6 to 9 concrete things you can do for me next, based only on what you actually know about me.'
      // A brand-new user: like Muse's starter ideas, offer broadly useful jobs
      // an assistant on their Mac can really do, instead of an empty page.
      : 'We have just met and you know nothing about me yet. Suggest 6 to 9 broadly useful things you can do for almost anyone from their Mac — research, writing, planning, reminders, organising files, keeping track of something — each concrete enough to start right away.',
    known,
    'Each idea is an offer in your voice ("I can …" or "Let me …"), one line' + (known ? ', specific to my context — never generic.' : '.') + ' Do not invent facts, numbers or links.',
    'Reply with ONLY a JSON array, no prose, where each item is {"emoji": one emoji, "title": the offer, "description": one or two sentences on what you would deliver, "category": a short section name such as Productivity, Finance, Health, Shopping}.',
  ].filter(Boolean).join('\n\n')
}

export interface CheckInInput {
  now: Date
  goals: readonly Goal[]
  recentAsks: readonly string[]
  /** Hours since the user last wrote to the agent, if known. */
  hoursSinceUser: number | null
  feed: readonly FeedUnit[]
  ideas: readonly Idea[]
  previous: readonly CheckIn[]
}

/**
 * The model decides whether to speak at all. A check-in that is not specific
 * to this user's goals or asks is noise, and noise is the fastest way to get
 * proactive messages turned off.
 */
export function checkInRequest(input: CheckInInput): string {
  const today = input.feed.filter((unit) => input.now.getTime() - Date.parse(unit.at) < 36 * 3600_000).slice(0, 6)
  return [
    'You are my personal assistant deciding whether to message me first, right now, unprompted.',
    `It is ${input.now.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })} my time.${input.hoursSinceUser === null ? '' : ` I last wrote to you ${Math.round(input.hoursSinceUser)} hours ago.`}`,
    about(input.goals, input.recentAsks),
    today.length ? `Today's feed (news you already found for me):\n${today.map((unit) => `- ${unit.title}`).join('\n')}` : '',
    input.ideas.length ? `Things you already offered to do:\n${list(input.ideas.slice(0, 6).map((idea) => idea.title))}` : '',
    input.previous.length ? `Your recent check-ins (never repeat these):\n${list(input.previous.slice(0, 5).map((entry) => entry.message))}` : '',
    'Message me only if you have something specific and useful: a next step on one of my goals, a follow-up on something I asked, or a piece of today\'s news that changes what I should do — with one concrete offer I can accept by just replying "yes". Two to four short sentences, warm and direct, no greeting filler, no lists, no invented facts. If nothing is specific enough, stay quiet.',
    'Reply with ONLY JSON: {"send": false} or {"send": true, "message": "..."}.',
  ].filter(Boolean).join('\n\n')
}

// ── Parsers ────────────────────────────────────────────────────────────────

/** The agent's queries, or null when the reply is not a usable JSON array. */
export function parseQueries(reply: string): string[] | null {
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(reply.slice(start, end + 1)) as unknown
    if (!Array.isArray(value)) return null
    const queries = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 1).map((item) => item.trim().slice(0, 80))
    return queries.length ? [...new Set(queries)].slice(0, 5) : null
  } catch {
    return null
  }
}

/** Merges per-query results: unique links, newest first, capped. */
export function mergeNews(batches: readonly (readonly NewsItem[])[], cap = 14): NewsItem[] {
  const seen = new Set<string>()
  const merged: NewsItem[] = []
  // Round-robin so every query contributes before any one dominates.
  for (let row = 0; merged.length < cap; row += 1) {
    let added = false
    for (const batch of batches) {
      const item = batch[row]
      if (!item) continue
      added = true
      const key = item.title.toLowerCase()
      if (seen.has(item.url) || seen.has(key)) continue
      seen.add(item.url)
      seen.add(key)
      merged.push(item)
      if (merged.length >= cap) break
    }
    if (!added) break
  }
  return merged
}

/** Splits one written edition into the titled units Muse renders as cards. */
export function parseFeedUnits(editionId: string, content: string, at: string): FeedUnit[] {
  const text = content.trim()
  if (!text) return []
  const heading = /^(?:#{1,4}\s+|\d+[.)]\s+\*{0,2})(.+?)(?:\*{2})?\s*$/gm
  const matches = [...text.matchAll(heading)]
  if (matches.length === 0) {
    const firstLine = text.split('\n').find((line) => line.trim())?.replace(/^[-*#\d.)\s]+/, '').replace(/^\*\*|\*\*$/g, '').trim()
    return firstLine ? [{ id: `feed-${editionId}-0`, title: firstLine.slice(0, 120), body: text, at }] : []
  }
  return matches.flatMap((match, index) => {
    const title = match[1]?.trim()
    if (!title) return []
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? text.length
    const body = text.slice(start, end).trim()
    return body ? [{ id: `feed-${editionId}-${index}`, title: title.slice(0, 120), body, at }] : []
  })
}

/** The first JSON array in a reply, fenced or not; null when there is none. */
function jsonArray(reply: string): unknown[] | null {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
  const source = fenced ? fenced[1]! : reply.slice(reply.indexOf('['), reply.lastIndexOf(']') + 1)
  try {
    const value = JSON.parse(source) as unknown
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Turns the writer's JSON into feed units, attaching each unit's real sources
 * and the lead source's picture. A unit citing no real headline is dropped —
 * that is news the model made up. A Markdown reply still parses, unlinked.
 */
export function parseEdition(editionId: string, reply: string, news: readonly NewsItem[], at: string): FeedUnit[] {
  const raw = jsonArray(reply)
  if (!raw) return parseFeedUnits(editionId, reply, at)
  return raw.flatMap((item, index): FeedUnit[] => {
    if (!item || typeof item !== 'object') return []
    const { title, body, sources } = item as Record<string, unknown>
    if (typeof title !== 'string' || !title.trim() || typeof body !== 'string' || !body.trim()) return []
    const cited = (Array.isArray(sources) ? sources : [])
      .map((n) => news[Number(n) - 1])
      .filter((entry, i, all): entry is NewsItem => Boolean(entry) && all.indexOf(entry) === i)
    if (cited.length === 0) return []
    return [{
      id: `feed-${editionId}-${index}`,
      title: title.trim().slice(0, 140),
      body: body.trim(),
      at,
      image: cited.find((entry) => entry.image)?.image,
      sources: cited.map((entry) => ({ title: entry.title, url: entry.url, source: entry.source })),
    }]
  })
}

/** Reads the agent's reply: a JSON array, possibly inside a ``` fence. Invalid items are dropped. */
export function parseIdeas(reply: string, batchId: string): Idea[] {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
  const source = fenced ? fenced[1]! : reply.slice(reply.indexOf('['), reply.lastIndexOf(']') + 1)
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index): Idea[] => {
    if (!item || typeof item !== 'object') return []
    const { emoji, title, description, category } = item as Record<string, unknown>
    if (typeof title !== 'string' || !title.trim()) return []
    return [{
      id: `${batchId}-${index}`,
      emoji: typeof emoji === 'string' && emoji.trim() ? emoji.trim().slice(0, 8) : undefined,
      title: title.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      category: typeof category === 'string' && category.trim() ? category.trim() : 'Productivity',
    }]
  })
}

/** The check-in to send, or null to stay quiet (also for anything unreadable). */
export function parseCheckIn(reply: string): string | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(reply.slice(start, end + 1)) as { send?: unknown; message?: unknown }
    if (value.send !== true || typeof value.message !== 'string') return null
    const message = value.message.trim()
    return message.length >= 20 ? message.slice(0, 1200) : null
  } catch {
    return null
  }
}

/** Muse's page: the first few ideas stand unheaded, the rest group under their category. */
export function groupIdeas(ideas: readonly Idea[], featured = 4): { heading: string | null; ideas: Idea[] }[] {
  const groups: { heading: string | null; ideas: Idea[] }[] = []
  if (ideas.length) groups.push({ heading: null, ideas: ideas.slice(0, featured) })
  for (const idea of ideas.slice(featured)) {
    const group = groups.find((entry) => entry.heading === idea.category)
    if (group) group.ideas.push(idea)
    else groups.push({ heading: idea.category, ideas: [idea] })
  }
  return groups
}

/** Where recent context may come from: the user's own chats, never background automation runs. */
export function isUserChat(sessionId: string): boolean {
  return /^(agent:[^:]+:)?webchat:/.test(sessionId)
}

/**
 * A side chat that an earlier ClawMuse Feed/Ideas run created by sending its
 * own prompt (before these became app functions). `firstMessage` is the
 * gateway's `displayName`, i.e. the chat's first message; the Main chat and
 * anything the user started are never matched.
 */
export function isLegacyAppRunChat(key: string, firstMessage: string): boolean {
  if (!/(^|:)webchat:main:conv:/.test(key)) return false
  const text = firstMessage.trim()
  return text.startsWith('[ClawMuse feed]') || text.startsWith('Suggest 6 to 9 concrete things you can do for me next') || text.startsWith('Make me a feed about my interests.')
}

// ── Schedule rules ─────────────────────────────────────────────────────────

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

/** Today at local "HH:MM". */
export function atLocal(now: Date, hhmm: string): Date {
  const date = new Date(now)
  date.setHours(0, minutesOf(hhmm), 0, 0)
  return date
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Inside the local window; an end before the start wraps past midnight. */
export function withinHours(now: Date, start: string, end: string): boolean {
  const minute = now.getHours() * 60 + now.getMinutes()
  const from = minutesOf(start)
  const to = minutesOf(end)
  if (from === to) return false
  return from < to ? minute >= from && minute < to : minute >= from || minute < to
}

/**
 * A daily job is due once its time has passed today and it has not succeeded
 * since then — so a Mac that slept through 07:00 catches up on wake. A failed
 * attempt waits `retryMs` before the next try.
 */
export function dailyDue(now: Date, time: string, lastSuccessAt: string | null, lastRunAt: string | null, retryMs = 30 * 60_000): boolean {
  const slot = atLocal(now, time)
  if (now < slot) return false
  if (lastSuccessAt && Date.parse(lastSuccessAt) >= slot.getTime()) return false
  return !lastRunAt || now.getTime() - Date.parse(lastRunAt) >= retryMs
}

export interface CheckInGate {
  now: Date
  settings: AssistantSettings
  lastUserMessageAt: number | null
  /** Last time the model was asked (sent or not) — it is not asked again for a while either way. */
  lastEvaluatedAt: string | null
  checkIns: readonly CheckIn[]
  /** Seconds since the last keyboard/mouse input on this Mac. */
  systemIdleSeconds: number
  hasContext: boolean
}

/** Why a check-in may not be considered now, or null when it may. */
export function checkInBlocked(gate: CheckInGate): string | null {
  const { now, settings } = gate
  if (!settings.checkIns) return 'off'
  if (!gate.hasContext) return 'nothing-known'
  if (!withinHours(now, settings.activeStart, settings.activeEnd)) return 'outside-hours'
  // Present, so the message is seen now — not piled up for a Mac nobody is at.
  if (gate.systemIdleSeconds > 5 * 60) return 'away'
  const today = gate.checkIns.filter((entry) => sameLocalDay(new Date(entry.at), now)).length
  if (today >= settings.checkInsPerDay) return 'daily-cap'
  const activeMinutes = (minutesOf(settings.activeEnd) - minutesOf(settings.activeStart) + 1440) % 1440 || 1440
  const spacingMs = Math.max(2 * 3600_000, (activeMinutes * 60_000) / settings.checkInsPerDay)
  const last = gate.checkIns[0] ? Date.parse(gate.checkIns[0].at) : 0
  if (now.getTime() - last < spacingMs) return 'spacing'
  // Idle with the assistant: someone mid-conversation needs no nudge.
  if (gate.lastUserMessageAt !== null && now.getTime() - gate.lastUserMessageAt < 2 * 3600_000) return 'recently-talked'
  if (gate.lastEvaluatedAt && now.getTime() - Date.parse(gate.lastEvaluatedAt) < 90 * 60_000) return 'recently-evaluated'
  return null
}
