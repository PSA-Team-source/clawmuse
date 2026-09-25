import { useEffect, useState } from 'react'
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { ChatComposer, MessageList } from '@/components/chat'
import { PendingQuestions } from '@/components/questions'
import { Icon } from '@/components/primitives'
import { useSession } from '@/hooks'
import { MAIN_SESSION_KEY } from '@/services/session-key'
import { useGatewayStore } from '@/stores/gateway.store'

/**
 * The ⌥Space panel: a standalone 720×480 frameless, transparent window with
 * no sidebar. It is its own renderer window, so — unlike the main window,
 * which gets `useGatewayLifecycle()` via `AppShell` — it must kick its own
 * reconnect if the socket is not already live.
 */
export default function QuickChatScreen() {
  const connectionState = useGatewayStore((state) => state.connectionState)
  const reconnect = useGatewayStore((state) => state.reconnect)
  const { messages, streamingText, streamingThinking, isTyping, send, abort } =
    useSession(MAIN_SESSION_KEY)

  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (connectionState === 'idle' || connectionState === 'disconnected' || connectionState === 'error') {
      void reconnect()
    }
    // Mount-only: this window does not own the gateway lifecycle the way
    // `AppShell` does for the main window (no focus/online reconnect here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') void window.clawmuse.window.closeSelf()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await send(text)
  }

  const connected = connectionState === 'connected'

  return (
    <div className="material-regular rounded-box flex h-full w-full flex-col overflow-hidden">
      <div className="drag flex h-8 shrink-0 items-center justify-end px-3">
        <button
          type="button"
          onClick={() => void window.clawmuse.window.open('main')}
          className="no-drag flex items-center gap-1 rounded-full px-2 py-1 text-micro text-content-tertiary transition-colors hover:bg-fill-raised hover:text-content-primary"
        >
          Open full app
          <Icon icon={ArrowUpRight01Icon} size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        <MessageList
          messages={messages}
          streamingText={streamingText}
          streamingThinking={streamingThinking}
          isTyping={isTyping}
        />
      </div>

      <div className="shrink-0 border-t border-line-hairline p-3">
        <PendingQuestions sessionKeys={[MAIN_SESSION_KEY]} />
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSend={() => void handleSend()}
          onStop={() => abort()}
          isStreaming={isTyping}
          disabled={!connected}
          placeholder={connected ? 'Message ClawMuse…' : 'Connecting…'}
          autoFocus
        />
      </div>
    </div>
  )
}
