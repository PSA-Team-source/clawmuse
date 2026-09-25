import { CircleIcon, Tick02Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import type { ToolCall } from '@/types'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { Collapsible } from '@/components/primitives'

interface ToolCardProps {
  call: ToolCall
  className?: string
}

const STATUS_CLASS: Record<ToolCall['status'], string> = {
  pending: 'text-content-disabled',
  running: 'text-warning',
  done: 'text-success',
  error: 'text-error',
}

const STATUS_ICON: Record<ToolCall['status'], unknown> = {
  pending: CircleIcon,
  running: CircleIcon, // superseded by the spinner below
  done: Tick02Icon,
  error: Cancel01Icon,
}

function formatPayload(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Expand/collapse card for one agent tool call — status dot, tool name, and JSON input/result on expand. */
export function ToolCard({ call, className }: ToolCardProps) {
  const statusClass = STATUS_CLASS[call.status]
  const input = formatPayload(call.input)
  const result = formatPayload(call.result)

  return (
    <Collapsible
      className={cn('overflow-hidden rounded-field border border-line bg-fill', className)}
      chevron="end"
      triggerClassName="gap-2 p-2.5 transition-colors hover:bg-fill-raised"
      summary={
        <>
          <div className="flex w-4 items-center justify-center">
            {call.status === 'running' ? (
              <Spinner size={13} />
            ) : (
              <Icon icon={STATUS_ICON[call.status]} size={13} strokeWidth={2} className={statusClass} />
            )}
          </div>
          <span className="flex-1 truncate font-mono text-footnote text-content-secondary">
            {call.tool}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-2 border-t border-line-hairline p-2.5">
        {input && (
          <pre className="selectable whitespace-pre-wrap break-words font-mono text-caption leading-code text-content-body">
            {input}
          </pre>
        )}
        {result && (
          <div className="flex flex-col gap-1">
            <span className="text-micro font-medium text-content-muted">Result:</span>
            <pre
              className={cn(
                'selectable whitespace-pre-wrap break-words font-mono text-caption leading-code',
                call.isError ? 'text-error' : 'text-content-body',
              )}
            >
              {result}
            </pre>
          </div>
        )}
      </div>
    </Collapsible>
  )
}
