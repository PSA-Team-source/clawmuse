import { useId } from 'react'
import { NumberField as Base } from '@base-ui/react/number-field'
import { cn } from '@/lib/cn'

interface NumberFieldProps {
  value: number | null
  onValueChange: (value: number | null) => void
  label?: string
  placeholder?: string
  min?: number
  max?: number
  step?: number
  /** Renders and parses as currency. Used for ad budgets, which are real money. */
  currency?: string
  disabled?: boolean
  className?: string
  id?: string
}

/**
 * A numeric input.
 *
 * Written for the ad budgets, which were being typed into a `TextField` of
 * `type="text"` and then run through a hand-written parser. That accepted
 * "20.00.00", "1e5", "２０" and an empty string, and the only thing standing
 * between those and a live Meta Ads campaign was the backend.
 *
 * This parses with `Intl.NumberFormat`, clamps to `min`/`max`, and hands the
 * caller a `number | null` instead of a string that might be a number. It also
 * supports arrow keys and scrubbing, which is what people expect of a spend
 * field they are adjusting rather than entering once.
 */
export function NumberField({
  value,
  onValueChange,
  label,
  placeholder,
  min,
  max,
  step = 1,
  currency,
  disabled,
  className,
  id,
}: NumberFieldProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={controlId} className="text-footnote font-medium text-content-body">
          {label}
        </label>
      )}
      <Base.Root
        id={controlId}
        value={value}
        onValueChange={onValueChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        format={currency ? { style: 'currency', currency, maximumFractionDigits: 2 } : undefined}
      >
        <Base.Group
          className={cn(
            'flex h-13 items-center rounded-field border border-line-strong bg-fill-raised',
            'transition-colors focus-within:border-primary',
            disabled && 'opacity-50',
          )}
        >
          <Base.Decrement
            className="flex h-full w-10 shrink-0 cursor-pointer items-center justify-center text-headline text-content-tertiary transition-colors hover:text-content-primary"
            aria-label="Decrease"
          >
            −
          </Base.Decrement>
          <Base.Input
            placeholder={placeholder}
            className="selectable h-full w-full min-w-0 bg-transparent text-center text-body tabular-nums text-content-primary outline-none placeholder:text-content-disabled"
          />
          <Base.Increment
            className="flex h-full w-10 shrink-0 cursor-pointer items-center justify-center text-headline text-content-tertiary transition-colors hover:text-content-primary"
            aria-label="Increase"
          >
            +
          </Base.Increment>
        </Base.Group>
      </Base.Root>
    </div>
  )
}
