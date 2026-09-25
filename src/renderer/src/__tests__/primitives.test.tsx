import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AlertDialog,
  Collapsible,
  Dialog,
  Menu,
  NumberField,
  SegmentedControl,
  Select,
  Switch,
  Tooltip,
  TooltipProvider,
} from '@/components/primitives'

/**
 * Renders every primitive in every shape a screen actually uses it.
 *
 * Written after `Select` shipped with its `<Select.Label>` outside
 * `<Select.Root>`. Base UI parts read their state from a context the root
 * provides, so a misplaced part throws during render — and a throw during
 * render with no boundary above it unmounts the whole tree. The symptom was
 * not a broken dropdown; it was a blank window, and every check after it in
 * the e2e run failed for reasons that had nothing to do with the cause.
 *
 * Typecheck cannot catch this: the composition is legal TypeScript. It needs a
 * render. These tests are cheap and they close that gap — note that `Select`
 * is exercised both with and without a label, because the version that shipped
 * worked fine without one, which is exactly why it reached e2e.
 */

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
]

describe('primitives render', () => {
  it('Select with a label', () => {
    render(
      <Select label="How often" value="a" onValueChange={vi.fn()} items={OPTIONS} />,
    )
    expect(screen.getByText('How often')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('Select without a label, named only for assistive tech', () => {
    render(
      <Select
        aria-label="Workspace root"
        size="compact"
        value="b"
        onValueChange={vi.fn()}
        items={OPTIONS}
      />,
    )
    expect(screen.getByLabelText('Workspace root')).toBeTruthy()
    expect(screen.getByText('Bravo')).toBeTruthy()
  })

  it('shows the placeholder, not the item label, when the value is empty', () => {
    // Base UI reads `''` as "nothing chosen". A list whose "none of these"
    // option is `''` therefore renders the placeholder in the trigger, and a
    // screen that leaned on the item's label instead would show a blank field.
    render(
      <Select
        label="Agent"
        placeholder="No agent (isolated run)"
        value=""
        onValueChange={vi.fn()}
        items={[{ value: '', label: 'No agent (isolated run)' }, ...OPTIONS]}
      />,
    )
    expect(screen.getByRole('combobox').textContent).toContain('No agent (isolated run)')
  })

  it('shows the chosen item label once something is chosen', () => {
    render(
      <Select
        label="Agent"
        placeholder="No agent"
        value="b"
        onValueChange={vi.fn()}
        items={[{ value: '', label: 'No agent' }, ...OPTIONS]}
      />,
    )
    expect(screen.getByRole('combobox').textContent).toContain('Bravo')
  })

  it('Switch carries its accessible name', () => {
    render(<Switch checked onCheckedChange={vi.fn()} aria-label="Push-to-Talk" />)
    expect(screen.getByLabelText('Push-to-Talk')).toBeTruthy()
  })

  it('Dialog renders title, description and content when open', () => {
    render(
      <Dialog open onOpenChange={vi.fn()} title="New task" description="Runs on a schedule">
        <p>body</p>
      </Dialog>,
    )
    expect(screen.getByText('New task')).toBeTruthy()
    expect(screen.getByText('Runs on a schedule')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('Dialog still has an accessible name when the design shows none', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <p>body</p>
      </Dialog>,
    )
    expect(screen.getByText('Dialog')).toBeTruthy()
  })

  it('AlertDialog renders its parts at the critical layer', () => {
    render(
      <AlertDialog open onOpenChange={vi.fn()} layer="critical">
        <AlertDialog.Title>Approve tool action?</AlertDialog.Title>
        <AlertDialog.Description>Your agent wants to run bash.</AlertDialog.Description>
      </AlertDialog>,
    )
    expect(screen.getByText('Approve tool action?')).toBeTruthy()
    expect(screen.getByText('Your agent wants to run bash.')).toBeTruthy()
  })

  it('Menu renders its trigger, and its items once open', () => {
    render(
      <Menu open onOpenChange={vi.fn()} trigger={<button type="button">Chat actions</button>}>
        <Menu.Item onClick={vi.fn()}>Rename</Menu.Item>
        <Menu.Separator />
        <Menu.Item tone="danger" onClick={vi.fn()}>
          Delete
        </Menu.Item>
      </Menu>,
    )
    expect(screen.getByText('Chat actions')).toBeTruthy()
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
  })

  it('SegmentedControl renders every segment and marks the chosen one', () => {
    render(
      <SegmentedControl
        aria-label="Agent view"
        value="tasks"
        onValueChange={vi.fn()}
        items={[
          { value: 'chat', label: 'Chat' },
          { value: 'tasks', label: 'Tasks' },
          { value: 'settings', label: 'Settings' },
        ]}
      />,
    )
    expect(screen.getByText('Chat')).toBeTruthy()
    expect(screen.getByText('Tasks').closest('button')?.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Chat').closest('button')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('SegmentedControl refuses to end up with nothing chosen', () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Room view"
        value="3d"
        onValueChange={onValueChange}
        items={[
          { value: 'basic', label: 'Simple' },
          { value: '3d', label: '3D' },
        ]}
      />,
    )
    // Pressing the segment that is already on would otherwise clear the group.
    screen.getByText('3D').closest('button')!.click()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('Collapsible renders its summary and its panel', () => {
    render(
      <Collapsible defaultOpen summary={<span>Thinking</span>}>
        <p>reasoning</p>
      </Collapsible>,
    )
    expect(screen.getByText('Thinking')).toBeTruthy()
    expect(screen.getByText('reasoning')).toBeTruthy()
  })

  it('NumberField renders a labelled numeric input', () => {
    render(
      <NumberField
        label="Daily budget"
        value={20}
        onValueChange={vi.fn()}
        min={1}
        currency="USD"
      />,
    )
    expect(screen.getByText('Daily budget')).toBeTruthy()
    expect(screen.getByLabelText('Increase')).toBeTruthy()
    expect(screen.getByLabelText('Decrease')).toBeTruthy()
  })

  it('Tooltip renders its trigger inside the provider', () => {
    render(
      <TooltipProvider>
        <Tooltip content="Chat actions">
          <button type="button">⋮</button>
        </Tooltip>
      </TooltipProvider>,
    )
    expect(screen.getByText('⋮')).toBeTruthy()
  })
})
