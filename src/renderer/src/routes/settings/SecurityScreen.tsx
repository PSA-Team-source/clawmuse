import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { ChoiceRow, SettingsGroup } from '@/components/settings'
import { GradientButton, PillButton } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { useToast } from '@/components/patterns'
import { Dialog } from '@/components/primitives'
import { gatewayWS } from '@/services/gateway-ws.service'

/**
 * Exec policy and sandboxing.
 *
 * Both settings decide what the agent may do to this machine, so they live on
 * one screen rather than being scattered: the honest question is "how much do
 * you trust it, and what is it running inside", and answering half of that is
 * how people end up with a permissive policy they did not realise they had.
 *
 * The values map straight onto OpenClaw's own config — nothing is reinvented
 * here, and the CLI shows the same state.
 */

type ExecMode = 'deny' | 'allowlist' | 'ask' | 'auto' | 'full'
type SandboxMode = 'off' | 'non-main' | 'all'
type SandboxBackend = 'docker' | 'ssh' | 'openshell'

const EXEC_MODES: { value: ExecMode; label: string; description: string }[] = [
  { value: 'deny', label: 'Never', description: 'The agent cannot run shell commands at all.' },
  {
    value: 'allowlist',
    label: 'Allowlist',
    description: 'Only commands you have approved before, with no new prompts.',
  },
  {
    value: 'ask',
    label: 'Ask',
    description: 'Approved commands run; anything new asks you first. Recommended.',
  },
  {
    value: 'auto',
    label: 'Auto-review',
    description: 'Like Ask, but an automated reviewer screens misses before you see them.',
  },
  {
    value: 'full',
    label: 'YOLO',
    description: 'Every command runs immediately, with no approval. Nothing stops a mistake.',
  },
]

const SANDBOX_MODES: { value: SandboxMode; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'Tools run directly on this machine.' },
  {
    value: 'non-main',
    label: 'Side sessions',
    description: 'Your main chat runs on the host; other sessions are sandboxed.',
  },
  { value: 'all', label: 'Everything', description: 'Every session runs inside a sandbox.' },
]

const BACKENDS: { value: SandboxBackend; label: string }[] = [
  { value: 'docker', label: 'Docker' },
  { value: 'ssh', label: 'SSH host' },
  { value: 'openshell', label: 'OpenShell' },
]

const SECURITY_KEY = ['gateway-config', 'security'] as const

interface SecurityConfig {
  execMode: ExecMode
  sandboxMode: SandboxMode
  sandboxBackend: SandboxBackend
}

function readSecurity(source: Record<string, unknown>): SecurityConfig {
  const tools = (source.tools ?? {}) as { exec?: { mode?: string } }
  const agents = (source.agents ?? {}) as {
    defaults?: { sandbox?: { mode?: string; backend?: string } }
  }
  const sandbox = agents.defaults?.sandbox ?? {}
  return {
    execMode: (tools.exec?.mode as ExecMode) ?? 'ask',
    sandboxMode: (sandbox.mode as SandboxMode) ?? 'off',
    sandboxBackend: (sandbox.backend as SandboxBackend) ?? 'docker',
  }
}

export default function SecurityScreen() {
  const toast = useToast()
  const [pendingYolo, setPendingYolo] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const config = useQuery({
    queryKey: SECURITY_KEY,
    queryFn: async () => {
      const current = await gatewayWS.getConfig()
      return readSecurity(current.sourceConfig ?? current.config ?? {})
    },
    staleTime: 5_000,
  })

  async function apply(
    path: string,
    value: unknown,
    label: string,
    patch: Partial<SecurityConfig>,
  ): Promise<void> {
    setSaving(label)
    try {
      // Sequential by construction: `config.patch` replaces the whole document
      // and is guarded by a hash, so two concurrent writes would lose one.
      await gatewayWS.setConfig(path, value)
      // Optimistic, then reconciled: the write is a full-document round trip,
      // and a toggle that visibly lags behind the click reads as broken.
      queryClient.setQueryData<SecurityConfig>(SECURITY_KEY, (previous) =>
        previous ? { ...previous, ...patch } : previous,
      )
      await config.refetch()
      toast.show({ title: `${label} updated`, description: 'Restart the agent to apply.' })
    } catch (error) {
      toast.show({
        title: `Could not update ${label.toLowerCase()}`,
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      })
    } finally {
      setSaving(null)
    }
  }

  function selectExecMode(mode: ExecMode): void {
    // YOLO is the one choice that cannot be undone by a later prompt, so it is
    // the one choice that gets a confirmation.
    if (mode === 'full') {
      setPendingYolo(true)
      return
    }
    void apply('tools.exec.mode', mode, 'Command approval', { execMode: mode })
  }

  async function confirmYolo(): Promise<void> {
    setPendingYolo(false)
    await apply('tools.exec.mode', 'full', 'Command approval', { execMode: 'full' })
  }

  const current = config.data ?? null

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-7 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">Permissions</h1>

        <div className="flex flex-col gap-2">
          <SettingsGroup title="Running commands" className="mb-0">
            {EXEC_MODES.map((mode) => (
              <ChoiceRow
                key={mode.value}
                label={mode.value === 'full' ? <span className="flex items-center gap-2">{mode.label}<Icon icon={Alert02Icon} size={14} className="text-error" /></span> : mode.label}
                description={mode.description}
                selected={current?.execMode === mode.value}
                disabled={saving !== null}
                onSelect={() => selectExecMode(mode.value)}
              />
            ))}
          </SettingsGroup>
          <p className="px-3 text-footnote text-content-secondary">Your agent can run shell commands on this machine. This decides when it has to ask.</p>
        </div>

        <div className="flex flex-col gap-2">
          <SettingsGroup title="Sandbox" className="mb-0">
            {SANDBOX_MODES.map((mode) => (
              <ChoiceRow
                key={mode.value}
                label={mode.label}
                description={mode.description}
                selected={current?.sandboxMode === mode.value}
                disabled={saving !== null}
                onSelect={() => void apply('agents.defaults.sandbox.mode', mode.value, 'Sandbox', { sandboxMode: mode.value })}
              />
            ))}
          </SettingsGroup>
          <p className="px-3 text-footnote text-content-secondary">Isolates the agent's tools inside a container instead of running them directly on your machine.</p>
        </div>

        {current?.sandboxMode !== 'off' && (
          <div className="flex flex-col gap-2">
            <SettingsGroup title="Sandbox backend" className="mb-0">
              {BACKENDS.map((backend) => (
                <ChoiceRow
                  key={backend.value}
                  label={backend.label}
                  selected={current?.sandboxBackend === backend.value}
                  disabled={saving !== null}
                  onSelect={() => void apply('agents.defaults.sandbox.backend', backend.value, 'Sandbox backend', { sandboxBackend: backend.value })}
                />
              ))}
            </SettingsGroup>
            <p className="px-3 text-footnote text-content-secondary">Docker needs Docker Desktop running. SSH and OpenShell need their own configuration.</p>
          </div>
        )}
      </div>

      <Dialog
        open={pendingYolo}
        onOpenChange={setPendingYolo}
        title="Turn off command approval?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-body-sm text-content-body">
            The agent will run every shell command it decides to run — deleting files, installing
            software, sending network requests — without asking you first.
          </p>
          <p className="text-body-sm text-content-tertiary">
            Only do this in a workspace you can afford to lose.
          </p>
          <div className="flex justify-end gap-2">
            <PillButton onClick={() => setPendingYolo(false)}>Cancel</PillButton>
            <GradientButton onClick={() => void confirmYolo()}>Turn off approval</GradientButton>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

