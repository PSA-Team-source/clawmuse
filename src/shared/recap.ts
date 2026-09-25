/**
 * The Weekly Recap: once a week the built-in assistant looks back at the
 * user's week with ClawMuse and writes a short, shareable summary.
 *
 * Every number comes from something the app recorded — goals and their dates,
 * Feed editions, check-ins, and the user's own messages as the gateway stores
 * them. A fact the app could not count completely is left out, never guessed,
 * and an empty week makes no recap at all. Pure, so main and renderer share it
 * and it is tested without Electron.
 */

import { withinHours, type AssistantSettings, type CheckIn, type FeedUnit, type Goal } from './assistant'

/** What happened in one local calendar week (Monday 00:00 to the next Monday 00:00). */
export interface WeekFacts {
  /** ISO of the week's Monday 00:00, local. */
  weekStart: string
  /** ISO of the following Monday 00:00, local. */
  weekEnd: string
  goalsAdded: number
  /** Only goals completed since completion dates are recorded; undefined when none carry one. */
  goalsCompleted?: number
  /** Undefined when the kept Feed history does not reach back to the week's start. */
  feedEditions?: number
  feedStories?: number
  checkIns: number
  /** Check-ins the user answered in Main chat; undefined when their messages could not be read. */
  checkInsAnswered?: number
  /** Messages the user sent in their own chats; undefined when they could not all be read. */
  messagesSent?: number
  chats?: number
}

export interface WeeklyRecap {
  id: string
  /** When it was written. */
  at: string
  facts: WeekFacts
  /** The model's recap: two to four warm sentences. */
  text: string
  /** One suggested focus for the week ahead. */
  focus: string
}

/** A message the user sent, as read from the gateway's transcripts. */
export interface UserMessage {
  /** The chat's session key. */
  chat: string
  /** Epoch ms. */
  at: number
}

// ── Weeks ──────────────────────────────────────────────────────────────────

/**
 * The local calendar week containing `date`: Monday 00:00 to the next Monday
 * 00:00. Built with setDate/setHours, never by adding 7×24h, so a week with a
 * daylight-saving change is still exactly Monday to Monday on the wall clock.
 */
export function weekOf(date: Date): { start: Date; end: Date } {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  end.setHours(0, 0, 0, 0)
  return { start, end }
}

