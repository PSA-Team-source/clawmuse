import type { ReactNode } from 'react'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/primitives'

interface ChoiceRowProps {
  label: ReactNode
  description?: ReactNode
  /** Trailing secondary text, e.g. a token budget. */
  detail?: ReactNode
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}

/** Muse's single-choice settings row: title + subtitle, a trailing check when chosen. */
export function ChoiceRow({ label, description, detail, selected, disabled, onSelect }: ChoiceRowProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className="settings-row flex w-full items-center gap-3 text-left disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body text-content-primary">{label}</span>
        {description && <span className="mt-0.5 block text-caption text-content-secondary">{description}</span>}
      </span>
      {detail && <span className="shrink-0 text-body-sm text-content-secondary">{detail}</span>}
      {selected && <Icon icon={Tick02Icon} size={18} className="shrink-0 text-content-primary" />}
    </button>
  )
}

/** Muse's flat 32px pill (Button variant="flat" size="32") for an action inside a row. */
export function SettingsButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 shrink-0 rounded-full bg-fill-strong px-3 text-body text-content-primary hover:bg-fill-stronger disabled:opacity-50"
    >
      {children}
    </button>
  )
}
