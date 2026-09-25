import { Select as Base } from '@base-ui/react/select'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { useId } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives/Icon'

export interface SelectItem<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

interface SelectProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  items: SelectItem<T>[]
  label?: string
  /**
   * Shown when nothing is chosen — and an empty-string value counts as nothing
   * chosen, so a list whose "none of these" option is `''` must say what that
   * means here ("No agent", "None") rather than relying on the item's own
   * label. The trigger renders this, not the item.
   */
  placeholder?: string
  disabled?: boolean
  /** Required when there is no visible `label`, so the control is not announced as an unnamed combobox. */
  'aria-label'?: string
  /** `field` matches TextField exactly; `compact` is for a toolbar, where a 52px control would dominate. */
  size?: 'field' | 'compact'
  className?: string
  id?: string
}

/**
 * The app's only dropdown.
 *
 * It replaces nine raw `<select>` elements. On macOS the browser hands a native
 * `<select>` popup to the operating system, which draws it with the system
 * appearance — so those nine dropdowns ignored the dark theme, every colour
 * token, the corner radius and the type scale, and there was no CSS that could
 * reach them. It was the largest remaining hole in the design system and the
 * only one that could not be fixed by editing a class name.
 *
 * The nine had also drifted into three different shapes: 42px tall with a
 * `bg-bg-surface`, 44px with `bg-fill-raised`, and a 26px toolbar variant. The
 * 44px ones sat directly under a 52px `TextField` in the same form. `field`
 * now matches TextField exactly, so a select and a text input in one column
 * are the same control at the same size.
 */
export function Select<T extends string>({
  value,
  onValueChange,
  items,
  label,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
  size = 'field',
  className,
  id,
}: SelectProps<T>) {
  const generatedId = useId()
  const controlId = id ?? generatedId

  return (
    // Everything, including the label, lives inside `Root`: the label reads the
    // select's context to wire itself to the trigger, and outside it throws at
    // render — which unmounts the tree and blanks the window rather than
    // failing locally.
    <Base.Root
      items={items}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
      id={controlId}
    >
      <div className={cn('flex flex-col gap-1.5', className)}>
        {/* Renders a div rather than a <label>, so there is no `htmlFor` to set. */}
        {label && (
          <Base.Label className="cursor-default text-footnote font-medium text-content-body">
            {label}
          </Base.Label>
        )}
        <Base.Trigger
          aria-label={ariaLabel}
          className={cn(
            'flex w-full cursor-pointer items-center justify-between gap-2 rounded-field border transition-colors',
            'border-line-strong bg-fill-raised text-content-primary outline-none',
            'hover:not-data-disabled:border-line-strong hover:not-data-disabled:bg-fill-strong',
            'focus-visible:border-primary data-popup-open:border-primary',
            'data-disabled:cursor-not-allowed data-disabled:opacity-50',
            size === 'field' ? 'h-13 px-3.5 text-body' : 'h-8 px-2.5 text-footnote',
          )}
        >
          <Base.Value
            className="truncate text-left data-placeholder:text-content-disabled"
            placeholder={placeholder}
          />
          <Base.Icon className="flex shrink-0 transition-transform duration-(--duration-fast) data-popup-open:rotate-180">
            <Icon icon={ArrowDown01Icon} size={16} className="text-content-tertiary" />
          </Base.Icon>
        </Base.Trigger>

        <Base.Portal>
          <Base.Positioner
            sideOffset={6}
            className="z-50 outline-none"
            // Without this the popup places the *selected* item over the
            // trigger, macOS-menu style. That is correct for a short list and
            // badly wrong for a long one, where it drags the whole popup up the
            // screen. Anchoring below keeps every list behaving the same way.
            alignItemWithTrigger={false}
          >
            <Base.Popup
              className={cn(
                'max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin)',
                'overflow-hidden rounded-box border border-line-strong bg-bg-card shadow-popup outline-none',
                'transition-[transform,opacity] duration-(--duration-fast) ease-entrance',
                'data-starting-style:scale-98 data-starting-style:opacity-0',
                'data-ending-style:scale-98 data-ending-style:opacity-0',
              )}
            >
              <Base.List className="max-h-(--available-height) overflow-y-auto p-1">
                {items.map((item) => (
                  <Base.Item
                    key={item.value}
                    value={item.value}
                    disabled={item.disabled}
                    className={cn(
                      'grid cursor-pointer grid-cols-[16px_1fr] items-center gap-2 rounded-field px-2 py-1.5',
                      'text-body-sm text-content-secondary outline-none select-none',
                      'data-highlighted:bg-fill-accent data-highlighted:text-content-primary',
                      'data-selected:text-content-primary',
                      'data-disabled:cursor-not-allowed data-disabled:opacity-40',
                    )}
                  >
                    <Base.ItemIndicator className="col-start-1 flex">
                      <Icon icon={Tick02Icon} size={14} className="text-primary-light" strokeWidth={2.4} />
                    </Base.ItemIndicator>
                    <Base.ItemText className="col-start-2 truncate">{item.label}</Base.ItemText>
                  </Base.Item>
                ))}
              </Base.List>
            </Base.Popup>
          </Base.Positioner>
        </Base.Portal>
      </div>
    </Base.Root>
  )
}
