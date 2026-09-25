import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SidebarLeft01Icon, SidebarLeftIcon } from '@hugeicons/core-free-icons'
import { IconButton } from '@/components/brand'
import { useChatStore } from '@/stores/chat.store'
import ChatThreadScreen from '@/routes/chat/ChatThreadScreen'

/**
 * Muse's side-by-side chat (HatchSideChatLayoutToggle): on Feed, Ideas, Goals
 * and Library the current conversation can sit beside the page. Width follows
 * Muse's bounds — at least 360px, at most half the window — and, like the
 * open state, is remembered.
 */

const OPEN_KEY = 'clawmuse.sideChat.open'
const WIDTH_KEY = 'clawmuse.sideChat.width'
const MIN_WIDTH = 360

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* per-window only */ }
}

export function clampSideChatWidth(width: number, windowWidth: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, Math.max(MIN_WIDTH, windowWidth * 0.5))))
}

export function useSideChat() {
  const [open, setOpen] = useState(() => read(OPEN_KEY) === '1')
  return {
    open,
    toggle: () => setOpen((value) => { write(OPEN_KEY, value ? '0' : '1'); return !value }),
  }
}

export function SideChatToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <IconButton
      icon={open ? SidebarLeftIcon : SidebarLeft01Icon}
      label={open ? 'Maximize' : 'Open side-by-side chat'}
      onClick={onToggle}
      className="text-content-secondary"
    />
  )
}

export function SideChatPanel() {
  const currentSessionId = useChatStore((state) => state.currentSessionId)
  const createSession = useChatStore((state) => state.createSession)
  const [sessionId] = useState(() => currentSessionId ?? createSession())
  const [width, setWidth] = useState(() => clampSideChatWidth(Number(read(WIDTH_KEY)) || 480, window.innerWidth))
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const onResize = () => setWidth((current) => clampSideChatWidth(current, window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    drag.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!drag.current) return
    setWidth(clampSideChatWidth(drag.current.startWidth + event.clientX - drag.current.startX, window.innerWidth))
  }
  function onPointerUp(): void {
    if (drag.current) write(WIDTH_KEY, String(width))
    drag.current = null
  }

  return (
    <div className="relative flex h-full shrink-0 border-r border-line-hairline" style={{ width }}>
      <div className="min-w-0 flex-1"><ChatThreadScreen sessionId={sessionId} /></div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          const next = clampSideChatWidth(width + (event.key === 'ArrowRight' ? 24 : -24), window.innerWidth)
          setWidth(next)
          write(WIDTH_KEY, String(next))
        }}
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 hover:after:bg-line focus-visible:after:bg-muse-blue"
      />
    </div>
  )
}
