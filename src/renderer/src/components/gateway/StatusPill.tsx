import type { ConnectionState } from '@/types'
import { cn } from '@/lib/cn'

interface StatusPillProps {
  state: ConnectionState
  label?: string
  className?: string
}

const CONFIG: Record<ConnectionState, { dotClass: string; textClass: string; label: string }> = {
  connected: { dotClass: 'bg-success', textClass: 'text-success', label: 'Connected' },
  connecting: { dotClass: 'bg-warning', textClass: 'text-warning', label: 'Connecting…' },
  booting: { dotClass: 'bg-warning', textClass: 'text-warning', label: 'Starting…' },
  disconnected: { dotClass: 'bg-content-disabled', textClass: 'text-content-muted', label: 'Disconnected' },
  idle: { dotClass: 'bg-content-disabled', textClass: 'text-content-muted', label: 'Idle' },
  error: { dotClass: 'bg-error', textClass: 'text-error', label: 'Error' },
}

/** Small dot + label pill for the gateway's live connection state, shown in the title bar. */
export function StatusPill({ state, label, className }: StatusPillProps) {
  const cfg = CONFIG[state]

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 self-start rounded-full border border-line-strong bg-fill-strong px-3 py-1.5',
        className,
      )}
      title={label ?? cfg.label}
    >
      <span className={cn('size-2 rounded-full', cfg.dotClass)} />
      <span className={cn('text-footnote font-medium', cfg.textClass)}>{label ?? cfg.label}</span>
    </div>
  )
}
