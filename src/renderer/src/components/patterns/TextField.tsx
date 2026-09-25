import { useId, useState, type KeyboardEvent } from 'react'
import { IconButton } from '@/components/brand'
import { ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives/Icon'

interface TextFieldProps {
  value: string
  onChange: (v: string) => void
  label?: string
  placeholder?: string
  type?: 'text' | 'password' | 'email'
  error?: string | null
  icon?: unknown
  disabled?: boolean
  autoFocus?: boolean
  onSubmit?: () => void
  className?: string
  multiline?: boolean
  rows?: number
}

/** Labelled input with a leading icon, inline error, and a reveal toggle for passwords. */
export function TextField({
  value,
  onChange,
  label,
  placeholder,
  type = 'text',
  error,
  icon,
  disabled,
  autoFocus,
  onSubmit,
  className,
  multiline,
  rows = 3,
}: TextFieldProps) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  const resolvedType = isPassword ? (revealed ? 'text' : 'password') : type

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault()
      onSubmit()
    }
  }

  const fieldClass = cn(
    'flex items-center gap-2.5 rounded-field border bg-fill-raised px-3.5 transition-colors',
    error ? 'border-error' : focused ? 'border-primary' : 'border-line-strong',
    disabled && 'opacity-50',
  )

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-footnote font-medium text-content-body">
          {label}
        </label>
      )}
      <div className={cn(fieldClass, multiline ? 'h-auto py-2.5' : 'h-13')}>
        {icon != null && <Icon icon={icon} size={16} className="shrink-0 text-content-tertiary" />}
        {multiline ? (
          <textarea
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            rows={rows}
            className="selectable w-full resize-none bg-transparent text-body text-content-primary outline-none placeholder:text-content-disabled"
          />
        ) : (
          <input
            id={id}
            type={resolvedType}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            className="selectable h-full w-full bg-transparent text-body text-content-primary outline-none placeholder:text-content-disabled"
          />
        )}
        {isPassword && (
          <IconButton
            icon={revealed ? ViewOffIcon : ViewIcon}
            label={revealed ? 'Hide password' : 'Show password'}
            onClick={() => setRevealed((v) => !v)}
            shape="circle"
            className="-mr-1.5 shrink-0"
          />
        )}
      </div>
      {error && <p className="text-caption text-error">{error}</p>}
    </div>
  )
}
