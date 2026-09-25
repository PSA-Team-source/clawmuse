import { gatewayWS } from '@/services/gateway-ws.service'

/**
 * Teach a task — show a bot how something is done, once.
 *
 * What this records is the **trail through the browser**: the pages visited, in
 * order, with their titles, plus any non-GET requests the page made along the
 * way. It does not record clicks or keystrokes, and the UI says so, because the
 * browser control surface is a request/response API rather than an event
 * stream — claiming otherwise would be the kind of promise that only breaks
 * once someone relies on it.
 *
 * That trail is still the useful half. "Went to the billing page, opened the
 * invoice, hit export, a POST to /exports came back" is a workflow a model can
 * turn into a skill; the exact pixel a button sat on is not.
 *
 * The result is a **proposal**, never a live skill. Skill Workshop's own
 * contract is proposal-first — apply is the only write, and it re-runs the
 * scanner — so the draft lands somewhere the user reviews it.
 */

/** Grok Bot's limit, and a fair one: ten minutes of trail is already a lot to read. */
export const MAX_RECORDING_MS = 10 * 60_000

/** How often the browser is asked where it is. */
const SAMPLE_MS = 2_000

export interface TeachStep {
  /** Milliseconds since the recording started. */
  offsetMs: number
  url: string
  title?: string
}

export interface Recording {
  startedAt: number
  durationMs: number
  steps: TeachStep[]
  /** Notable non-GET traffic, best effort — absent unless Playwright is available. */
  requests: string[]
}

interface RawTab {
  url?: string
  title?: string
  active?: boolean
}

/** The page the user is looking at, as far as the tab list can say. */
function currentTab(payload: unknown): RawTab | null {
  const tabs = (payload as { tabs?: RawTab[] } | null)?.tabs
  if (!Array.isArray(tabs) || tabs.length === 0) return null
  return tabs.find((tab) => tab.active) ?? tabs[0] ?? null
}

function isInteresting(url: string | undefined): url is string {
  if (!url) return false
  // `about:blank` and devtools are the browser talking to itself.
  return /^https?:/i.test(url)
}

export interface Recorder {
  stop: () => Recording
}

/**
 * Starts sampling. The caller is responsible for calling `stop` — including on
 * unmount, or the interval outlives the screen that owns it.
 */
export function startRecording(onStep: (steps: TeachStep[]) => void): Recorder {
  const startedAt = Date.now()
  const steps: TeachStep[] = []
  const requests: string[] = []
  let lastUrl = ''

  const sample = async (): Promise<void> => {
    try {
      const tab = currentTab(await gatewayWS.browserRequest({ method: 'GET', path: '/tabs' }))
      const url = tab?.url
      if (!isInteresting(url) || url === lastUrl) return
      lastUrl = url
      steps.push({
        offsetMs: Date.now() - startedAt,
        url,
        ...(tab?.title ? { title: tab.title } : {}),
      })
      onStep([...steps])
    } catch {
      // A sample that fails is a gap in the trail, not a failed recording.
    }
  }

  void sample()
  const timer = setInterval(() => void sample(), SAMPLE_MS)

  // Best effort, and deliberately not awaited anywhere: `/requests` needs
  // Playwright, which a given install may not have.
  void gatewayWS
    .browserRequest({ method: 'GET', path: '/requests' })
    .then((payload) => {
      const entries = (payload as { requests?: { method?: string; url?: string }[] } | null)?.requests
      if (!Array.isArray(entries)) return
      for (const entry of entries) {
        if (!entry?.url || !entry.method || entry.method.toUpperCase() === 'GET') continue
        const line = `${entry.method.toUpperCase()} ${entry.url}`
        if (!requests.includes(line)) requests.push(line)
      }
    })
    .catch(() => undefined)

  return {
    stop(): Recording {
      clearInterval(timer)
      return {
        startedAt,
        durationMs: Date.now() - startedAt,
        steps,
        requests: requests.slice(0, 20),
      }
    },
  }
}

function clock(offsetMs: number): string {
  const total = Math.round(offsetMs / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The message that turns a recording into a skill proposal.
 *
 * It asks for a proposal explicitly, and it asks the bot to come back with what
 * the draft still *cannot* decide. A recording shows the happy path exactly
 * once; every branch — the record that is missing, the login that expired, the
 * total that does not match — is invisible in it, and a skill that pretends
 * otherwise fails the first time it is used unattended.
 */
export function teachPrompt(recording: Recording, name: string): string {
  const lines = recording.steps.map(
    (step, index) =>
      `${index + 1}. ${clock(step.offsetMs)} ${step.url}${step.title ? ` — ${step.title}` : ''}`,
  )

  return [
    `I just did this once in the browser on our shared computer. Turn it into a reusable skill called "${name}".`,
    '',
    `Pages I went through (${recording.steps.length} over ${clock(recording.durationMs)}):`,
    ...(lines.length > 0 ? lines : ['(no pages captured — I may not have navigated anywhere)']),
    ...(recording.requests.length > 0
      ? ['', 'Requests the pages made:', ...recording.requests.map((line) => `- ${line}`)]
      : []),
    '',
    'Use the skill_workshop tool to create this as a PROPOSAL — do not write an active skill.',
    'This is a trail of pages, not a click-by-click recording, so infer the steps and say what you inferred.',
    '',
    'Then reply with, briefly:',
    '- what the skill will do, in order',
    '- what it should do when something is missing or looks wrong',
    '- where it must stop and ask me',
  ].join('\n')
}
