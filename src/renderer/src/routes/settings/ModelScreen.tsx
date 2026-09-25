import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { THINKING_LEVELS } from '@/constants/models'
import { useToast } from '@/components/patterns'
import { Select, Switch } from '@/components/primitives'
import { ChoiceRow, SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { loadModels } from '@/services/model-catalog'
import { useSettingsStore } from '@/stores/settings.store'

const USAGE_FOOTER_OPTIONS: { value: 'off' | 'tokens' | 'full'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'full', label: 'Full' },
]

export default function ModelScreen() {
  const toast = useToast()

  const defaultModel = useSettingsStore((state) => state.defaultModel)
  const defaultThinkingLevel = useSettingsStore((state) => state.defaultThinkingLevel)
  const verbose = useSettingsStore((state) => state.verbose)
  const usageFooter = useSettingsStore((state) => state.usageFooter)
  const updateSetting = useSettingsStore((state) => state.updateSetting)
  const syncToGateway = useSettingsStore((state) => state.syncToGateway)

  // Only models reported by this local gateway are selectable; never invent
  // catalogue entries that the user's provider cannot actually run.
  const { data: models = [] } = useQuery({
    queryKey: ['gateway', 'models'],
    queryFn: loadModels,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const [saving, setSaving] = useState(false)

  async function handleSave(): Promise<void> {
    setSaving(true)
    // `syncToGateway` is best-effort by design (never rejects) — the local
    // preference always stands even if the gateway push fails.
    await syncToGateway()
    setSaving(false)
    toast.show({ title: 'Saved', description: 'Your defaults are synced to the gateway.' })
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-8 px-8 pb-24">
        <h1 className="text-title-1 font-bold text-content-primary">Model &amp; thinking</h1>

        <SettingsGroup title="Model">
          {models.length === 0 ? (
            <p className="px-4 py-6 text-center text-footnote text-content-secondary">No models reported by the local agent yet.</p>
          ) : models.map((model) => (
            <ChoiceRow
              key={model.id}
              label={model.name}
              description={`${model.provider} · ${(model.contextWindow / 1000).toFixed(0)}k context${model.supportsThinking ? ' · Thinking' : ''}`}
              selected={model.id === defaultModel}
              onSelect={() => updateSetting('defaultModel', model.id)}
            />
          ))}
        </SettingsGroup>

        <SettingsGroup title="Thinking level">
          {THINKING_LEVELS.map((level) => (
            <ChoiceRow
              key={level.value}
              label={level.label}
              detail={`${level.tokens} tokens`}
              selected={level.value === defaultThinkingLevel}
              onSelect={() => updateSetting('defaultThinkingLevel', level.value)}
            />
          ))}
        </SettingsGroup>

        <SettingsGroup title="Options">
          <SettingsRow
            label="Verbose mode"
            description="Show tool calls and thinking blocks"
            right={<Switch checked={verbose} onCheckedChange={(v) => updateSetting('verbose', v)} aria-label="Verbose mode" />}
          />
          <SettingsRow
            label="Usage footer"
            right={<Select size="compact" className="muse-plain-select" aria-label="Usage footer" value={usageFooter} items={USAGE_FOOTER_OPTIONS} onValueChange={(value) => updateSetting('usageFooter', value)} />}
          />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow
            label="Sync to local agent"
            description="Makes these the agent's defaults for every chat, including channels"
            right={<SettingsButton disabled={saving} onClick={() => void handleSave()}>{saving ? 'Saving…' : 'Save'}</SettingsButton>}
          />
        </SettingsGroup>
      </div>
    </div>
  )
}
