import { NavLink } from 'react-router-dom'
import {
  AiBrain01Icon,
  File01Icon,
  ArrowLeft01Icon,
  BubbleChatIcon,
  GridViewIcon,
  HelpCircleIcon,
  Hold01Icon,
  LaptopIcon,
  Mic01Icon,
  Notification01Icon,
  SecurityCheckIcon,
  SecurityLockIcon,
  Settings01Icon,
  SmartPhone01Icon,
  SquareLock01Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons'
import { Icon } from '@/components/primitives'

const sections = [
  { label: 'General', path: '/settings', exact: true, icon: Settings01Icon },
  { label: 'Connectors', path: '/settings/connectors', icon: GridViewIcon },
  { label: 'File system access', path: '/settings/files', icon: File01Icon },
  { label: 'Dictation', path: '/settings/dictation', icon: Mic01Icon },
  { label: 'Wallet', path: '/settings/wallet', icon: Wallet01Icon },
  { label: 'Secure store', path: '/settings/secure-store', icon: SecurityLockIcon },
  { label: 'Permissions', path: '/settings/security', icon: Hold01Icon },
  { label: 'Model & thinking', path: '/settings/model', icon: AiBrain01Icon },
  { label: 'Notifications', path: '/settings/notifications', icon: Notification01Icon },
  { label: 'Messaging channels', path: '/settings/channels', icon: BubbleChatIcon },
  { label: 'Devices', path: '/settings/devices', icon: SmartPhone01Icon },
  { label: 'Local agent', path: '/settings/runtime', icon: LaptopIcon },
  { label: 'Data controls', path: '/settings/data', icon: SquareLock01Icon },
  { label: 'Help & support', path: '/settings/about', icon: HelpCircleIcon },
  { label: 'Legal info', path: '/settings/legal', icon: SecurityCheckIcon },
]

// Muse's SettingsTabButton: 32px row, 20px icon slot, 14px label, medium when active.
const itemClass = (active: boolean) =>
  `flex h-8 items-center gap-2.5 rounded-xl px-2 text-body-sm text-content-primary ${active ? 'bg-fill-strong font-medium' : 'hover:bg-fill-strong'}`

/** Persistent settings navigation; every destination is an implemented local screen. */
export function SettingsNavigation() {
  return (
    <aside className="drag flex w-56 shrink-0 flex-col border-r border-line-hairline bg-bg-base px-4 pb-4 pt-9">
      <h1 className="sr-only">Settings</h1>
      <nav aria-label="Settings" className="no-drag flex flex-col gap-1">
        {sections.map((section) => (
          <NavLink key={section.path} to={section.path} end={section.exact} className={({ isActive }) => itemClass(isActive)}>
            <span className="inline-flex size-5 shrink-0 items-center justify-center"><Icon icon={section.icon} size={16} /></span>
            {section.label}
          </NavLink>
        ))}
      </nav>
      <NavLink to="/chat" className="no-drag mt-auto flex h-8 items-center gap-2.5 rounded-xl px-2 text-body-sm text-content-primary hover:bg-fill-strong">
        <span className="inline-flex size-5 shrink-0 items-center justify-center"><Icon icon={ArrowLeft01Icon} size={16} /></span>
        Back to chat
      </NavLink>
    </aside>
  )
}
