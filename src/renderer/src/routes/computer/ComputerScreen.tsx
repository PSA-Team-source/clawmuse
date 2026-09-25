import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/brand'
import { BotAvatar } from '@/components/chat'
import { SegmentedControl } from '@/components/primitives'
import { agentIdFromSessionKey } from '@/services/session-key'
import { useBotsStore } from '@/stores/bots.store'
import { useChatStore } from '@/stores/chat.store'
import { BrowserPane } from './BrowserPane'

/**
 * The computer the bots share.
 *
 * Grok Bot gives every user one cloud VM — browser, terminal, filesystem — that
 * all their bots work on. Here that computer is the Mac itself: one browser
 * profile, the user's own shell, and one shared workspace. This screen is the
 * window onto it, and the reason it is one screen with three tabs rather than
 * three screens is that they are one machine.
 */

// The terminal drags in xterm (~420 kB) and the file browser its own tree, and
// neither is needed to look at the browser.
const TerminalScreen = lazy(() => import('@/routes/terminal/TerminalScreen'))
const FilesScreen = lazy(() => import('@/routes/files/FilesScreen'))

type Pane = 'browser' | 'terminal' | 'files'

/** Tools that mean a bot is using the shared machine rather than just thinking. */
const COMPUTER_TOOLS = /^(browser|exec|Bash|Read|Write|Edit|Glob|Grep|apply_patch|process)/i

/** How long after a tool call a bot still counts as "at the keyboard". */
const DRIVING_WINDOW_MS = 90_000

/**
 * Who is using the computer right now.
 *
 * "They share one computer" is either a real statement or a marketing one. It
 * is real here — same browser profile, same shell — which means two bots can be
 * on it at once, and the header has to say so rather than pretend the machine
 * is idle while something is typing into it.
 */
function useDrivers() {
  const activity = useChatStore((state) => state.activity)
  const bots = useBotsStore((state) => state.bots)
  // "Recently" needs a clock, and a clock read during render is not a pure
  // one — the same props would produce a different answer a minute later with
  // nothing to trigger the re-render. So the clock ticks in state instead, and
  // the list ages out on its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  return useMemo(() => {
    const seen = new Map<string, number>()
    for (const [sessionKey, entry] of Object.entries(activity)) {
      if (now - entry.at > DRIVING_WINDOW_MS) continue
      if (!COMPUTER_TOOLS.test(entry.tool)) continue
      const botId = agentIdFromSessionKey(sessionKey) ?? 'main'
      seen.set(botId, Math.max(seen.get(botId) ?? 0, entry.at))
    }
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => bots.find((bot) => bot.id === id))
      .filter((bot): bot is NonNullable<typeof bot> => Boolean(bot))
  }, [activity, bots, now])
}

export default function ComputerScreen() {
  const [pane, setPane] = useState<Pane>('browser')
  const drivers = useDrivers()

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line-hairline px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-headline font-bold text-content-primary">Computer</h1>
          <p className="truncate text-caption text-content-tertiary">
            One browser, one shell, one shared folder — every bot works here.
          </p>
        </div>

        {drivers.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {drivers.slice(0, 4).map((bot) => (
                <BotAvatar
                  key={bot.id}
                  id={bot.id}
                  name={bot.name}
                  emoji={bot.emoji}
                  avatar={bot.avatar}
                  size={24}
                  className="ring-2 ring-bg-base"
                />
              ))}
            </div>
            <span className="text-caption text-content-tertiary">
              {drivers.length === 1
                ? `${drivers[0]?.name} is using it`
                : `${drivers.length} bots are using it`}
            </span>
          </div>
        )}

        <SegmentedControl
          aria-label="Computer view"
          value={pane}
          onValueChange={setPane}
          className="shrink-0"
          items={[
            { value: 'browser', label: 'Browser' },
            { value: 'terminal', label: 'Terminal' },
            { value: 'files', label: 'Files' },
          ]}
        />
      </header>

      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner size={24} />
            </div>
          }
        >
          {pane === 'browser' && <BrowserPane />}
          {pane === 'terminal' && <TerminalScreen />}
          {pane === 'files' && <FilesScreen />}
        </Suspense>
      </div>
    </div>
  )
}
