import { SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { DEVICE, IS_WINDOWS } from '@/lib/platform'
import { useToast } from '@/components/patterns'
import { Select, Switch } from '@/components/primitives'
import { useSettingsStore } from '@/stores/settings.store'
import { useAssistantStore } from '@/stores/assistant.store'
import type { AssistantSettings } from '@shared/assistant'
import { failureNotice } from '@/lib/failure-notice'

const HOURS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, '0')}:00`
  return { value, label: new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }
})
const FREQUENCY = [
  { value: '1', label: 'Once a day' },
  { value: '2', label: 'Up to twice a day' },
  { value: '4', label: 'Up to 4 times a day' },
]

/** A saved time that is not on the hour still shows (and stays selected). */
function hourItems(value: string) {
  return HOURS.some((hour) => hour.value === value) ? HOURS : [{ value, label: value }, ...HOURS]
}

/**
 * The built-in assistant's schedule: check-ins in the Main chat, the daily
 * Feed edition and Ideas refresh. Main runs them; this only edits settings.
 */
function ProactiveSettings() {
  const assistant = useAssistantStore((store) => store.state)
  if (!assistant) return null
  const { settings, jobs } = assistant
  const update = (patch: Partial<AssistantSettings>) => void window.clawmuse.assistant.setSettings(patch)
  const checkin = jobs.checkin
  const status = checkin.running ? checkin.running.phase : checkin.lastError ? failureNotice(checkin.lastError) : checkin.note

  return (
    <div className="flex flex-col gap-2">
      <SettingsGroup title="Proactive assistant" className="mb-0">
        <SettingsRow
          label="Check in with me"
          description="Messages you in Main chat when there is something useful — a next step on a goal, a follow-up, or news that matters to you."
          right={<Switch checked={settings.checkIns} onCheckedChange={(checkIns) => update({ checkIns })} aria-label="Check in with me" />}
        />
        {settings.checkIns && <>
          <SettingsRow label="How often" right={<Select size="compact" className="muse-plain-select" aria-label="How often" value={String(settings.checkInsPerDay)} items={FREQUENCY} onValueChange={(value) => update({ checkInsPerDay: Number(value) as AssistantSettings['checkInsPerDay'] })} />} />
          <SettingsRow label="Active from" right={<Select size="compact" className="muse-plain-select" aria-label="Active from" value={settings.activeStart} items={hourItems(settings.activeStart)} onValueChange={(activeStart) => update({ activeStart })} />} />
          <SettingsRow label="Until" right={<Select size="compact" className="muse-plain-select" aria-label="Active until" value={settings.activeEnd} items={hourItems(settings.activeEnd)} onValueChange={(activeEnd) => update({ activeEnd })} />} />
          <SettingsRow label="Check in now" description={status ?? 'Asks the assistant whether it has anything for you right now'} right={<SettingsButton disabled={Boolean(checkin.running) || !assistant.available} onClick={() => void window.clawmuse.assistant.run('checkin')}>{checkin.running ? 'Checking…' : 'Check in'}</SettingsButton>} />
        </>}
        <SettingsRow
          label="Daily feed"
          description="Writes a fresh Feed edition from the latest news around your goals."
          right={<Switch checked={settings.dailyFeed} onCheckedChange={(dailyFeed) => update({ dailyFeed })} aria-label="Daily feed" />}
        />
        {settings.dailyFeed && <SettingsRow label="Feed time" right={<Select size="compact" className="muse-plain-select" aria-label="Feed time" value={settings.feedTime} items={hourItems(settings.feedTime)} onValueChange={(feedTime) => update({ feedTime })} />} />}
        <SettingsRow
          label="Refresh ideas daily"
          right={<Switch checked={settings.dailyIdeas} onCheckedChange={(dailyIdeas) => update({ dailyIdeas })} aria-label="Refresh ideas daily" />}
        />
      </SettingsGroup>
      <p className="px-3 text-footnote text-content-secondary">Runs while ClawMuse is open, including from the {IS_WINDOWS ? 'notification area' : 'menu bar'}. Check-ins only arrive during active hours, while you are at your {DEVICE}, and never while you are mid-conversation.</p>
    </div>
  )
}

export default function NotificationsScreen() {
  const toast = useToast()
  const notificationsEnabled = useSettingsStore((state) => state.notificationsEnabled)
  const notifyMessages = useSettingsStore((state) => state.notifyMessages)
  const notifyTasks = useSettingsStore((state) => state.notifyTasks)
  const notifyChannels = useSettingsStore((state) => state.notifyChannels)
  const updateSetting = useSettingsStore((state) => state.updateSetting)

  async function handleSendTest(): Promise<void> {
    await window.clawmuse.notifications.show({ title: 'ClawMuse', body: 'This is a test notification.' })
    toast.show({ title: 'Notification sent' })
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-7 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">Notifications</h1>

        <SettingsGroup>
          <SettingsRow
            label="Enable notifications"
            right={
              <Switch
                checked={notificationsEnabled}
                onCheckedChange={(v) => updateSetting('notificationsEnabled', v)}
                aria-label="Enable notifications"
              />
            }
          />
          <SettingsRow
            label="New messages"
            right={
              <Switch
                checked={notifyMessages}
                onCheckedChange={(v) => updateSetting('notifyMessages', v)}
                aria-label="Notify on new messages"
                disabled={!notificationsEnabled}
              />
            }
          />
          <SettingsRow
            label="Task completed"
            right={
              <Switch
                checked={notifyTasks}
                onCheckedChange={(v) => updateSetting('notifyTasks', v)}
                aria-label="Notify when a task completes"
                disabled={!notificationsEnabled}
              />
            }
          />
          <SettingsRow
            label="Channel activity"
            right={
              <Switch
                checked={notifyChannels}
                onCheckedChange={(v) => updateSetting('notifyChannels', v)}
                aria-label="Notify on channel activity"
                disabled={!notificationsEnabled}
              />
            }
          />
        </SettingsGroup>

        <ProactiveSettings />

        <div className="flex flex-col gap-2">
          <SettingsGroup className="mb-0">
            <SettingsRow label="Test notification" description="Sends one now so you can check how it looks" right={<SettingsButton onClick={() => void handleSendTest()}>Send</SettingsButton>} />
          </SettingsGroup>
          <p className="px-3 text-footnote text-content-secondary">You will be notified about approvals, completed tasks, and channel activity even while ClawMuse is in the background.</p>
        </div>
      </div>
    </div>
  )
}
