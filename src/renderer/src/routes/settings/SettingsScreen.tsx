import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { UsageCard } from '@/routes/settings/UsageCard'
import { IdentityCards } from '@/routes/settings/IdentityCards'
import { useAgentAvatar, useAgentIdentity } from '@/lib/identity'
import { useToast } from '@/components/patterns'
import { Select, Switch, Tooltip } from '@/components/primitives'
import { useRuntimeStore } from '@/stores/runtime.store'
import { useSettingsStore } from '@/stores/settings.store'
import { CHAT_THEMES, chatPalette, useAppearanceStore, type Appearance } from '@/stores/appearance.store'
import type { AppPreferences, OpenclawSource, UpdateStatus } from '@shared/ipc'

/** Where the CLI came from — matters when diagnosing a version mismatch. */
const RUNTIME_SOURCE_LABEL: Record<OpenclawSource, string> = {
  'env-override': 'From CLAWMUSE_OPENCLAW_BIN',
  managed: 'Installed by ClawMuse',
  path: 'Found on your PATH',
}

/**
 * Muse's Quick Chat choices. "Tap Option twice" is a modifier-only gesture,
 * served by the native key monitor rather than Electron's globalShortcut.
 */
const SHORTCUT_PRESETS = [
  { value: 'Alt+Space', label: 'Option+Space' },
  { value: 'DoubleOption', label: 'Tap Option twice' },
  { value: 'Control+Space', label: 'Control+Space' },
] as const
const CUSTOM_SHORTCUT = '__custom__'
const NO_SHORTCUT = '__none__'

/** "Command+Alt+K" → "Command+Option+K", how macOS names the keys. */
function shortcutLabel(accelerator: string): string {
  return accelerator.replace(/\bAlt\b/g, 'Option')
}

/**
 * Builds an Electron accelerator (e.g. "Command+Option+Space") from a
 * KeyboardEvent. Returns null while only modifier keys are held, so the
 * caller keeps listening until a real key completes the combination.
 */
function acceleratorFromEvent(event: KeyboardEvent): string | null {
  const NAMED_KEYS: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
  }
  const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift'])
  if (MODIFIER_KEYS.has(event.key)) return null

  const parts: string[] = []
  if (event.metaKey) parts.push('Command')
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Option')
  if (event.shiftKey) parts.push('Shift')

  const key = NAMED_KEYS[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key)
  if (!key) return null

  parts.push(key)
  return parts.join('+')
}

