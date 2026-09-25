import type { ReactElement, ReactNode } from 'react'
import { Menu as Base } from '@base-ui/react/menu'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'

interface MenuProps {
  /** The control that opens the menu. Cloned, so it keeps its own styling. */
  trigger: ReactElement
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Controlled, for the session rows where a right-click opens the same menu the button does. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

/**
 * A popup menu.
 *
 * Three screens had written this by hand — a `useState`, a `mousedown`
 * listener on `document` to catch the click-away, and a `<div>` positioned with
 * `absolute right-0`. What that costs is invisible until you try to use the app
 * without a mouse: no focus trap, no arrow keys, no Escape, no return of focus
 * to the trigger, and a menu that opens off-screen when the trigger is near the
 * bottom of the window.
 */
export function Menu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  open,
  onOpenChange,
  className,
}: MenuProps) {
  return (
    <Base.Root open={open} onOpenChange={onOpenChange}>
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner side={side} align={align} sideOffset={6} className="z-50 outline-none">
          <Base.Popup
            className={cn(
              'min-w-44 origin-(--transform-origin) overflow-hidden rounded-box p-1',
              'border border-line-strong bg-bg-card shadow-popup outline-none',
              'transition-[transform,opacity] duration-(--duration-fast) ease-entrance',
              'data-starting-style:scale-95 data-starting-style:opacity-0',
              'data-ending-style:scale-95 data-ending-style:opacity-0',
              className,
            )}
          >
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}

interface MenuItemProps {
  onClick?: () => void
  disabled?: boolean
  /** Destructive actions read in the error colour rather than hiding among the rest. */
  tone?: 'default' | 'danger'
  children: ReactNode
}

function MenuItem({ onClick, disabled, tone = 'default', children }: MenuItemProps) {
  return (
    <Base.Item
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-field px-2.5 py-1.5',
        'text-body-sm outline-none select-none',
        tone === 'danger' ? 'text-error' : 'text-content-secondary',
        'data-highlighted:bg-fill-accent',
        tone === 'danger' ? 'data-highlighted:bg-error/12' : 'data-highlighted:text-content-primary',
        'data-disabled:cursor-not-allowed data-disabled:opacity-40',
      )}
    >
      {children}
    </Base.Item>
  )
}

interface MenuCheckboxItemProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children: ReactNode
}

/** A toggle row — announced as a checkbox, with the tick on the trailing edge like Muse's. */
function MenuCheckboxItem({ checked, onCheckedChange, children }: MenuCheckboxItemProps) {
  return (
    <Base.CheckboxItem
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-field px-2.5 py-1.5',
        'text-body-sm text-content-secondary outline-none select-none',
        'data-highlighted:bg-fill-accent data-highlighted:text-content-primary',
      )}
    >
      {children}
      <Base.CheckboxItemIndicator className="ms-auto flex text-content-primary">
        <Icon icon={Tick02Icon} size={15} className="text-current" />
      </Base.CheckboxItemIndicator>
    </Base.CheckboxItem>
  )
}

function MenuSeparator() {
  return <Base.Separator className="my-1 h-px bg-line-hairline" />
}

Menu.Item = MenuItem
Menu.CheckboxItem = MenuCheckboxItem
Menu.Separator = MenuSeparator
