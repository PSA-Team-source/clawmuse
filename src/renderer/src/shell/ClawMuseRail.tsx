import { useEffect, useState } from 'react'
import { keys } from '@/lib/platform'
import { useLocation, useNavigate } from 'react-router-dom'
import { Menu01Icon } from '@hugeicons/core-free-icons'
import { IconButton } from '@/components/brand'
import { Dialog, Menu, Tooltip } from '@/components/primitives'
import { MuseNavigationIcon } from './MuseNavigationIcon'
import { cn } from '@/lib/cn'
import { useAgentIdentity } from '@/lib/identity'
import { AgentAvatar } from '@/components/status/AgentAvatar'

const NAV = [
  { label: 'Chat', path: '/chat' },
  { label: 'Search', path: '/search' },
  { label: 'Feed', path: '/feed' },
  { label: 'Ideas', path: '/ideas' },
  { label: 'Goals', path: '/goals' },
  { label: 'Library', path: '/library' },
] as const

/** Muse's compact navigation model, backed by the real local runtime. */
export function ClawMuseRail({ onOpenSearch }: { onOpenSearch: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [report, setReport] = useState('')
  const [reportSaved, setReportSaved] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [savingReport, setSavingReport] = useState(false)
  const [quickShortcut, setQuickShortcut] = useState<string | null>(null)

  useEffect(() => {
    if (shortcutsOpen) void window.clawmuse.shortcut.get().then(setQuickShortcut).catch(() => setQuickShortcut(null))
  }, [shortcutsOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key === 'Escape') {
        const composer = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Message"]')
        if (composer) { event.preventDefault(); composer.focus() }
        return
      }
      if (!event.metaKey) return
      if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
        event.preventDefault()
        onOpenSearch()
      }
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        navigate('/chat')
      }
      if (event.key === '/') {
        event.preventDefault()
        setShortcutsOpen(true)
      }
      if (event.key === ',') {
        event.preventDefault()
        void window.clawmuse.window.open('settings')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, onOpenSearch])

  const agent = useAgentIdentity()
  const onChat = location.pathname === '/chat' || location.pathname.startsWith('/chat/')

  // Muse's Chat button returns to the main chat; side chats start from the Chats panel.
  function openChat(): void {
    navigate('/chat')
  }

  async function saveReport(): Promise<void> {
    const description = report.trim()
    if (!description || savingReport) return
    setSavingReport(true)
    setReportError(null)
    const result = await window.clawmuse.app.saveIssueReport(description)
    setSavingReport(false)
    if (result.ok) setReportSaved(result.path.split('/').pop() ?? result.path)
    else setReportError(result.error)
  }

  return (
    <aside data-testid="clawmuse-rail" className="drag relative flex h-full w-[77px] shrink-0 flex-col items-center border-r border-line-hairline bg-bg-base pb-3 pt-10">
      {/* Muse's rail opens with the agent itself: its avatar in a 44pt white
          disc. On a chat the avatar moves to the chat nav instead. */}
      {!onChat && (
        <button type="button" onClick={() => navigate('/chat')} aria-label={agent.data?.name ? `Open ${agent.data.name}` : 'Open ClawMuse'} className="no-drag flex size-11 items-center justify-center rounded-full shadow-composer">
          <AgentAvatar size={44} />
        </button>
      )}

      <nav className="no-drag absolute top-[49%] flex -translate-y-1/2 flex-col items-center gap-3" aria-label="ClawMuse">
        {NAV.map((item) => {
          const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
          return (
            <Tooltip key={item.path} content={item.label} side="right">
              <button
                type="button"
                data-nav={item.label.toLowerCase()}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => item.path === '/chat' ? openChat() : item.path === '/search' ? onOpenSearch() : navigate(item.path)}
                className={cn(
                  'flex size-11 items-center justify-center rounded-full text-content-primary transition-colors hover:bg-fill-raised',
                  active && 'bg-fill-accent',
                )}
              >
                <MuseNavigationIcon name={item.label} />
              </button>
            </Tooltip>
          )
        })}
      </nav>

      <div className="no-drag mt-auto flex flex-col items-center gap-2">
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={<IconButton icon={Menu01Icon} label="ClawMuse menu" shape="circle" size="sm" className="text-content-primary" />}
        >
          <Menu.Item onClick={() => setShortcutsOpen(true)}><span className="flex flex-1 justify-between gap-6"><span>Keyboard shortcuts</span><kbd className="text-content-faint">{keys('⌘/')}</kbd></span></Menu.Item>
          <Menu.Item onClick={() => { setReport(''); setReportSaved(null); setReportError(null); setReportOpen(true) }}>Report an issue</Menu.Item>
          <Menu.Separator />
          <Menu.Item onClick={() => void window.clawmuse.window.open('settings')}><span className="flex flex-1 justify-between gap-6"><span>Settings</span><kbd className="text-content-faint">{keys('⌘,')}</kbd></span></Menu.Item>
        </Menu>
      </div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="Keyboard Shortcuts" className="muse-shortcuts-dialog max-h-[90vh] w-[420px] overflow-y-auto p-4">
        {quickShortcut && <section className="mb-5"><h3 className="mb-1.5 text-muse-artifact-name text-content-secondary">Shortcuts</h3><button type="button" onClick={() => { setShortcutsOpen(false); navigate('/settings') }} className="flex w-full items-center justify-between rounded-field bg-fill-raised px-3 py-3 text-muse-artifact-name"><span>Quick access</span><span className="text-content-secondary">{quickShortcut.replace('Alt', 'Option')} ›</span></button></section>}
        <section className="mb-5"><h3 className="mb-1.5 text-muse-artifact-name text-content-secondary">Reference</h3><div className="divide-y divide-line-hairline rounded-field bg-fill-raised px-3">{[['Open settings', '⌘,'], ['Dismiss', 'Esc']].map(([label, keys]) => <div key={label} className="flex items-center justify-between py-2.5 text-muse-artifact-name"><span>{label}</span><kbd className="font-sans text-content-secondary">{keys}</kbd></div>)}</div></section>
        {[
          { title: 'General', rows: [['Chat with ClawMuse', '⌘J'], ['Search ClawMuse', '⌘K'], ['Settings', '⌘,'], ['Keyboard shortcuts', '⌘/']] },
          { title: 'Composer', rows: [['Focus composer', '⇧Esc'], ['Send message', '↩'], ['New line', '⇧↩']] },
        ].map((section) => <section key={section.title} className="mb-5 last:mb-0"><h3 className="mb-1.5 text-muse-artifact-name text-content-secondary">{section.title}</h3>{section.rows.map(([label, shortcut]) => <div key={label} className="flex items-center justify-between py-1 text-caption"><span>{label}</span><kbd className="font-sans text-content-secondary">{keys(shortcut ?? "")}</kbd></div>)}</section>)}
      </Dialog>

      <Dialog open={reportOpen} onOpenChange={setReportOpen} title="Report a bug" className="w-[720px]">
        {reportSaved ? (
          <div className="space-y-4"><p className="text-body-sm text-content-body">Saved to your Downloads folder as “{reportSaved}”, with recent app and local agent logs. Attach it wherever you ask for help.</p><div className="flex justify-end"><button type="button" onClick={() => setReportOpen(false)} className="rounded-full bg-content-primary px-4 py-2 text-caption font-semibold text-white">Done</button></div></div>
        ) : (
          <div>
            <p className="text-body-sm text-content-tertiary">Describe what went wrong. ClawMuse saves it with recent app and local agent logs to your Downloads folder, so you can share it.</p>
            <label className="mt-5 block text-body-sm font-semibold text-content-primary">What went wrong?<textarea value={report} onChange={(event) => setReport(event.target.value)} autoFocus rows={8} className="mt-2 w-full resize-none rounded-field border border-line px-3 py-2 font-normal outline-none focus:border-line-strong" /></label>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setReportOpen(false)} className="rounded-full px-4 py-2 text-caption font-semibold hover:bg-fill-raised">Cancel</button><button type="button" disabled={!report.trim() || savingReport} onClick={() => void saveReport()} className="rounded-full bg-content-primary px-4 py-2 text-caption font-semibold text-white disabled:opacity-40">{savingReport ? 'Saving…' : 'Save report'}</button></div>
            {reportError && <p role="alert" className="mt-3 text-body-sm text-error">{reportError}</p>}
          </div>
        )}
      </Dialog>
    </aside>
  )
}