export default function SettingsScreen({ section = 'general' }: { section?: 'general' | 'runtime' }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [loginItem, setLoginItem] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  const [savingLoginItem, setSavingLoginItem] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<AppPreferences | null>(null)
  const updateSetting = useSettingsStore((state) => state.updateSetting)
  const appearance = useAppearanceStore((state) => state.mode)
  const setAppearance = useAppearanceStore((state) => state.setMode)
  const chatTheme = useAppearanceStore((state) => state.chatTheme)
  const setChatTheme = useAppearanceStore((state) => state.setChatTheme)
  const agentAvatar = useAgentAvatar(useAgentIdentity().data)
  // Swatches show the colour the bubble will actually be in the current mode.
  const isDark = appearance === 'dark' || (appearance === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const runtimeStatus = useRuntimeStore((state) => state.status)
  const resolution = useRuntimeStore((state) => state.resolution)
  const restartRuntime = useRuntimeStore((state) => state.restart)
  const openRuntimeLogs = useRuntimeStore((state) => state.openLogs)

  const [restarting, setRestarting] = useState(false)

  const [shortcut, setShortcut] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    void window.clawmuse.updater.status().then(setUpdateStatus).catch(() => undefined)
    return window.clawmuse.updater.onStatus(setUpdateStatus)
  }, [])

  // The main process owns the registered accelerator — read it fresh rather
  // than trusting the cached `quickChatShortcut` setting alone.
  useEffect(() => {
    void window.clawmuse.shortcut.get().then(setShortcut)
    void window.clawmuse.app.info().then((info) => setAppVersion(info.version)).catch(() => undefined)
    void window.clawmuse.app.loginItem().then(setLoginItem).catch(() => undefined)
    void window.clawmuse.app.preferences().then(setPreferences).catch(() => undefined)
  }, [])

  async function changePreference(key: keyof AppPreferences, value: boolean): Promise<void> {
    try {
      setPreferences(await window.clawmuse.app.setPreference(key, value))
    } catch (error) {
      toast.show({ title: 'Could not update setting', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    }
  }

  async function changeLoginItem(enabled: boolean): Promise<void> {
    if (savingLoginItem) return
    setSavingLoginItem(true)
    try {
      const actual = await window.clawmuse.app.setLoginItem(enabled)
      setLoginItem({ supported: true, enabled: actual })
      updateSetting('launchAtLogin', actual)
      if (actual !== enabled) toast.show({ title: 'Startup setting was not changed', variant: 'error' })
    } catch (error) {
      toast.show({ title: 'Could not update startup setting', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    } finally { setSavingLoginItem(false) }
  }

  useEffect(() => {
    if (!recording) return

    function handleKeyDown(event: KeyboardEvent): void {
      event.preventDefault()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }

      const accelerator = acceleratorFromEvent(event)
      if (!accelerator) return // modifier-only keydown — keep listening
      if (!accelerator.includes('+')) {
        toast.show({
          title: 'Add a modifier key',
          description: 'Combine with Command, Option, Control, or Shift.',
          variant: 'error',
        })
        return
      }

      setRecording(false)
      void window.clawmuse.shortcut.set(accelerator).then((ok) => {
        if (ok) {
          setShortcut(accelerator)
          updateSetting('quickChatShortcut', accelerator)
          toast.show({ title: 'Shortcut updated', description: accelerator })
        } else {
          toast.show({
            title: 'Shortcut unavailable',
            description: `${accelerator} is already used by another app.`,
            variant: 'error',
          })
        }
      })
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recording, toast, updateSetting])

  function changeShortcut(value: string): void {
    if (value === CUSTOM_SHORTCUT) {
      setRecording(true)
      return
    }
    const accelerator = value === NO_SHORTCUT ? '' : value
    void window.clawmuse.shortcut.set(accelerator).then((ok) => {
      if (ok) {
        setShortcut(accelerator)
        updateSetting('quickChatShortcut', accelerator)
      } else {
        toast.show({ title: 'Shortcut unavailable', description: `${shortcutLabel(accelerator)} is already used by another app.`, variant: 'error' })
      }
    })
  }

  async function handleCheckForUpdates(): Promise<void> {
    if (updateStatus.state === 'downloaded' || updateStatus.state === 'manual') {
      await window.clawmuse.updater.install()
      return
    }
    setCheckingUpdate(true)
    try {
      await window.clawmuse.updater.check()
    } finally {
      setCheckingUpdate(false)
    }
  }

  async function handleRestartRuntime(): Promise<void> {
    setRestarting(true)
    try {
      await restartRuntime()
      toast.show({ title: 'Local agent restarted' })
    } catch (error) {
      toast.show({
        title: 'Restart failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      })
    } finally {
      setRestarting(false)
    }
  }

  const shortcutValue = shortcut === '' ? NO_SHORTCUT : (shortcut ?? SHORTCUT_PRESETS[0].value)
  const shortcutItems = [
    ...SHORTCUT_PRESETS,
    // A recorded combination shows as itself, the way Muse lists a custom key.
    ...(shortcut && !SHORTCUT_PRESETS.some((preset) => preset.value === shortcut) ? [{ value: shortcut, label: shortcutLabel(shortcut) }] : []),
    { value: CUSTOM_SHORTCUT, label: recording ? 'Press a key combination…' : 'Custom…' },
    { value: NO_SHORTCUT, label: 'No shortcut' },
  ]
  const updateLabel = updateStatus.state === 'downloaded' ? `Install update (${updateStatus.version})` : updateStatus.state === 'manual' ? `Download ${updateStatus.version}` : checkingUpdate || updateStatus.state === 'checking' ? 'Checking…' : 'Check for updates'
  const runtimeLabel =
    runtimeStatus.state === 'ready'
      ? runtimeStatus.attached
        ? 'Running (attached)'
        : 'Running'
      : runtimeStatus.state === 'error'
        ? 'Stopped'
        : runtimeStatus.state === 'starting'
          ? 'Starting…'
          : 'Idle'

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">{section === 'runtime' ? 'Local agent' : 'General'}</h1>

        {section === 'runtime' ? <SettingsGroup>
            <SettingsRow
              label="Status"
              value={runtimeLabel}
              description={
                runtimeStatus.state === 'ready'
                  ? `Listening on 127.0.0.1:${runtimeStatus.port}`
                  : 'The agent runs on this machine'
              }
            />
            <SettingsRow
              label="Runtime"
              value={resolution ? `openclaw ${resolution.version}` : '—'}
              description={resolution ? RUNTIME_SOURCE_LABEL[resolution.source] : undefined}
            />
            <SettingsRow label="Model provider" description="Choose or change your model" onClick={() => navigate('/local-setup')} />
            <SettingsRow
              label="Restart agent"
              description="Finishes any running task first"
              value={restarting ? 'Restarting…' : undefined}
              onClick={() => void handleRestartRuntime()}
            />
            <SettingsRow
              label="Open runtime log"
              description="~/Library/Logs/openclaw"
              onClick={() => void openRuntimeLogs()}
            />
            <SettingsRow
              label="Advanced (Control UI)"
              description="The gateway's own console — raw config, devices, activity"
              onClick={() => void window.clawmuse.window.open('control-ui')}
            />
          </SettingsGroup> : <>
        <IdentityCards />
        <UsageCard />


        <SettingsGroup title="Appearance">
          <SettingsRow label="Mode" right={<div className="muse-appearance-control" role="group" aria-label="Mode">
            {(['light', 'dark', 'system'] as Appearance[]).map((mode) => <button key={mode} type="button" aria-label={mode.charAt(0).toUpperCase() + mode.slice(1)} aria-pressed={appearance === mode} onClick={() => setAppearance(mode)}>
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                {mode === 'light' ? <><circle cx="10" cy="10" r="3" /><path d="M10 1v2m0 14v2M1 10h2m14 0h2M3.6 3.6 5 5m10 10 1.4 1.4m0-12.8L15 5M5 15l-1.4 1.4" /></> : mode === 'dark' ? <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z" /> : <><rect x="2" y="3" width="16" height="11" rx="2" /><path d="M7 17h6m-3-3v3" /></>}
              </svg>
            </button>)}
          </div>} />
          <SettingsRow label="Theme color" right={<div className="muse-theme-swatches" role="radiogroup" aria-label="Theme color">
            {agentAvatar && <Tooltip content="Match my avatar">
              <label className="muse-theme-swatch">
                <input type="radio" name="chat-theme" value="avatar" checked={chatTheme === 'avatar'} onChange={() => setChatTheme('avatar')} aria-label="Match my avatar" className="sr-only" />
                <span aria-hidden="true" className="overflow-hidden"><img src={agentAvatar} alt="" className="size-full object-cover" /></span>
                {chatTheme === 'avatar' && <span aria-hidden="true" className="muse-theme-swatch-check"><svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="m2.5 6.2 2.3 2.3 4.7-5" /></svg></span>}
              </label>
            </Tooltip>}
            {CHAT_THEMES.map((theme) => <Tooltip key={theme.id} content={theme.label}>
              <label className="muse-theme-swatch">
                <input type="radio" name="chat-theme" value={theme.id} checked={chatTheme === theme.id} onChange={() => setChatTheme(theme.id)} aria-label={theme.label} className="sr-only" />
                <span aria-hidden="true" style={{ background: chatPalette(theme.id, isDark).userBubble }} />
                {chatTheme === theme.id && <span aria-hidden="true" className="muse-theme-swatch-check">
                  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="m2.5 6.2 2.3 2.3 4.7-5" /></svg>
                </span>}
              </label>
            </Tooltip>)}
          </div>} />
        </SettingsGroup>
        {(loginItem?.supported || preferences) && <SettingsGroup title="App behavior">
          {loginItem?.supported && <SettingsRow label="Run on startup" description="Automatically open ClawMuse when you log in to your computer" right={<Switch checked={loginItem.enabled} disabled={savingLoginItem} onCheckedChange={(enabled) => void changeLoginItem(enabled)} aria-label="Run on startup" />} />}
          {preferences && <>
            <SettingsRow label="Show in menu bar" description="Access ClawMuse from the menu bar at the top of your screen" right={<Switch checked={preferences.showMenuBar} onCheckedChange={(on) => void changePreference('showMenuBar', on)} aria-label="Show in menu bar" />} />
            <SettingsRow label="Show floating button" description="Access ClawMuse from a floating button when the window is closed" right={<Switch checked={preferences.showFloatingButton} onCheckedChange={(on) => void changePreference('showFloatingButton', on)} aria-label="Show floating button" />} />
          </>}
        </SettingsGroup>}
        <SettingsGroup title="Shortcuts">
          <SettingsRow label="Quick Chat" right={<Select size="compact" className="muse-plain-select" aria-label="Quick Chat" value={recording ? CUSTOM_SHORTCUT : shortcutValue} items={shortcutItems} onValueChange={changeShortcut} />} />
        </SettingsGroup>
        <SettingsGroup title="About">
          <SettingsRow label={appVersion ? `Version ${appVersion}` : 'Version'} right={<SettingsButton disabled={checkingUpdate || updateStatus.state === 'checking'} onClick={() => void handleCheckForUpdates()}>{updateLabel}</SettingsButton>} />
        </SettingsGroup>
        </>}

      </div>
    </div>
  )
}
