/**
 * Tier 1 — primitives.
 *
 * Base UI behaviour with the app's tokens painted on, and nothing else. Nothing
 * in here may know what a skill, a task or a gateway is; the moment it does it
 * belongs a tier up. Nothing in here imports from `brand/`, `patterns/` or
 * `features/` either — dependencies only point downward, and ESLint enforces it.
 */
export { AlertDialog } from './AlertDialog'
export { Collapsible } from './Collapsible'
export { Dialog } from './Dialog'
export { Icon } from './Icon'
export { Menu } from './Menu'
export { NumberField } from './NumberField'
export { SegmentedControl, type Segment } from './SegmentedControl'
export { Select, type SelectItem } from './Select'
export { Switch } from './Switch'
export { Tooltip, TooltipProvider } from './Tooltip'
