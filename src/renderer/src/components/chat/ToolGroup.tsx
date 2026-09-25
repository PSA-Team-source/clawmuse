import { useState } from 'react'
import { ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { ToolCall } from '@/types'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { ToolCard } from './ToolCard'
import { toolDetail, toolMeta } from './tool-display'

interface ToolGroupProps {
  calls: ToolCall[]
  className?: string
}

/** Distinct tool names, in first-seen order — "Read, Bash" reads better than "Read, Read, Bash". */
function distinctNames(calls: ToolCall[]): string[] {
  return Array.from(new Set(calls.map((call) => call.tool)))
}

/**
 * A run of tool calls, collapsed into one line.
 *
 * A single turn can fire a dozen tools; as individual cards they bury the
 * answer they were gathering. Collapsed, the thread stays readable and the
 * detail is one click away.
 *
 * The summary keeps live status rather than only reporting after the fact:
 * while anything is still running the row spins, so the group doubles as the
 * progress indicator for the turn.
 */
export function ToolGroup({ calls, className }: ToolGroupProps) {
  const [expanded, setExpanded] = useState(false)

  if (calls.length === 0) return null

  // One call has nothing to summarise — the card already is the summary.
  if (calls.length === 1) return <ToolCard call={calls[0]!} className={className} />

  const names = distinctNames(calls)
  const summary = names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '')
  const running = calls.some((call) => call.status === 'running' || call.status === 'pending')
  const failed = calls.some((call) => call.status === 'error')

  return (
    <div className={cn('flex flex-col', className)}>
      <button
        type="button"
        onClick={() => setExpanded((previous) => !previous)}
        className="flex w-full cursor-pointer items-center gap-1.5 py-1 text-left text-footnote text-content-muted transition-colors hover:text-content-secondary"
        aria-expanded={expanded}
      >
        <Icon
          icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
          size={12}
          className="shrink-0 text-current"
          strokeWidth={2}
        />

        <span className="flex shrink-0 items-center gap-0.5">
          {names.slice(0, 3).map((name) => (
            <Icon key={name} icon={toolMeta(name).icon} size={12} className="opacity-60" strokeWidth={2} />
          ))}
        </span>

        <span className="truncate">{summary}</span>
        <span className="shrink-0 tabular-nums opacity-50">({calls.length})</span>

        <span className="ml-auto flex shrink-0 items-center">
          {running ? (
            <Spinner size={12} />
          ) : (
            <Icon
              icon={failed ? Cancel01Icon : Tick02Icon}
              size={12}
              strokeWidth={2}
              className={failed ? 'text-error' : 'text-success'}
            />
          )}
        </span>
      </button>

      {expanded ? (
        <div className="ml-4 flex flex-col gap-1 border-l border-line-hairline py-1 pl-2">
          {calls.map((call) => (
            <ToolCard key={call.id} call={call} />
          ))}
        </div>
      ) : (
        // Collapsed still shows what each call touched — the file, the command —
        // because that is the part worth skimming.
        <div className="ml-4 flex flex-col gap-0.5 border-l border-line-hairline pl-2">
          {calls.slice(0, 4).map((call) => {
            const detail = toolDetail(call.tool, call.input)
            return (
              <div key={call.id} className="flex items-center gap-2 text-caption text-content-muted">
                <span className="shrink-0 font-medium text-content-tertiary">{toolMeta(call.tool).verb}</span>
                {detail && (
                  <span className="truncate font-mono opacity-70" title={detail}>
                    {detail}
                  </span>
                )}
              </div>
            )
          })}
          {calls.length > 4 && (
            <span className="text-caption text-content-disabled">+{calls.length - 4} more</span>
          )}
        </div>
      )}
    </div>
  )
}
