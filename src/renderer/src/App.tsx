import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Route, HashRouter as Router, Routes, useLocation, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import { Spinner } from '@/components/brand'
import { ToastProvider } from '@/components/patterns'
import { TooltipProvider } from '@/components/primitives'
import { AppShell } from '@/shell/AppShell'
import { ShareCardDialog } from '@/components/share/ShareCardDialog'
import { useGatewayStore } from '@/stores/gateway.store'
import { useRuntimeStore } from '@/stores/runtime.store'
import { watchAppearance } from '@/stores/appearance.store'
import { reportChatBusy } from '@/stores/chat.store'
import { AGENT_ID } from '@/lib/identity'
import { botMainSessionKey } from '@/services/session-key'

const MAIN_CHAT_PATH = `/chat/${encodeURIComponent(botMainSessionKey(AGENT_ID))}`

// Route-level code splitting: the roster should not pay for three.js or the
// terminal's xterm bundle until something asks for them.
const StartScreen = lazy(() => import('@/routes/onboarding/StartScreen'))
const LocalBootScreen = lazy(() => import('@/routes/onboarding/LocalBootScreen'))
const LocalSetupScreen = lazy(() => import('@/routes/onboarding/LocalSetupScreen'))
import { needsWelcome } from '@/lib/goals'
const WelcomeScreen = lazy(() => import('@/routes/onboarding/WelcomeScreen'))
const ChatThreadScreen = lazy(() => import('@/routes/chat/ChatThreadScreen'))
const SettingsScreen = lazy(() => import('@/routes/settings/SettingsScreen'))
const LegalScreen = lazy(() => import('@/routes/settings/LegalScreen'))
const LegalInfoScreen = lazy(() => import('@/routes/settings/LegalScreen').then((module) => ({ default: module.LegalInfoScreen })))
const ModelScreen = lazy(() => import('@/routes/settings/ModelScreen'))
const DictationScreen = lazy(() => import('@/routes/settings/DictationScreen'))
const DevicesScreen = lazy(() => import('@/routes/settings/DevicesScreen'))
const FileAccessScreen = lazy(() => import('@/routes/settings/FileAccessScreen'))
const DataControlsScreen = lazy(() => import('@/routes/settings/DataControlsScreen'))
const ChannelsScreen = lazy(() => import('@/routes/settings/ChannelsScreen'))
const WalletScreen = lazy(() => import('@/routes/settings/WalletScreen'))
const SecureStoreScreen = lazy(() => import('@/routes/settings/SecureStoreScreen'))
const NotificationsScreen = lazy(() => import('@/routes/settings/NotificationsScreen'))
const AboutScreen = lazy(() => import('@/routes/settings/AboutScreen'))
const SecurityScreen = lazy(() => import('@/routes/settings/SecurityScreen'))
const ConnectorsScreen = lazy(() => import('@/routes/settings/ConnectorsScreen'))
const QuickChatScreen = lazy(() => import('@/routes/quick/QuickChatScreen'))
const FeedScreen = lazy(() => import('@/routes/muse/MuseScreens').then((module) => ({ default: module.FeedScreen })))
const IdeasScreen = lazy(() => import('@/routes/muse/MuseScreens').then((module) => ({ default: module.IdeasScreen })))
const GoalsScreen = lazy(() => import('@/routes/muse/MuseScreens').then((module) => ({ default: module.GoalsScreen })))
const LibraryScreen = lazy(() => import('@/routes/muse/MuseScreens').then((module) => ({ default: module.LibraryScreen })))

function FullscreenSpinner() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg-base">
      <Spinner size={28} />
    </div>
  )
}

/**
 * Entry gate.
 *
 * There is no account, so there is nothing to authenticate — the only questions
 * are whether this machine has a model to think with and whether the agent on
 * it is up. Both are answered locally, and a failure in either stays a local
 * failure with a local remedy.
 */
function RequireRuntime({ children }: { children: React.ReactNode }) {
  const providerSkipped = useRuntimeStore((state) => state.providerSkipped)
  const connectionState = useGatewayStore((state) => state.connectionState)
  const location = useLocation()
  const [needsProvider, setNeedsProvider] = useState<boolean | null>(null)

  useEffect(() => {
    void window.clawmuse.runtime.providerConfigured().then((ok) => setNeedsProvider(!ok))
  }, [])

  // A gateway with no provider starts happily and then fails on the first
  // message, so route to setup before the user can hit that. `/start` is the
  // one-card confirm; it forwards to the full wizard only when this machine
  // turns out to have no credential at all.
  if (needsProvider === null) return <FullscreenSpinner />
  if (
    needsProvider &&
    !providerSkipped &&
    location.pathname !== '/local-setup' &&
    location.pathname !== '/start'
  ) {
    return <Navigate to="/start" replace />
  }
  if (connectionState !== 'connected' && location.pathname !== '/local-boot') {
    return <Navigate to="/local-boot" state={{ returnTo: location.pathname + location.search }} replace />
  }
  if (location.pathname !== '/welcome' && needsWelcome()) return <Navigate to="/welcome" replace />
  return <>{children}</>
}

