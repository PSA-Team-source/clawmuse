import { useEffect, useState } from 'react'
import type { AppPreferences, KeyMonitorStatus, PushToTalkKey } from '@shared/ipc'
import { Mic01Icon } from '@hugeicons/core-free-icons'
import { SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { Dialog, Icon, Select, Switch } from '@/components/primitives'
import { TextField, useToast } from '@/components/patterns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { liveTranscriptionProviders } from '@/lib/live-dictation'
import { gatewayWS } from '@/services/gateway-ws.service'
import { useSettingsStore } from '@/stores/settings.store'

const SYSTEM_DEFAULT = '__system__'
const PTT_ITEMS: { value: PushToTalkKey; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'fn', label: 'Hold fn' },
  { value: 'option', label: 'Hold Option' },
  { value: 'control', label: 'Hold Control' },
]

/**
 * Muse's Settings > Dictation (SettingsDictationTab): the microphone grant,
 * the input device, and what happens during dictation. Every control here is
 * read by the composer's recorder.
 */
export default function DictationScreen() {
  const deviceId = useSettingsStore((state) => state.dictationDeviceId)
  const autoSend = useSettingsStore((state) => state.dictationAutoSend)
  const audioCues = useSettingsStore((state) => state.dictationAudioCues)
  const updateSetting = useSettingsStore((state) => state.updateSetting)
  const [access, setAccess] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [preferences, setPreferences] = useState<AppPreferences | null>(null)
  const [monitor, setMonitor] = useState<KeyMonitorStatus | null>(null)
  const toast = useToast()
  const queryClient = useQueryClient()
  const providers = useQuery({ queryKey: ['live-transcription'], queryFn: liveTranscriptionProviders, staleTime: 30_000 })
  const liveProvider = providers.data?.find((provider) => provider.configured)
  const [keyOpen, setKeyOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  async function saveLiveKey(value: string | null): Promise<void> {
    setSavingKey(true)
    try {
      // OpenClaw reads streaming transcription credentials from the voice-call plugin block.
      await gatewayWS.setConfig('plugins.entries.voice-call.config.streaming.providers.openai', value ? { apiKey: value } : null)
      setKeyOpen(false)
      setApiKey('')
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['live-transcription'] }), 2500)
      toast.show({ title: value ? 'Live transcription turned on' : 'Live transcription turned off' })
    } catch (error) {
      toast.show({ title: 'Could not save the key', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    } finally {
      setSavingKey(false)
    }
  }

  useEffect(() => {
    void window.clawmuse.app.preferences().then(setPreferences).catch(() => undefined)
    void window.clawmuse.app.keyMonitorStatus().then(setMonitor).catch(() => undefined)
    const off = window.clawmuse.app.onKeyMonitorStatus(setMonitor)
    // Returning from System Settings: a new Accessibility grant needs a fresh helper.
    const recheck = () => void window.clawmuse.app.recheckKeyMonitor().then(setMonitor).catch(() => undefined)
    window.addEventListener('focus', recheck)
    return () => { off(); window.removeEventListener('focus', recheck) }
  }, [])

  async function setPushToTalk(key: PushToTalkKey): Promise<void> {
    setPreferences(await window.clawmuse.app.setPreference('pushToTalk', key))
  }

  useEffect(() => {
    const refresh = () => {
      void window.clawmuse.app.microphoneAccess().then(setAccess).catch(() => setAccess('unknown'))
      void navigator.mediaDevices.enumerateDevices().then((list) => setDevices(list.filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default'))).catch(() => setDevices([]))
    }
    refresh()
    // Coming back from System Settings is the moment the grant changes.
    window.addEventListener('focus', refresh)
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [])

  const granted = access === 'granted'
  // A device that was unplugged falls back to the system default rather than failing silently.
  const selected = deviceId && devices.some((device) => device.deviceId === deviceId) ? deviceId : SYSTEM_DEFAULT
  const deviceItems = [
    { value: SYSTEM_DEFAULT, label: 'System default' },
    ...devices.map((device, index) => ({ value: device.deviceId, label: device.label || `Microphone ${index + 1}` })),
  ]

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">Dictation</h1>
        <span role="status" className="sr-only">{granted ? 'Dictation is ready' : 'Dictation needs Microphone access'}</span>

        <div className="flex flex-col gap-2">
          <SettingsGroup title="Permissions required" className="mb-0">
            <SettingsRow
              label={<span className="flex items-center gap-2"><Icon icon={Mic01Icon} size={20} className="text-content-secondary" />Microphone</span>}
              right={access === null ? undefined : granted
                ? <span className="text-body-sm text-content-secondary">Allowed</span>
                : <SettingsButton onClick={() => void window.clawmuse.app.openMicrophoneSettings()}>Open System Settings</SettingsButton>}
            />
          </SettingsGroup>
          <p className="px-3 text-footnote text-content-secondary">Dictation enables ClawMuse to turn speech to text, using your model provider's transcription.</p>
        </div>

        {monitor?.available && preferences && (
          <div className="flex flex-col gap-2">
            <SettingsGroup title="Shortcut" className="mb-0">
              <SettingsRow
                label="Push to talk"
                description="Hold the key, speak, and let go"
                right={<Select size="compact" className="muse-plain-select" aria-label="Push to talk" value={preferences.pushToTalk} items={PTT_ITEMS} onValueChange={(value) => void setPushToTalk(value as PushToTalkKey)} />}
              />
              {preferences.pushToTalk !== 'off' && monitor.trusted === false && (
                <SettingsRow label="Accessibility" description="Needed to notice the key while you use other apps" right={<SettingsButton onClick={() => void window.clawmuse.app.openAccessibilitySettings()}>Open System Settings</SettingsButton>} />
              )}
            </SettingsGroup>
            <p className="px-3 text-footnote text-content-secondary">
              {preferences.pushToTalk === 'fn' && <>Pressing fn also runs the macOS fn action, which ClawMuse cannot turn off. Set System Settings &gt; Keyboard &gt; "Press fn key to" to "Do Nothing" if it gets in the way.<br /></>}
              Dictation types what you say into whichever app you are using.
            </p>
          </div>
        )}

        <SettingsGroup className={granted ? 'mb-0' : 'mb-0 opacity-50'}>
          <SettingsRow
            label="Input device"
            right={<Select size="compact" className="muse-plain-select" aria-label="Input device" disabled={!granted} value={selected} items={deviceItems} onValueChange={(value) => updateSetting('dictationDeviceId', value === SYSTEM_DEFAULT ? '' : value)} />}
          />
        </SettingsGroup>

        {providers.data && (
          <div className="flex flex-col gap-2">
            <SettingsGroup title="Live transcription" className="mb-0">
              <SettingsRow
                label={liveProvider ? `On · ${liveProvider.label ?? liveProvider.id}` : 'Off'}
                description={liveProvider ? 'Words appear as you speak' : 'Words appear as you speak. Needs an OpenAI key — OpenRouter cannot stream transcription'}
                right={liveProvider?.id === 'openai'
                  ? <SettingsButton disabled={savingKey} onClick={() => void saveLiveKey(null)}>Remove key</SettingsButton>
                  : liveProvider ? undefined : <SettingsButton onClick={() => setKeyOpen(true)}>Add key</SettingsButton>}
              />
            </SettingsGroup>
            <p className="px-3 text-footnote text-content-secondary">Without it, ClawMuse transcribes when you finish speaking.</p>
          </div>
        )}

        <SettingsGroup title="During dictation" className={granted ? 'mb-0' : 'mb-0 opacity-50'}>
          <SettingsRow
            label="Automatically send"
            description="ClawMuse sends your message when you finish dictating"
            right={<Switch checked={autoSend} disabled={!granted} onCheckedChange={(on) => updateSetting('dictationAutoSend', on)} aria-label="Automatically send" />}
          />
          <SettingsRow
            label="Play audio cues"
            description="ClawMuse plays a sound when dictation starts and stops"
            right={<Switch checked={audioCues} disabled={!granted} onCheckedChange={(on) => updateSetting('dictationAudioCues', on)} aria-label="Play audio cues" />}
          />
        </SettingsGroup>
      </div>

      <Dialog open={keyOpen} onOpenChange={setKeyOpen} title="OpenAI key for live transcription" className="w-[420px] p-5">
        <form onSubmit={(event) => { event.preventDefault(); if (/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey.trim())) void saveLiveKey(apiKey.trim()) }} className="flex flex-col gap-4">
          <p className="text-body-sm text-content-secondary">Used only for dictation, with OpenAI's realtime transcription. Stored in your local agent's config.</p>
          <TextField label="API key" type="password" value={apiKey} onChange={setApiKey} autoFocus />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setKeyOpen(false)} className="h-8 rounded-full px-4 text-body-sm font-medium hover:bg-fill-strong">Cancel</button>
            <button type="submit" disabled={savingKey || !/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey.trim())} className="h-8 rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white disabled:opacity-45">{savingKey ? 'Saving…' : 'Turn on'}</button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
