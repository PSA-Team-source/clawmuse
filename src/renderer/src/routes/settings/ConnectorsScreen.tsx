import { useEffect, useMemo, useState } from 'react'
import { DEVICE } from '@/lib/platform'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Delete02Icon, ReloadIcon, Search01Icon } from '@hugeicons/core-free-icons'
import type { McpServerDefinition, McpServerSummary } from '@shared/ipc'
import { GhostButton, GradientButton, IconButton, Spinner } from '@/components/brand'
import { TextField, useToast } from '@/components/patterns'
import { SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { AlertDialog, Dialog, Icon, Switch } from '@/components/primitives'
import { gatewayErrorDetails, gatewayWS } from '@/services/gateway-ws.service'
import { useRuntimeStore } from '@/stores/runtime.store'
import { SETUP_PROVIDER_IDS } from '@/routes/onboarding/LocalSetupScreen'
import { CHANNEL_SETTINGS_IDS } from './ChannelsScreen'
import {
  SURFACE_GROUP_LABELS,
  buildCatalog,
  filterCatalog,
  readLifecycleReview,
  type ConnectorItem,
  type ConnectorTone,
  type DiscoveryCategory,
  type DiscoveryItem,
  type LifecycleReview,
  type PluginEntry,
  type SkillEntry,
  unavailablePlugins,
} from './connectors-catalog'

/**
 * Connectors — everything the agent on this machine can plug into.
 *
 * Every row is OpenClaw's own: its skills (`skills.status`), its plugins —
 * installed, and the official ClawHub ones one click away (`plugins.list`) —
 * filed under ClawHub's categories, and last the custom MCP servers this
 * machine hosts. Every action is OpenClaw's own RPC, so a change here is the
 * same change the CLI or the Control UI would make.
 *
 * Custom connectors drive the CLI rather than editing `openclaw.json`, because
 * two editors of one registry is how a user's connectors quietly disappear.
 * They used to: `mcp` was in the config generator's owned-keys list, so every
 * boot rewrote it to `{}`.
 */

/** Rows a section shows before "Show all" — enough to see what is on, not a wall of 30. */
const COLLAPSED_ROWS = 6

const TONE_CLASS: Record<ConnectorTone, string> = {
  ready: 'text-content-secondary',
  off: 'text-content-tertiary',
  attention: 'text-warning-content',
}

const CATALOG_KEY = ['connectors'] as const
/** Local state only — the ClawHub taxonomy does not change when a plugin is toggled. */
const LOCAL_STATE = { queryKey: CATALOG_KEY, predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[1] !== 'discovery' }

interface LifecycleResult {
  pluginId?: string
  plugin?: { id: string; enabled?: boolean }
  restartRequired?: boolean
  warnings?: string[]
}

/**
 * ClawHub's category names and which one each official plugin belongs to.
 * Network-bound (ClawHub); the catalog still renders without it.
 */
async function loadDiscovery(): Promise<{ items: DiscoveryItem[]; categories: DiscoveryCategory[] }> {
  const items: DiscoveryItem[] = []
  let cursor: string | undefined
  // A failed page echoes the cursor back, so an unchanged cursor ends the walk too.
  for (let page = 0; page < 10; page++) {
    const result = await gatewayWS.call<{ items: DiscoveryItem[]; nextCursor?: string; remoteError?: string }>('plugins.catalog.browse', { intent: 'official', pageSize: 100, ...(cursor ? { cursor } : {}) })
    if (result.remoteError) throw new Error(result.remoteError)
    items.push(...result.items)
    if (!result.nextCursor || result.nextCursor === cursor) break
    cursor = result.nextCursor
  }
  const { categories } = await gatewayWS.call<{ categories: DiscoveryCategory[] }>('plugins.catalog.categories', {})
  return { items, categories }
}

function statusOf(server: McpServerSummary): { label: string; variant: 'success' | 'error' | 'neutral' } {
  if (!server.enabled) return { label: 'Disabled', variant: 'neutral' }
  if (!server.configured) return { label: 'Invalid', variant: 'error' }
  if (server.ok === false) return { label: 'Not answering', variant: 'error' }
  if (server.ok === true) return { label: 'Ready', variant: 'success' }
  return { label: 'Not checked', variant: 'neutral' }
}

function AddConnector({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { show } = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [launch, setLaunch] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = launch.trim()
      // A URL is an HTTP server; anything else is a command to spawn. Same two
      // shapes OpenClaw documents, so the input is passed through untranslated.
      const definition: McpServerDefinition = /^https?:\/\//.test(trimmed)
        ? { url: trimmed, transport: 'streamable-http' }
        : (() => {
            const [command, ...args] = trimmed.split(/\s+/)
            return { command: command!, args }
          })()
      const result = await window.clawmuse.runtime.mcpSet(name.trim(), definition)
      if (!result.ok) throw new Error(result.error)
    },
    onSuccess: () => {
      show({ title: `${name.trim()} connected`, variant: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
      setName('')
      setLaunch('')
      onOpenChange(false)
    },
    onError: (error) =>
      show({ title: 'Could not add the connector', description: (error as Error).message, variant: 'error' }),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a custom connector"
      description="A command to run, or the URL of an MCP server."
    >
      <div className="flex flex-col gap-4">
        <TextField label="Name" value={name} onChange={setName} placeholder="context7" />
        <TextField
          label="Command or URL"
          value={launch}
          onChange={setLaunch}
          placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents"
        />
        <p className="text-caption text-content-muted">
          The agent runs this on your machine. Nothing about it leaves the device.
        </p>
        <div className="flex justify-end gap-2">
          <GhostButton size="sm" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </GhostButton>
          <GradientButton
            size="sm"
            onClick={() => save.mutate()}
            disabled={!name.trim() || !launch.trim()}
            loading={save.isPending}
          >
            Add connector
          </GradientButton>
        </div>
      </div>
    </Dialog>
  )
}

/** A skill's missing environment variables, stored by `skills.update` into its config entry. */
function SkillKeys({ item, onClose, onSave }: { item: ConnectorItem | null; onClose: () => void; onSave: (env: Record<string, string>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const names = item?.missingEnv ?? []
  const complete = names.length > 0 && names.every((name) => values[name]?.trim())
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => { if (!open) { setValues({}); onClose() } }}
      title={item ? `Set up ${item.name}` : ''}
      description="Stored in this machine's agent config for this skill only."
    >
      <div className="flex flex-col gap-4">
        {names.map((name) => (
          <TextField key={name} label={name} type="password" value={values[name] ?? ''} onChange={(value) => setValues((current) => ({ ...current, [name]: value }))} />
        ))}
        <div className="flex justify-end gap-2">
          <GhostButton size="sm" onClick={onClose} disabled={saving}>Cancel</GhostButton>
          <GradientButton
            size="sm"
            disabled={!complete}
            loading={saving}
            onClick={() => {
              setSaving(true)
              void onSave(Object.fromEntries(names.map((name) => [name, values[name]!.trim()]))).finally(() => { setSaving(false); setValues({}) })
            }}
          >
            Save and turn on
          </GradientButton>
        </div>
      </div>
    </Dialog>
  )
}

type Pending =
  | { kind: 'review'; item: ConnectorItem; review: LifecycleReview; retry: (review: LifecycleReview) => Promise<void> }
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; danger?: boolean; run: () => Promise<void> }

function PendingDialog({ pending, onClose }: { pending: Pending | null; onClose: () => void }) {
  const title = pending?.kind === 'review' ? `Review ${pending.item.name}` : pending?.title
  const confirmLabel = pending?.kind === 'review' ? (pending.review.kind === 'capabilities' ? 'Allow' : 'Install anyway') : pending?.confirmLabel
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <AlertDialog.Title className="text-headline font-semibold text-content-primary">{title}</AlertDialog.Title>
      <AlertDialog.Description render={<div />} className="mt-2 flex flex-col gap-2 text-body-sm text-content-secondary">
        {pending?.kind === 'confirm' && <p>{pending.body}</p>}
        {pending?.kind === 'review' && pending.review.kind === 'capabilities' && (
          <>
            <p>OpenClaw needs your OK before {pending.item.name} can run on this machine.</p>
            {pending.review.widened.length ? (
              <ul className="flex flex-col gap-1">
                <li>It adds:</li>
                {pending.review.widened.map(({ group, items }) => (
                  <li key={group}><span className="text-content-primary">{SURFACE_GROUP_LABELS[group] ?? group}:</span> {items.join(', ')}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        {pending?.kind === 'review' && pending.review.kind === 'install-policy' && (
          <>
            <p>{pending.review.reason}</p>
            {pending.review.findings.length ? (
              <ul className="flex flex-col gap-1">
                {pending.review.findings.map((finding) => <li key={finding.message}>{finding.message}</li>)}
              </ul>
            ) : null}
          </>
        )}
      </AlertDialog.Description>
      <div className="mt-6 flex justify-end gap-2">
        <AlertDialog.Close className="h-8 rounded-full bg-fill-strong px-4 text-body-sm text-content-primary hover:bg-fill-stronger">Cancel</AlertDialog.Close>
        <button
          type="button"
          onClick={() => {
            const current = pending
            onClose()
            if (current?.kind === 'review') void current.retry(current.review)
            else if (current) void current.run()
          }}
          className={pending?.kind === 'confirm' && pending.danger ? 'h-8 rounded-full bg-error px-4 text-body-sm font-medium text-white' : 'h-8 rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white'}
        >
          {confirmLabel}
        </button>
      </div>
    </AlertDialog>
  )
}

function ConnectorRow({ item, busy, onToggle, onInstall, onRemove, onKeys }: {
  item: ConnectorItem
  busy: boolean
  onToggle: (on: boolean) => void
  onInstall: () => void
  onRemove: () => void
  onKeys: () => void
}) {
  const navigate = useNavigate()
  // A failure's reason is what the person needs to read, so it takes the description's place.
  const secondary = item.status.detail ?? item.description
  const subtitle = [item.status.label, secondary].filter(Boolean).join(' · ')
  return (
    <div className="settings-row flex w-full items-center gap-3">
      {/* No emoji, no slot: an empty gutter reads as a missing icon. */}
      {item.emoji && <span aria-hidden="true" className="w-6 shrink-0 text-center text-headline">{item.emoji}</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-content-primary">{item.name}</p>
        <p className="truncate text-caption text-content-secondary" title={subtitle}>
          <span className={TONE_CLASS[item.status.tone]}>{item.status.label}</span>
          {secondary ? ` · ${secondary}` : ''}
        </p>
        {(item.setup || item.homepage) && (
          <div className="mt-0.5 flex gap-3">
            {item.setup && (
              <button type="button" className="text-caption text-muse-blue hover:underline" onClick={() => navigate(item.setup!.path)}>
                {item.setup.label}
              </button>
            )}
            {item.homepage && (
              <button type="button" className="text-caption text-muse-blue hover:underline" onClick={() => void window.clawmuse.shell.openExternal(item.homepage!)}>
                Website
              </button>
            )}
          </div>
        )}
      </div>
      {busy ? (
        <Spinner size={16} />
      ) : (
        <>
          {item.missingEnv && <SettingsButton onClick={onKeys}>Add key</SettingsButton>}
          {item.action.type === 'install' && <SettingsButton onClick={onInstall}>{item.action.label}</SettingsButton>}
          {item.removable && <IconButton icon={Delete02Icon} label={`Remove ${item.name}`} tone="danger" onClick={onRemove} />}
          {item.action.type === 'toggle' && <Switch checked={item.action.on} onCheckedChange={onToggle} aria-label={`${item.name} ${item.action.on ? 'on' : 'off'}`} />}
        </>
      )}
    </div>
  )
}

export default function ConnectorsScreen() {
  const { show } = useToast()
  const queryClient = useQueryClient()
  const restartRuntime = useRuntimeStore((state) => state.restart)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Pending | null>(null)
  const [keysFor, setKeysFor] = useState<ConnectorItem | null>(null)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const plugins = useQuery({
    queryKey: [...CATALOG_KEY, 'plugins'],
    queryFn: () => gatewayWS.call<{ plugins?: PluginEntry[] }>('plugins.list', {}),
    staleTime: 10_000,
  })
  const skills = useQuery({
    queryKey: [...CATALOG_KEY, 'skills'],
    queryFn: () => gatewayWS.call<{ skills?: SkillEntry[] }>('skills.status', {}),
    staleTime: 10_000,
  })
  // `plugins.list` says "enabled" for a plugin that failed to load; `health` says why.
  const health = useQuery({
    queryKey: [...CATALOG_KEY, 'health'],
    queryFn: () => gatewayWS.call<unknown>('health', {}),
    staleTime: 10_000,
  })
  const discovery = useQuery({
    queryKey: [...CATALOG_KEY, 'discovery'],
    queryFn: loadDiscovery,
    staleTime: 60 * 60_000,
    retry: 1,
  })
  const servers = useQuery({
    queryKey: ['mcp-servers'] as const,
    queryFn: () => window.clawmuse.runtime.mcpList(),
    staleTime: 10_000,
  })

  // Another client (the CLI, the Control UI, the agent itself) can change these
  // too; and a query that ran before this window's socket was up refetches on connect.
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries(LOCAL_STATE)
    const offEvent = gatewayWS.on('event', (frame) => {
      if (frame.event === 'plugins.changed' || frame.event === 'skills.changed') refresh()
    })
    const offConnected = gatewayWS.on('connected', refresh)
    return () => { offEvent(); offConnected() }
  }, [queryClient])

  const sections = useMemo(
    () => buildCatalog({
      plugins: plugins.data?.plugins ?? [],
      skills: skills.data?.skills ?? [],
      ...(discovery.data ? { discovery: discovery.data } : {}),
      channelSettingIds: CHANNEL_SETTINGS_IDS,
      providerSetupIds: SETUP_PROVIDER_IDS,
      unavailable: unavailablePlugins(health.data),
    }),
    [plugins.data, skills.data, discovery.data, health.data],
  )
  const needle = query.trim().toLowerCase()
  const visible = filterCatalog(sections, query)
  const mcpAll = servers.data ?? []
  const mcpList = needle ? mcpAll.filter((server) => server.name.toLowerCase().includes(needle)) : mcpAll

  const removeMcp = useMutation({
    mutationFn: async (name: string) => {
      const result = await window.clawmuse.runtime.mcpRemove(name)
      if (!result.ok) throw new Error(result.error)
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] }),
    onError: (error) =>
      show({ title: 'Could not remove it', description: (error as Error).message, variant: 'error' }),
  })

  const probe = useMutation({
    mutationFn: (name: string) => window.clawmuse.runtime.mcpProbe(name),
    onSuccess: (result, name) => {
      // A probe actually starts the server, which is the only way to find out a
      // command is missing from PATH — so the failure is worth reading in full.
      if (result.ok) {
        show({
          title: `${name} answered`,
          description: result.tools.length ? `${result.tools.length} tools` : 'connected, no tools offered',
          variant: 'success',
        })
      } else {
        show({ title: `${name} did not answer`, description: result.error, variant: 'error' })
      }
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
    },
  })

  /**
   * `skills.update` answers before the gateway's config snapshot reloads, so a
   * `skills.status` sent straight after still reports the old value (measured:
   * up to ~1.2s). Poll until the skill reads as asked, then publish that read.
   * ponytail: bounded 6s poll; the upgrade is a config revision on the reply.
   */
  async function untilSkill(skillKey: string, enabled: boolean): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const data = await gatewayWS.call<{ skills?: SkillEntry[] }>('skills.status', {})
      if (data.skills?.find((skill) => skill.skillKey === skillKey)?.disabled === !enabled) {
        queryClient.setQueryData([...CATALOG_KEY, 'skills'], data)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  /**
   * Runs one OpenClaw lifecycle call for a row. A refusal that asks for review
   * (capability consent, install-policy warning) opens the review instead of a
   * toast; `retry` re-sends with the acknowledgement OpenClaw asked for.
   */
  async function act(item: ConnectorItem, failure: string, call: (review?: LifecycleReview) => Promise<unknown>, review?: LifecycleReview, onDone?: (result: LifecycleResult | undefined) => void): Promise<void> {
    setBusy((current) => new Set(current).add(item.key))
    try {
      const result = (await call(review)) as LifecycleResult | undefined
      if (result?.restartRequired) setRestartNeeded(true)
      for (const warning of result?.warnings ?? []) show({ title: item.name, description: warning, variant: 'info' })
      onDone?.(result)
    } catch (error) {
      const asked = readLifecycleReview(gatewayErrorDetails(error))
      if (asked) setPending({ kind: 'review', item, review: asked, retry: (answer) => act(item, failure, call, answer, onDone) })
      else show({ title: failure, description: (error as Error).message, variant: 'error' })
    } finally {
      setBusy((current) => { const next = new Set(current); next.delete(item.key); return next })
      await queryClient.invalidateQueries(LOCAL_STATE)
    }
  }

  const acknowledgement = (review?: LifecycleReview) =>
    review?.kind === 'capabilities' ? { acknowledgeCapabilities: { reviewToken: review.reviewToken } } : review?.kind === 'install-policy' ? { acknowledgeInstallPolicyWarning: true } : {}

  function toggle(item: ConnectorItem, on: boolean): void {
    if (item.kind === 'skill') {
      void act(item, `Could not turn ${on ? 'on' : 'off'} ${item.name}`, async () => {
        await gatewayWS.setSkillEnabled(item.id, on)
        await untilSkill(item.id, on)
      })
      return
    }
    void act(item, `Could not turn ${on ? 'on' : 'off'} ${item.name}`, (review) =>
      gatewayWS.call('plugins.setEnabled', { pluginId: item.id, enabled: on, ...(on ? acknowledgement(review) : {}) }))
  }

  function install(item: ConnectorItem): void {
    if (item.skillInstall) {
      const { name, installId, label } = item.skillInstall
      setPending({
        kind: 'confirm',
        title: `Install ${item.name}?`,
        body: `${label}. This installs software on this ${DEVICE}, then turns the skill on.`,
        confirmLabel: 'Install',
        run: () => act(item, `Could not install ${item.name}`, async () => {
          await gatewayWS.call('skills.install', { name, installId, timeoutMs: 600_000 })
          await gatewayWS.setSkillEnabled(item.id, true)
          await untilSkill(item.id, true)
        }),
      })
      return
    }
    if (item.installPluginId) {
      const pluginId = item.installPluginId
      // OpenClaw installs a plugin switched off; "Install" here means "make it
      // work", so the install is followed by the same enable the switch sends.
      void act(
        item,
        `Could not install ${item.name}`,
        (review) => gatewayWS.call('plugins.install', { source: 'official', pluginId, ...acknowledgement(review) }),
        undefined,
        (result) => {
          const installed = result?.plugin?.id ?? result?.pluginId
          if (installed && result?.plugin?.enabled !== true) toggle({ ...item, id: installed }, true)
        },
      )
    }
  }

  function remove(item: ConnectorItem): void {
    setPending({
      kind: 'confirm',
      title: `Remove ${item.name}?`,
      body: 'OpenClaw uninstalls this plugin and its files. You can install it again from here.',
      confirmLabel: 'Remove',
      danger: true,
      run: () => act(item, `Could not remove ${item.name}`, () => gatewayWS.call('plugins.uninstall', { pluginId: item.id })),
    })
  }

  const loading = plugins.isLoading || skills.isLoading
  const failed = plugins.isError || skills.isError

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">Connectors</h1>

        {/* Muse's ConnectorSearchField: 44px full-round field on the card fill. */}
        <label className="relative block">
          <span className="sr-only">Search connectors</span>
          <Icon icon={Search01Icon} size={20} className="pointer-events-none absolute inset-y-0 left-3 my-auto text-content-secondary" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search connectors"
            className="h-11 w-full rounded-full border-0 bg-fill-strong pl-10 pr-4 text-body text-content-primary outline-none placeholder:text-content-tertiary focus-visible:ring-2 focus-visible:ring-muse-blue/40 [&::-webkit-search-cancel-button]:hidden"
          />
        </label>

        {restartNeeded && (
          <SettingsGroup>
            <SettingsRow
              label="Restart the agent to finish"
              description="OpenClaw applies this change the next time the agent starts."
              right={
                <SettingsButton
                  disabled={restarting}
                  onClick={() => {
                    setRestarting(true)
                    void restartRuntime().then(() => setRestartNeeded(false)).finally(() => setRestarting(false))
                  }}
                >
                  {restarting ? 'Restarting…' : 'Restart'}
                </SettingsButton>
              }
            />
          </SettingsGroup>
        )}

        {loading && !failed ? (
          <div className="flex justify-center py-10" role="status" aria-label="Loading connectors">
            <Spinner size={22} />
          </div>
        ) : failed ? (
          <SettingsGroup>
            <div role="alert" className="px-4 py-6 text-center">
              <p className="text-footnote font-semibold text-content-primary">Could not load connectors.</p>
              <p className="mt-1 text-footnote text-content-secondary">The connectors request failed. Please try again.</p>
              <button type="button" className="mt-3 h-9 rounded-full bg-fill-strong px-4 text-body-sm text-content-primary hover:bg-fill-stronger" onClick={() => void queryClient.invalidateQueries({ queryKey: CATALOG_KEY })}>Retry</button>
            </div>
          </SettingsGroup>
        ) : needle && visible.length === 0 && mcpList.length === 0 ? (
          <SettingsGroup>
            <p className="px-4 py-6 text-center text-footnote text-content-secondary">No connectors found.</p>
          </SettingsGroup>
        ) : (
          visible.map((section) => {
            const open = needle.length > 0 || expanded.has(section.id)
            const rows = open ? section.items : section.items.slice(0, COLLAPSED_ROWS)
            const hidden = section.items.length - rows.length
            return (
              <SettingsGroup key={section.id} title={section.title}>
                {rows.map((item) => (
                  <ConnectorRow
                    key={item.key}
                    item={item}
                    busy={busy.has(item.key)}
                    onToggle={(on) => toggle(item, on)}
                    onInstall={() => install(item)}
                    onRemove={() => remove(item)}
                    onKeys={() => setKeysFor(item)}
                  />
                ))}
                {hidden > 0 && (
                  <button type="button" className="settings-row w-full text-left text-body text-muse-blue" onClick={() => setExpanded((current) => new Set(current).add(section.id))}>
                    Show all {section.items.length}
                  </button>
                )}
              </SettingsGroup>
            )
          })
        )}

        {(!needle || mcpList.length > 0) && (
          <SettingsGroup title="Custom connectors">
            {servers.isLoading ? (
              <div className="flex justify-center py-6" role="status" aria-label="Loading custom connectors"><Spinner size={18} /></div>
            ) : servers.isError ? (
              <div role="alert" className="px-4 py-6 text-center">
                <p className="text-footnote text-content-secondary">Could not load custom connectors.</p>
                <button type="button" className="mt-3 h-9 rounded-full bg-fill-strong px-4 text-body-sm text-content-primary hover:bg-fill-stronger" onClick={() => void servers.refetch()}>Retry</button>
              </div>
            ) : (
              mcpList.map((server) => {
                const status = statusOf(server)
                return (
                  <div key={server.name} className="settings-row flex w-full items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body text-content-primary">{server.name}</p>
                      <p className={`truncate text-caption ${status.variant === 'error' ? 'text-error' : 'text-content-secondary'}`} title={server.launch ?? ''}>
                        {status.label} · {server.launch ?? server.transport ?? 'no launch recorded'}
                      </p>
                    </div>
                    <IconButton icon={ReloadIcon} label={`Check ${server.name}`} onClick={() => probe.mutate(server.name)} disabled={probe.isPending} />
                    <IconButton icon={Delete02Icon} label={`Remove ${server.name}`} tone="danger" onClick={() => removeMcp.mutate(server.name)} disabled={removeMcp.isPending} />
                  </div>
                )
              })
            )}
            <SettingsRow label="Add a custom connector" description="Any MCP server — a command on this machine or an HTTP URL" onClick={() => setIsAddOpen(true)} />
          </SettingsGroup>
        )}
      </div>

      <AddConnector open={isAddOpen} onOpenChange={setIsAddOpen} />
      <PendingDialog pending={pending} onClose={() => setPending(null)} />
      <SkillKeys
        item={keysFor}
        onClose={() => setKeysFor(null)}
        onSave={async (env) => {
          const item = keysFor
          setKeysFor(null)
          if (item) {
            await act(item, `Could not set up ${item.name}`, async () => {
              await gatewayWS.call('skills.update', { skillKey: item.id, env, enabled: true })
              await untilSkill(item.id, true)
            })
          }
        }}
      />
    </div>
  )
}