/**
 * Remounts the thread screen whenever the session changes.
 *
 * Keying is React's sanctioned way to reset state on a prop change — it gives
 * each thread a fresh composer, attachment list and menu state, and makes the
 * blob-URL cleanup run per session instead of only on final unmount.
 */
function KeyedChatThread() {
  const { sessionId } = useParams()
  return <ChatThreadScreen key={sessionId} />
}

function AppRoutes() {
  return (
    <Suspense fallback={<FullscreenSpinner />}>
      <Routes>
        {/* The ⌥Space panel renders standalone — no roster, no title strip. */}
        <Route path="/quick" element={<QuickChatScreen />} />

        {/* Asked once, after a model is set up: what the user is working toward. */}
        <Route path="/welcome" element={<RequireRuntime><WelcomeScreen /></RequireRuntime>} />

        {/* Entry points that run before the gateway exists, by design. */}
        <Route path="/local-boot" element={<LocalBootScreen />} />
        <Route path="/local-setup" element={<LocalSetupScreen />} />
        <Route path="/start" element={<StartScreen />} />

        <Route
          element={
            <RequireRuntime>
              <AppShell />
            </RequireRuntime>
          }
        >
          <Route path="/room" element={<Navigate to="/chat" replace />} />

          {/* Muse opens on the main chat, never an empty canvas. */}
          <Route path="/chat" element={<Navigate to={MAIN_CHAT_PATH} replace />} />
          <Route path="/chat/group/:groupId" element={<Navigate to="/chat" replace />} />
          <Route path="/chat/:sessionId" element={<KeyedChatThread />} />

          <Route path="/search" element={<Navigate to="/chat" replace />} />
          <Route path="/feed" element={<FeedScreen />} />
          <Route path="/ideas" element={<IdeasScreen />} />
          <Route path="/goals" element={<GoalsScreen />} />
          <Route path="/library" element={<LibraryScreen />} />

          <Route path="/tasks" element={<Navigate to="/goals" replace />} />
          <Route path="/tasks/:taskId" element={<Navigate to="/goals" replace />} />


          <Route path="/skills" element={<Navigate to="/settings/connectors" replace />} />
          <Route path="/skills/:skillKey" element={<Navigate to="/settings/connectors" replace />} />

          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/runtime" element={<SettingsScreen section="runtime" />} />
          <Route path="/settings/legal" element={<LegalInfoScreen />} />
          <Route path="/settings/legal/:document" element={<LegalScreen />} />
          <Route path="/settings/model" element={<ModelScreen />} />
          <Route path="/settings/dictation" element={<DictationScreen />} />
          <Route path="/settings/devices" element={<DevicesScreen />} />
          <Route path="/settings/files" element={<FileAccessScreen />} />
          <Route path="/settings/data" element={<DataControlsScreen />} />
          <Route path="/settings/channels" element={<ChannelsScreen />} />
          <Route path="/settings/wallet" element={<WalletScreen />} />
          <Route path="/settings/secure-store" element={<SecureStoreScreen />} />
          <Route path="/settings/voice" element={<Navigate to="/settings/dictation" replace />} />
          <Route path="/settings/notifications" element={<NotificationsScreen />} />
          <Route path="/settings/about" element={<AboutScreen />} />
          <Route path="/settings/connectors" element={<ConnectorsScreen />} />
          <Route path="/settings/security" element={<SecurityScreen />} />

          <Route path="/agent-studio" element={<Navigate to="/chat" replace />} />
          <Route path="/agent-studio/:slug" element={<Navigate to="/chat" replace />} />

          <Route path="/computer" element={<Navigate to="/chat" replace />} />
          <Route path="/terminal" element={<Navigate to="/chat" replace />} />
          <Route path="/files" element={<Navigate to="/library" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </Suspense>
  )
}

export function App() {
  const initRuntime = useRuntimeStore((state) => state.init)
  useEffect(watchAppearance, [])
  useEffect(reportChatBusy, [])

  useEffect(() => {
    // Subscribe before anything can trigger `ensure()`, or the first progress
    // frames land with no listener and onboarding starts mid-sequence.
    const unsubscribe = initRuntime()
    // Tells main the renderer is listening, so a deep link received during
    // startup can be replayed now.
    window.clawmuse.app.ready()
    return unsubscribe
  }, [initRuntime])

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {/* One provider for every tooltip: the first waits, and while one is
            already showing the next appears immediately. */}
        <TooltipProvider>
          {/* HashRouter, not BrowserRouter: a packaged app is loaded over
              file://, where path-based routing has no server to fall back to. */}
          <Router>
            <AppRoutes />
          </Router>
          <ShareCardDialog />
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
