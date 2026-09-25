import { lazy, Suspense, useEffect } from 'react'
import { Cancel01Icon, Edit02Icon, FingerPrintIcon, UserCircleIcon, LeftToRightListBulletIcon, SecurityCheckIcon, TimeQuarterPassIcon } from '@hugeicons/core-free-icons'
import { IconButton } from '@/components/brand'
import { Icon, Menu } from '@/components/primitives'
import { AgentAvatar } from '@/components/status/AgentAvatar'
import { AgentStateLabel } from '@/components/status/AgentStateLabel'
import { useAgentIdentity } from '@/lib/identity'
import { useAgentStatus } from '@/lib/agent-status'
import { cn } from '@/lib/cn'
import { prefillComposer } from '@/lib/composer-prefill'
import { useStatusPanel, type StatusTab } from '@/stores/status-panel.store'

const ActivityTab = lazy(() => import('@/routes/status/ActivityTab'))
const ApprovalsTab = lazy(() => import('@/routes/status/ApprovalsTab'))
const UpcomingTab = lazy(() => import('@/routes/status/UpcomingTab'))
const IdentityTab = lazy(() => import('@/routes/status/IdentityTab'))

const TABS: { value: StatusTab; label: string; icon: unknown }[] = [
  { value: 'activity', label: 'Activity', icon: LeftToRightListBulletIcon },
  { value: 'approvals', label: 'Approvals', icon: SecurityCheckIcon },
  { value: 'upcoming', label: 'Upcoming', icon: TimeQuarterPassIcon },
  { value: 'identity', label: 'Identity', icon: FingerPrintIcon },
]

const CONTENT: Record<StatusTab, React.ComponentType> = { activity: ActivityTab, approvals: ApprovalsTab, upcoming: UpcomingTab, identity: IdentityTab }

/**
 * Muse's status panel ("Bot status"): a 360pt side panel on the chat with the
 * agent's avatar, name and state, then icon tabs for Activity, Approvals,
 * Upcoming and Identity. Escape closes it.
 */
export function StatusPanel({ sessionId }: { sessionId: string | null }) {
  const { open, tab, setTab, close } = useStatusPanel()
  const identity = useAgentIdentity()
  const status = useAgentStatus(sessionId)

  // Muse closes the panel on Escape unless another control has focus.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return
      const target = event.target instanceof Element ? event.target : null
      if (target && target !== document.body && !target.closest('[data-testid="status-panel"]')) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  if (!open) return null
  const Content = CONTENT[tab]
  const name = identity.data?.name?.trim() ?? ''

  return (
    <aside
      aria-label="Bot status"
      data-testid="status-panel"
      className="no-drag relative flex h-full w-[360px] shrink-0 flex-col border-l border-line-hairline bg-bg-base"
    >
      <div className="absolute right-3 top-0 z-10 flex h-15 items-center">
        <IconButton icon={Cancel01Icon} label="Close panel" shape="circle" onClick={close} className="text-content-secondary" />
      </div>

      <div className="flex shrink-0 flex-col items-center px-4 pb-11 pt-17.5">
        <div className="relative">
          <AgentAvatar size={100} className="shadow-composer" />
          {/* Muse's "Edit avatar and name": the agent changes itself, so the
              menu starts the request in the composer. */}
          <Menu
            align="end"
            trigger={<IconButton icon={Edit02Icon} label="Edit avatar and name" shape="circle" size="sm" className="absolute -right-2 top-0 bg-fill-raised" />}
          >
            <Menu.Item onClick={() => prefillComposer('Change your avatar to ')}>
              <Icon icon={UserCircleIcon} size={15} className="text-current" />
              Change avatar
            </Menu.Item>
            <Menu.Item onClick={() => prefillComposer('Change your name to ')}>
              <Icon icon={Edit02Icon} size={15} className="text-current" />
              Edit name
            </Menu.Item>
          </Menu>
        </div>
        <span className="muse-status-pill mt-2">
          {name && <span className="block max-w-full truncate text-muse-artifact-name font-medium text-content-primary">{name}</span>}
          <AgentStateLabel status={status} variant="panel" />
        </span>
      </div>

      <div className="px-4 pb-2">
        <div role="tablist" aria-label="Status" className="flex rounded-full bg-fill-raised p-1">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              aria-label={item.label}
              title={item.label}
              onClick={() => setTab(item.value)}
              className={cn('flex h-8 flex-1 items-center justify-center rounded-full transition-colors', tab === item.value ? 'bg-bg-panel text-content-primary shadow-composer' : 'text-content-secondary hover:text-content-primary')}
            >
              <Icon icon={item.icon} size={20} className="text-current" />
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" aria-label={TABS.find((item) => item.value === tab)?.label} className="min-h-0 flex-1 overflow-y-auto">
        <Suspense fallback={null}>
          <Content />
        </Suspense>
      </div>
    </aside>
  )
}
