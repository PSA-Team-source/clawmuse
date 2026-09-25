import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert02Icon, CheckmarkCircle02Icon, ComputerIcon, CloudIcon } from '@hugeicons/core-free-icons'
import { ClawMuseLogo, GhostButton, GradientButton, Spinner } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { TextField } from '@/components/patterns'
import { useGatewayStore } from '@/stores/gateway.store'
import { useRuntimeStore } from '@/stores/runtime.store'
import { DEFAULT_MODEL_BY_PROVIDER } from '@shared/ipc'
import type { DetectedLocalProvider, ProviderChoice } from '@shared/ipc'

/**
 * BYOK model setup.
 *
 * The product rule is "local priority", so this screen leads with whatever
 * model server is already running on the machine — pick it and you are done, no
 * key, no account, nothing leaves the device. Cloud providers are the second
 * path for people who want a frontier model.
 *
 * No key is ever shipped inside the app: ClawMuse has no shared credential to
 * leak, which is what makes local mode safe to release without a login.
 */

interface CloudProvider {
  id: string
  label: string
  keyLabel: string
  placeholder: string
  defaultModel: string
  help: string
}

const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyLabel: 'API key',
    placeholder: 'sk-ant-…',
    defaultModel: DEFAULT_MODEL_BY_PROVIDER.anthropic!,
    help: 'console.anthropic.com → API keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'API key',
    placeholder: 'sk-…',
    defaultModel: DEFAULT_MODEL_BY_PROVIDER.openai!,
    help: 'platform.openai.com → API keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyLabel: 'API key',
    placeholder: 'sk-or-…',
    defaultModel: DEFAULT_MODEL_BY_PROVIDER.openrouter!,
    help: 'openrouter.ai → Keys',
  },
  {
    // Served by the official @openclaw/opencode-provider plugin, which the
    // runtime installs on start when a configured provider needs it.
    id: 'opencode',
    label: 'OpenCode Zen',
    keyLabel: 'API key',
    placeholder: 'sk-…',
    defaultModel: DEFAULT_MODEL_BY_PROVIDER.opencode!,
    help: 'opencode.ai/auth → API keys · needs Zen credits',
  },
]

const LOCAL_LABELS: Record<DetectedLocalProvider['id'], string> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
}

/** Every provider this screen can set up — Connectors links here only for these. */
export const SETUP_PROVIDER_IDS: readonly string[] = [...CLOUD_PROVIDERS.map((provider) => provider.id), ...Object.keys(LOCAL_LABELS)]