/** "Sep 21 – 27", "Sep 28 – Oct 4", "Dec 28, 2026 – Jan 3, 2027". */
export function weekLabel(facts: Pick<WeekFacts, 'weekStart' | 'weekEnd'>, locale?: string): string {
  const start = new Date(facts.weekStart)
  const last = new Date(facts.weekEnd)
  last.setDate(last.getDate() - 1)
  const sameYear = start.getFullYear() === last.getFullYear()
  const day = (date: Date, withYear: boolean) => date.toLocaleDateString(locale, withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' })
  if (!sameYear) return `${day(start, true)} – ${day(last, true)}`
  if (start.getMonth() === last.getMonth()) return `${day(start, false)} – ${last.getDate()}`
  return `${day(start, false)} – ${day(last, false)}`
}

// ── Facts ──────────────────────────────────────────────────────────────────

/** Feed/Ideas used to run as chats; their prompts are the app's words, not the user's. */
export function isAppPrompt(text: string): boolean {
  return /^(\[ClawMuse feed\]|Suggest 6 to 9 concrete things)/.test(text.trim())
}

/** The Main chat, where check-ins are delivered. */
export function isMainChat(key: string): boolean {
  return /(^|:)webchat:main$/.test(key)
}

export interface WeekFactsInput {
  /** The start of the week to recap is taken from this moment's week. */
  week: { start: Date; end: Date }
  /** Counted up to here (the week may still be running). */
  now: Date
  goals: readonly Goal[]
  feed: readonly FeedUnit[]
  /** False when the Feed history is at its cap, so its oldest editions may be gone. */
  feedAtCap: boolean
  checkIns: readonly CheckIn[]
  /** Null when the user's messages could not all be read. */
  userMessages: readonly UserMessage[] | null
}

/** How long after a check-in a message in Main chat still counts as answering it. */
const ANSWER_WINDOW_MS = 24 * 3600_000

export function computeWeekFacts(input: WeekFactsInput): WeekFacts {
  const from = input.week.start.getTime()
  const to = Math.min(input.week.end.getTime(), input.now.getTime())
  const inWeek = (iso: string | undefined | number): boolean => {
    const at = typeof iso === 'number' ? iso : iso ? Date.parse(iso) : Number.NaN
    return Number.isFinite(at) && at >= from && at < to
  }

  const facts: WeekFacts = {
    weekStart: input.week.start.toISOString(),
    weekEnd: input.week.end.toISOString(),
    goalsAdded: input.goals.filter((goal) => inWeek(goal.createdAt)).length,
    checkIns: 0,
  }

  // A goal completed before completion dates were recorded has none: it is
  // not counted rather than counted in the wrong week.
  if (input.goals.some((goal) => goal.completedAt)) facts.goalsCompleted = input.goals.filter((goal) => goal.completed && inWeek(goal.completedAt)).length

  // The Feed keeps a capped history. Once full, the week's first editions may
  // already have been dropped — unless something older than the week survives.
  const oldest = input.feed.reduce((min, unit) => Math.min(min, Date.parse(unit.at) || Infinity), Infinity)
  if (!input.feedAtCap || oldest < from) {
    const units = input.feed.filter((unit) => inWeek(unit.at))
    facts.feedStories = units.length
    facts.feedEditions = new Set(units.map((unit) => unit.at)).size
  }

  const checkIns = input.checkIns.filter((entry) => inWeek(entry.at)).map((entry) => Date.parse(entry.at)).sort((a, b) => a - b)
  facts.checkIns = checkIns.length

  if (input.userMessages) {
    const mine = input.userMessages.filter((message) => inWeek(message.at))
    facts.messagesSent = mine.length
    facts.chats = new Set(mine.map((message) => message.chat)).size
    // Answered: the user wrote in Main chat after the check-in, before the next
    // one and within a day of it.
    const main = input.userMessages.filter((message) => isMainChat(message.chat)).map((message) => message.at)
    facts.checkInsAnswered = checkIns.filter((at, index) => {
      const until = Math.min(checkIns[index + 1] ?? Infinity, at + ANSWER_WINDOW_MS)
      return main.some((sent) => sent > at && sent < until)
    }).length
  }
  return facts
}

/** Whether anything happened worth recapping. An empty week gets no recap, and no card. */
export function hasActivity(facts: WeekFacts): boolean {
  return [facts.goalsAdded, facts.goalsCompleted, facts.feedEditions, facts.checkIns, facts.messagesSent].some((value) => (value ?? 0) > 0)
}

export interface RecapStat {
  label: string
  value: number
}

const plural = (value: number, one: string, many: string) => (value === 1 ? one : many)

/** The week's numbers as the card shows them: only facts that were counted and are above zero. */
export function recapStats(facts: WeekFacts): RecapStat[] {
  const stats: [number | undefined, string, string][] = [
    [facts.messagesSent, 'message sent', 'messages sent'],
    [facts.chats, 'chat', 'chats'],
    [facts.goalsAdded, 'goal set', 'goals set'],
    [facts.goalsCompleted, 'goal completed', 'goals completed'],
    [facts.feedStories, 'Feed story', 'Feed stories'],
    [facts.checkIns, 'check-in', 'check-ins'],
  ]
  return stats.flatMap(([value, one, many]) => (value && value > 0 ? [{ label: plural(value, one, many), value }] : []))
}

// ── Prompt and parser ──────────────────────────────────────────────────────

export interface RecapPromptInput {
  facts: WeekFacts
  goals: readonly Goal[]
  /** Titles of the week's Feed stories, newest first. */
  feedTitles: readonly string[]
  /** Last week's suggested focus, if there was a recap. */
  previousFocus?: string
}

function factLines(facts: WeekFacts): string[] {
  const lines = [`Goals I set: ${facts.goalsAdded}`]
  if (facts.goalsCompleted !== undefined) lines.push(`Goals I completed: ${facts.goalsCompleted}`)
  if (facts.messagesSent !== undefined) lines.push(`Messages I sent you: ${facts.messagesSent}`, `Chats we had: ${facts.chats ?? 0}`)
  if (facts.feedEditions !== undefined) lines.push(`Feed editions you wrote me: ${facts.feedEditions} (${facts.feedStories ?? 0} stories)`)
  lines.push(`Check-ins you sent me: ${facts.checkIns}`)
  if (facts.checkInsAnswered !== undefined) lines.push(`Check-ins I answered: ${facts.checkInsAnswered}`)
  return lines
}

export function recapRequest(input: RecapPromptInput): string {
  const { facts } = input
  const week = { start: new Date(facts.weekStart), end: new Date(facts.weekEnd) }
  const completed = input.goals.filter((goal) => goal.completed && goal.completedAt && Date.parse(goal.completedAt) >= week.start.getTime() && Date.parse(goal.completedAt) < week.end.getTime()).map((goal) => goal.title)
  const open = input.goals.filter((goal) => !goal.completed).map((goal) => goal.title)
  const list = (lines: readonly string[]) => lines.map((line) => `- ${line.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
  return [
    'You are my personal assistant, writing my weekly recap: a short look back at my week with you that I might share.',
    `This week (${weekLabel(facts, 'en-US')}), as the app counted it:\n${list(factLines(facts))}`,
    completed.length ? `Goals I completed this week:\n${list(completed)}` : '',
    open.length ? `My open goals:\n${list(open)}` : '',
    input.feedTitles.length ? `Stories from my Feed this week:\n${list(input.feedTitles.slice(0, 8))}` : '',
    input.previousFocus ? `The focus you suggested last week: ${input.previousFocus}` : '',
    'Write 2 to 4 warm, specific sentences in the second person about what I did this week. Use only the facts above; write any number as digits and only numbers listed above; never invent activity, streaks, results or percentages. Then suggest ONE concrete focus for the week ahead, tied to an open goal when there is one, in one sentence.',
    'Reply with ONLY JSON: {"recap": "...", "focus": "..."}.',
  ].filter(Boolean).join('\n\n')
}

/** Every number the recap may state: the counted facts plus any written in the goals it was given. */
export function allowedNumbers(facts: WeekFacts, goals: readonly Goal[]): Set<string> {
  const numbers = new Set<string>()
  for (const value of Object.values(facts)) if (typeof value === 'number') numbers.add(String(value))
  for (const goal of goals) for (const match of goal.title.matchAll(/\d+(?:[.,]\d+)*/g)) numbers.add(match[0])
  return numbers
}

/**
 * The recap, or null when the reply is unusable — including one that states a
 * number the app never counted (a made-up streak reads as a fact on a card).
 */
export function parseRecap(reply: string, allowed: ReadonlySet<string>): { text: string; focus: string } | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let value: { recap?: unknown; focus?: unknown }
  try {
    value = JSON.parse(reply.slice(start, end + 1)) as { recap?: unknown; focus?: unknown }
  } catch {
    return null
  }
  if (typeof value.recap !== 'string' || typeof value.focus !== 'string') return null
  const text = value.recap.replace(/\s+/g, ' ').trim()
  const focus = value.focus.replace(/\s+/g, ' ').trim()
  if (text.length < 20 || focus.length < 8) return null
  // ponytail: catches digits only; a number spelled out in words passes. The
  // prompt asks for digits, which is what models write for counts.
  for (const match of `${text} ${focus}`.matchAll(/\d+(?:[.,]\d+)*/g)) if (!allowed.has(match[0])) return null
  return { text: text.slice(0, 900), focus: focus.slice(0, 300) }
}

// ── Schedule ───────────────────────────────────────────────────────────────

/** Sunday evening; when that is outside the user's active hours, the start of them. */
export const RECAP_TIME = '18:00'
/** A recap missed by more than this (the Mac was off all weekend) waits for next Sunday. */
const RECAP_CATCH_UP_MS = 48 * 3600_000

/** The most recent Sunday recap slot at or before `now`. */
export function recapSlot(now: Date, settings: Pick<AssistantSettings, 'activeStart' | 'activeEnd'>): Date {
  const probe = new Date(now)
  probe.setHours(18, 0, 0, 0)
  const [hour, minute] = (withinHours(probe, settings.activeStart, settings.activeEnd) ? RECAP_TIME : settings.activeStart).split(':').map(Number)
  const slot = new Date(now)
  slot.setDate(slot.getDate() - slot.getDay())
  slot.setHours(hour!, minute!, 0, 0)
  if (slot > now) {
    slot.setDate(slot.getDate() - 7)
    slot.setHours(hour!, minute!, 0, 0)
  }
  return slot
}

/**
 * Due once the Sunday slot has passed, inside active hours, until it has
 * succeeded — catching up after sleep for two days, then waiting for next week.
 * A failed attempt waits `retryMs`.
 */
export function recapDue(now: Date, settings: Pick<AssistantSettings, 'weeklyRecap' | 'activeStart' | 'activeEnd'>, lastSuccessAt: string | null, lastRunAt: string | null, retryMs = 30 * 60_000): boolean {
  if (!settings.weeklyRecap) return false
  const slot = recapSlot(now, settings)
  if (now.getTime() - slot.getTime() > RECAP_CATCH_UP_MS) return false
  if (lastSuccessAt && Date.parse(lastSuccessAt) >= slot.getTime()) return false
  if (!withinHours(now, settings.activeStart, settings.activeEnd)) return false
  return !lastRunAt || now.getTime() - Date.parse(lastRunAt) >= retryMs
}

/** When the next scheduled recap will be written. */
export function nextRecapAt(now: Date, settings: Pick<AssistantSettings, 'activeStart' | 'activeEnd'>, lastSuccessAt: string | null): Date {
  const slot = recapSlot(now, settings)
  const done = lastSuccessAt !== null && Date.parse(lastSuccessAt) >= slot.getTime()
  if (!done && now.getTime() - slot.getTime() <= RECAP_CATCH_UP_MS) return now
  const next = new Date(slot)
  next.setDate(next.getDate() + 7)
  next.setHours(slot.getHours(), slot.getMinutes(), 0, 0)
  return next
}
