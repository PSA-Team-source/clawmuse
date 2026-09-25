import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ConnectionBanner } from '@/components/gateway'
import { ExecApprovalModal, PluginApprovalModal } from '@/components/approvals'
import { usePluginApprovalsStore } from '@/stores/plugin-approvals.store'
import { useApprovalsStore } from '@/stores/approvals.store'
import { useChatStore } from '@/stores/chat.store'
import { useGatewayStore } from '@/stores/gateway.store'
import { useDeepLinks, useFloatingButtonDrops, useGatewayLifecycle, useMenuCommands } from '@/hooks'
import { useAgentIdentitySync } from '@/lib/identity'
import { useAssistantSync } from '@/stores/assistant.store'
import { SideChatPanel, SideChatToggle, useSideChat } from '@/shell/SideChat'
import { ClawMuseRail } from '@/shell/ClawMuseRail'
import { QuickSearch } from '@/components/search/QuickSearch'
import { SettingsNavigation } from './SettingsNavigation'

/**
 * Muse-style persistent frame around the single local assistant.
 */
export function AppShell() {
  const navigate = useNavigate()
  const pathname = useLocation().pathname
  const isSettings = pathname.startsWith('/settings')
  // Muse offers side-by-side chat on its route pages.
  const sideChatRoute = ['/feed', '/ideas', '/goals', '/library'].some((route) => pathname === route || pathname.startsWith(`${route}/`))
  const sideChat = useSideChat()
  const connectionState = useGatewayStore((state) => state.connectionState)
  const reconnect = useGatewayStore((state) => state.reconnect)

  const approval = useApprovalsStore((state) => state.current)
  const pendingCount = useApprovalsStore((state) => state.queue.length)
  const resolveApproval = useApprovalsStore((state) => state.resolve)

  const createSession = useChatStore((state) => state.createSession)
  const currentSessionId = useChatStore((state) => state.currentSessionId)
  const abortSession = useChatStore((state) => state.abortSession)
  const [searchOpen, setSearchOpen] = useState(false)

  useGatewayLifecycle()
  useDeepLinks()
  useFloatingButtonDrops()
  useAgentIdentitySync()
  useAssistantSync()
  const connected = useGatewayStore((state) => state.connectionState === 'connected')
  useEffect(() => { if (connected) void usePluginApprovalsStore.getState().load() }, [connected])

  useMenuCommands({
    'new-chat': () => {
      const id = createSession()
      navigate(`/chat/${encodeURIComponent(id)}`)
    },
    'open-settings': () => { void window.clawmuse.window.open('settings') },
    'open-tasks': () => navigate('/tasks'),
    'toggle-room': () => navigate('/chat'),
    'abort-stream': () => {
      if (currentSessionId) void abortSession(currentSessionId)
    },
    'focus-composer': () => document.querySelector<HTMLTextAreaElement>('textarea')?.focus(),
  })

  return (
    <div className="flex h-full w-full bg-bg-base text-content-primary">
      {isSettings ? <SettingsNavigation /> : <ClawMuseRail onOpenSearch={() => setSearchOpen(true)} />}

      {/* Each Muse surface owns its own compact header. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner state={connectionState} onRetry={() => void reconnect()} />

        <main className={`relative flex min-h-0 flex-1 overflow-hidden${isSettings ? ' muse-settings-content' : ''}`}>
          {sideChatRoute && sideChat.open && <SideChatPanel />}
          <div className="relative min-w-0 flex-1">
            {/* Not on Library: its own sidebar sits under this corner (the toggle covered its search field), and Muse shows none there either. */}
            {sideChatRoute && !pathname.startsWith('/library') && <div className="no-drag absolute left-3 top-2 z-30"><SideChatToggle open={sideChat.open} onToggle={sideChat.toggle} /></div>}
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global: the agent is blocked until this is answered, so it must render
          above whatever screen the user happens to be on. */}
      <PluginApprovalModal />
      <ExecApprovalModal
        approval={approval}
        pendingCount={pendingCount}
        onResolve={(id, approved) => void resolveApproval(id, approved)}
      />
      <QuickSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenSplitView={sideChatRoute && !sideChat.open ? sideChat.toggle : undefined}
      />
    </div>
  )
}