export default function LocalSetupScreen() {
  const navigate = useNavigate()
  const restart = useRuntimeStore((state) => state.restart)
  const runtimeStatus = useRuntimeStore((state) => state.status)
  const skipProviderSetup = useRuntimeStore((state) => state.skipProviderSetup)
  const bootLocal = useGatewayStore((state) => state.bootLocal)

  const [detected, setDetected] = useState<DetectedLocalProvider[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.clawmuse.runtime.detectProviders().then((found) => {
      setDetected(found)
      const first = found[0]
      if (first) {
        setSelected(first.id)
        setModel(`${first.id}/${first.models[0] ?? ''}`)
      }
    })
  }, [])

  const cloud = CLOUD_PROVIDERS.find((provider) => provider.id === selected)
  const local = detected?.find((provider) => provider.id === selected)
  const canSave = Boolean(selected && model.trim() && (!cloud || apiKey.trim()))

  function chooseLocal(provider: DetectedLocalProvider): void {
    setSelected(provider.id)
    setModel(`${provider.id}/${provider.models[0] ?? ''}`)
    setApiKey('')
    setError(null)
  }

  function chooseCloud(provider: CloudProvider): void {
    setSelected(provider.id)
    setModel(provider.defaultModel)
    setApiKey('')
    setError(null)
  }

  async function handleSave(): Promise<void> {
    if (!selected || saving) return
    setSaving(true)
    setError(null)
    try {
      const choice: ProviderChoice = {
        id: selected,
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        // A local server needs its base URL *and* its catalogue declared —
        // OpenClaw does not enumerate local models on its own.
        ...(local ? { baseUrl: local.baseUrl, models: local.models } : {}),
      }
      await window.clawmuse.runtime.applyProvider(choice)
      // The gateway reads providers at startup, so the new key only takes
      // effect after a restart — doing it here means the user never hits a
      // "no API provider registered" error on their first message.
      await restart()
      await bootLocal()
      navigate('/chat', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your model settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-y-auto bg-bg-base">
      <div className="drag absolute inset-x-0 top-0 h-10" />

      <div className="no-drag mx-auto flex w-full max-w-form flex-col gap-7 px-8 pb-16 pt-16">
        <div className="flex flex-col items-center gap-3 text-center">
          <ClawMuseLogo size={52} variant="badge" />
          <h1 className="text-title-2 font-bold text-content-primary">Choose a model</h1>
          <p className="text-body-sm text-content-tertiary">
            ClawMuse runs on your machine. Pick the model it should think with.
          </p>
        </div>

        {detected === null ? (
          <div className="flex items-center justify-center gap-2 py-6 text-body-sm text-content-tertiary">
            <Spinner size={16} />
            Looking for local model servers…
          </div>
        ) : (
          <>
            {detected.length > 0 && (
              <section className="flex flex-col gap-2">
                <p className="text-caption font-medium uppercase tracking-wide text-content-faint">
                  On this machine
                </p>
                {detected.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => chooseLocal(provider)}
                    className={`flex items-center gap-3 rounded-box border p-3.5 text-left transition-colors ${
                      selected === provider.id
                        ? 'border-primary/40 bg-fill-accent'
                        : 'border-line-subtle bg-fill hover:border-line-strong'
                    }`}
                  >
                    <Icon icon={ComputerIcon} size={18} />
                    <span className="flex flex-1 flex-col">
                      <span className="text-body-sm font-medium text-content-primary">
                        {LOCAL_LABELS[provider.id]}
                      </span>
                      <span className="text-caption text-content-tertiary">
                        {provider.models.length} model{provider.models.length === 1 ? '' : 's'} · no
                        API key needed
                      </span>
                    </span>
                    {selected === provider.id && <Icon icon={CheckmarkCircle02Icon} size={16} />}
                  </button>
                ))}
              </section>
            )}

            <section className="flex flex-col gap-2">
              <p className="text-caption font-medium uppercase tracking-wide text-content-faint">
                Bring your own key
              </p>
              {CLOUD_PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => chooseCloud(provider)}
                  className={`flex items-center gap-3 rounded-box border p-3.5 text-left transition-colors ${
                    selected === provider.id
                      ? 'border-primary/40 bg-fill-accent'
                      : 'border-line-subtle bg-fill hover:border-line-strong'
                  }`}
                >
                  <Icon icon={CloudIcon} size={18} />
                  <span className="flex flex-1 flex-col">
                    <span className="text-body-sm font-medium text-content-primary">
                      {provider.label}
                    </span>
                    <span className="text-caption text-content-tertiary">{provider.help}</span>
                  </span>
                  {selected === provider.id && <Icon icon={CheckmarkCircle02Icon} size={16} />}
                </button>
              ))}
            </section>

            {selected && (
              <section className="flex flex-col gap-3">
                {cloud && (
                  <TextField
                    label={`${cloud.label} ${cloud.keyLabel}`}
                    type="password"
                    value={apiKey}
                    placeholder={cloud.placeholder}
                    onChange={(value) => setApiKey(value)}
                  />
                )}
                <TextField
                  label="Model"
                  value={model}
                  placeholder="provider/model-id"
                  onChange={(value) => setModel(value)}
                />
                {local && local.models.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {local.models.slice(0, 8).map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setModel(`${local.id}/${name}`)}
                        className="rounded-full border border-line-subtle px-2.5 py-1 text-caption text-content-secondary transition-colors hover:border-line-strong"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-caption text-content-faint">
                  Keys are written to ~/.openclaw-clawmuse/.env on this machine only.
                </p>
              </section>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-box border border-error-border bg-error-bg p-3 text-body-sm text-error">
                <Icon icon={Alert02Icon} size={15} />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <GhostButton
                size="sm"
                onClick={() => {
                  // The gate re-checks on every navigation, so leaving without
                  // recording the choice bounces straight back here.
                  skipProviderSetup()
                  navigate('/chat', { replace: true })
                }}
              >
                Skip for now
              </GhostButton>
              <GradientButton disabled={!canSave} loading={saving} onClick={() => void handleSave()}>
                Save and start
              </GradientButton>
            </div>
            {/* A first install can take minutes (the runtime downloads); a lone
                button spinner for that long reads as a hang. Real installer
                progress, the same line the boot screen shows. */}
            {saving && runtimeStatus.state === 'starting' && (
              <p role="status" className="mt-3 truncate text-center font-mono text-caption text-content-tertiary">{runtimeStatus.detail ?? 'Setting up the agent…'}</p>
            )}

            {/* Local is the only mode that needs a model provider at all. Someone
                who has no key and no local server is being asked for the one
                thing they cannot supply — and this screen, like the other three
                outside AppShell, has no sidebar and no route to Settings. */}
            <div className="flex flex-col items-center border-t border-line-subtle pt-5">
            </div>
          </>
        )}
      </div>
    </div>
  )
}
