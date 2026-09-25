import { useEffect, useMemo, useRef, useState } from 'react'
import { keys } from '@/lib/platform'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '@/stores/chat.store'
import { useRuntimeStore } from '@/stores/runtime.store'
import { useSkillsStore } from '@/stores/skills.store'
import { useTasks } from '@/hooks'
import { cn } from '@/lib/cn'

/**
 * ⌘K palette.
 *
 * Everything reachable in the app, plus the things that only exist locally
 * (restart the agent, open its log). Commands are assembled from live state —
 * sessions, skills and tasks the user actually has — rather than a static list,
 * because a palette that only knows about routes is barely faster than the
 * sidebar.
 */

export interface Command {
  id: string
  label: string
  hint?: string
  group: string
  run: () => void
}

/** Subsequence match: "ars" finds "Ag*e*nt *R*oom *S*ettings"-style targets. */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const haystack = target.toLowerCase()
  const needle = query.toLowerCase()

  const direct = haystack.indexOf(needle)
  // A contiguous hit always outranks a scattered one, and an earlier hit wins.
  if (direct >= 0) return 1000 - direct

  let index = 0
  let score = 0
  for (const char of needle) {
    const found = haystack.indexOf(char, index)
    if (found < 0) return 0
    score += 1 / (1 + found - index)
    index = found + 1
  }
  return score
}

/**
 * Rendered only while open, so each invocation is a fresh instance with empty
 * query and selection. Resetting that state in an effect instead would cascade
 * an extra render every time the palette opens.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const restartRuntime = useRuntimeStore((state) => state.restart)
  const openLogs = useRuntimeStore((state) => state.openLogs)
  const sessions = useChatStore((state) => state.sessions)
  const createSession = useChatStore((state) => state.createSession)
  const skills = useSkillsStore((state) => state.skills)
  const { data: tasks } = useTasks()

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => navigate(path)
    const list: Command[] = [
      { id: 'nav-room', label: 'Agent Room', group: 'Go to', hint: '⌘1', run: go('/room') },
      { id: 'nav-chat', label: 'Chat', group: 'Go to', hint: '⌘2', run: go('/chat') },
      { id: 'nav-tasks', label: 'Tasks', group: 'Go to', hint: '⌘3', run: go('/tasks') },
      { id: 'nav-channels', label: 'Channels', group: 'Go to', hint: '⌘4', run: go('/channels') },
      { id: 'nav-skills', label: 'Skills', group: 'Go to', hint: '⌘5', run: go('/skills') },
      { id: 'nav-computer', label: 'Computer', group: 'Go to', hint: '⇧⌘C', run: go('/computer') },
      { id: 'nav-settings', label: 'Settings', group: 'Go to', hint: '⌘,', run: go('/settings') },
      {
        id: 'new-chat',
        label: 'New conversation',
        group: 'Actions',
        run: () => navigate(`/chat/${encodeURIComponent(createSession())}`),
      },
    ]

    {
      list.push(
        { id: 'nav-files', label: 'Files', group: 'Go to', run: go('/files') },
        { id: 'nav-terminal', label: 'Terminal', group: 'Go to', run: go('/terminal') },
        {
          id: 'runtime-restart',
          label: 'Restart local agent',
          group: 'Local agent',
          run: () => void restartRuntime(),
        },
        {
          id: 'runtime-logs',
          label: 'Open runtime log',
          group: 'Local agent',
          run: () => void openLogs(),
        },
        {
          id: 'runtime-control-ui',
          label: 'Open Control UI',
          group: 'Local agent',
          run: () => void window.clawmuse.window.open('control-ui'),
        },
      )
    }

    for (const session of sessions.slice(0, 8)) {
      list.push({
        id: `session-${session.id}`,
        label: session.name || session.id,
        group: 'Conversations',
        run: () => navigate(`/chat/${encodeURIComponent(session.id)}`),
      })
    }
    for (const skill of skills.slice(0, 8)) {
      list.push({
        id: `skill-${skill.skillKey}`,
        label: skill.name || skill.skillKey,
        group: 'Skills',
        run: () => navigate(`/skills/${encodeURIComponent(skill.skillKey)}`),
      })
    }
    for (const task of (tasks ?? []).slice(0, 8)) {
      list.push({
        id: `task-${task.cron_job_id}`,
        label: task.name,
        group: 'Tasks',
        run: () => navigate(`/tasks/${encodeURIComponent(task.cron_job_id)}`),
      })
    }
    return list
  }, [navigate, restartRuntime, openLogs, sessions, skills, tasks, createSession])

  const results = useMemo(() => {
    return commands
      .map((command) => ({ command, score: fuzzyScore(query, `${command.group} ${command.label}`) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((entry) => entry.command)
  }, [commands, query])

  // Focus after paint — on mount the input is not in the document yet.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  function choose(command: Command | undefined): void {
    if (!command) return
    onClose()
    command.run()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-[14vh]"
      onMouseDown={onClose}
    >
      <div
        // The palette floats over whatever screen you opened it from, which is the
        // one place refraction reads as depth rather than as an effect.
        className="material-thick w-full max-w-content overflow-hidden rounded-box"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose()
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((index) => Math.min(index + 1, results.length - 1))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              choose(results[active])
            }
          }}
          placeholder="Search commands, conversations, skills…"
          className="w-full bg-transparent px-4 py-3.5 text-body text-content-primary outline-none placeholder:text-content-faint"
        />

        <div className="max-h-[46vh] overflow-y-auto border-t border-line-hairline py-1">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-body-sm text-content-faint">No matches</p>
          ) : (
            results.map((command, index) => (
              <button
                key={command.id}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(command)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
                  index === active ? 'bg-fill-accent' : 'hover:bg-fill-raised',
                )}
              >
                <span className="w-[92px] shrink-0 truncate text-caption text-content-faint">
                  {command.group}
                </span>
                <span className="min-w-0 flex-1 truncate text-body-sm text-content-primary">
                  {command.label}
                </span>
                {command.hint && (
                  <span className="shrink-0 text-micro text-content-faint">{keys(command.hint)}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
