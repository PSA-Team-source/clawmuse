import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { TextField, useToast } from '@/components/patterns'
import { Dialog } from '@/components/primitives'
import { gatewayWS } from '@/services/gateway-ws.service'

type ChannelId = 'telegram' | 'discord'

/** The token-based channels OpenClaw bundles; each is enabled by writing channels.<id>. */
const CHANNELS: { id: ChannelId; label: string; tokenKey: string; help: string; valid: (token: string) => boolean }[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    tokenKey: 'botToken',
    help: 'In Telegram, message @BotFather, send /newbot, and paste the token it gives you.',
    valid: (token) => /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token),
  },
  {
    id: 'discord',
    label: 'Discord',
    tokenKey: 'token',
    help: 'In the Discord Developer Portal, create an application, add a bot, enable Message Content Intent, and paste the bot token.',
    valid: (token) => /^[A-Za-z0-9._-]{50,}$/.test(token),
  },
]

/** The channels this screen sets up — Connectors links here only for these. */
export const CHANNEL_SETTINGS_IDS: readonly string[] = CHANNELS.map((channel) => channel.id)

interface AccountSnapshot {
  configured?: boolean
  running?: boolean
  connected?: boolean
  lastError?: string | null
}

interface ChannelsStatus {
  channels?: Record<string, AccountSnapshot | undefined>
  channelAccounts?: Record<string, AccountSnapshot[] | undefined>
}

function statusOf(status: ChannelsStatus | undefined, id: ChannelId): { connected: boolean; configured: boolean; label: string; error?: string } {
  const account = status?.channelAccounts?.[id]?.[0] ?? status?.channels?.[id]
  const configured = Boolean(account?.configured)
  if (!configured) return { connected: false, configured: false, label: 'Not connected' }
  if (account?.lastError) {
    // The runtime's message names config keys; say what to do instead.
    const rejected = /unauthori[sz]ed|\b401\b|invalid token/i.test(account.lastError)
    return { connected: false, configured: true, label: 'Needs attention', error: rejected ? `${id === 'telegram' ? 'Telegram' : 'Discord'} rejected this bot token. Disconnect, then connect again with a current token.` : account.lastError }
  }
  if (account?.connected || account?.running) return { connected: true, configured: true, label: 'Connected' }
  return { connected: false, configured: true, label: 'Starting…' }
}

/**
 * Muse's Settings > Messaging channels (SettingsChannelsTab): chat with the
 * agent from other messaging apps. Connecting writes the bot token into the
 * local gateway's config; the gateway starts the channel itself.
 */
export default function ChannelsScreen() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [connecting, setConnecting] = useState<(typeof CHANNELS)[number] | null>(null)
  const [token, setToken] = useState('')

  const status = useQuery({
    queryKey: ['channels-status'],
    queryFn: () => gatewayWS.call<ChannelsStatus>('channels.status', {}),
    refetchInterval: 10_000,
  })
  const configured = CHANNELS.filter((channel) => statusOf(status.data, channel.id).configured).map((channel) => channel.id)
  const pairing = useQuery({
    queryKey: ['channel-pairing', configured.join(',')],
    enabled: configured.length > 0,
    refetchInterval: 20_000,
    queryFn: async () => (await Promise.all(configured.map(async (channel) =>
      (await window.clawmuse.runtime.pairingList(channel)).map((request) => ({ ...request, channel }))))).flat(),
  })

  const save = useMutation({
    mutationFn: async ({ id, value }: { id: ChannelId; value: Record<string, unknown> | null }) => gatewayWS.setConfig(`channels.${id}`, value),
    onSuccess: (_data, { id, value }) => {
      setConnecting(null)
      setToken('')
      toast.show({ title: value ? `${CHANNELS.find((c) => c.id === id)!.label} connected` : 'Channel disconnected', description: value ? 'Message your bot to start chatting with your agent.' : undefined })
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['channels-status'] }), 2500)
    },
    onError: (error) => toast.show({ title: 'Could not update the channel', description: error instanceof Error ? error.message : undefined, variant: 'error' }),
  })
  const approve = useMutation({
    mutationFn: async ({ channel, code }: { channel: ChannelId; code: string }) => {
      const result = await window.clawmuse.runtime.pairingApprove(channel, code)
      if (!result.ok) throw new Error(result.error)
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['channel-pairing'] }),
    onError: (error) => toast.show({ title: 'Could not approve', description: error instanceof Error ? error.message : undefined, variant: 'error' }),
  })

  const trimmed = token.trim()

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">Messaging channels</h1>
        <p className="-mt-3 text-body-sm text-content-secondary">Chat with your agent in other messaging apps.</p>

        {status.isError ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-body text-content-secondary">Unable to load channels.</p>
            <SettingsButton onClick={() => void status.refetch()}>Try again</SettingsButton>
          </div>
        ) : (
          <SettingsGroup className="mb-0">
            {CHANNELS.map((channel) => {
              const state = statusOf(status.data, channel.id)
              return (
                <SettingsRow
                  key={channel.id}
                  label={channel.label}
                  description={state.error ? state.error : state.label}
                  right={status.data === undefined ? undefined : state.configured
                    ? <SettingsButton disabled={save.isPending} onClick={() => save.mutate({ id: channel.id, value: null })}>Disconnect</SettingsButton>
                    : <SettingsButton onClick={() => { setToken(''); setConnecting(channel) }}>Connect</SettingsButton>}
                />
              )
            })}
          </SettingsGroup>
        )}

        {(pairing.data?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2">
            <SettingsGroup title="Waiting for approval" className="mb-0">
              {pairing.data!.map((request) => (
                <SettingsRow
                  key={`${request.channel}-${request.id}`}
                  label={request.name ?? `Someone on ${CHANNELS.find((c) => c.id === request.channel)!.label}`}
                  description={`Pairing code ${request.code}`}
                  right={<SettingsButton disabled={approve.isPending} onClick={() => approve.mutate({ channel: request.channel, code: request.code })}>Approve</SettingsButton>}
                />
              ))}
            </SettingsGroup>
            <p className="px-3 text-footnote text-content-secondary">Only people you approve can message your agent. Unapproved requests expire after an hour.</p>
          </div>
        )}
      </div>

      <Dialog open={connecting !== null} onOpenChange={(open) => !open && setConnecting(null)} title={connecting ? `Connect ${connecting.label}` : ''} className="w-[420px] p-5">
        {connecting && (
          <form onSubmit={(event) => { event.preventDefault(); if (connecting.valid(trimmed)) save.mutate({ id: connecting.id, value: { enabled: true, dmPolicy: 'pairing', [connecting.tokenKey]: trimmed } }) }} className="flex flex-col gap-4">
            <p className="text-body-sm text-content-secondary">{connecting.help}</p>
            <TextField label="Bot token" type="password" value={token} onChange={setToken} autoFocus />
            {trimmed && !connecting.valid(trimmed) && <p className="text-footnote text-error">That doesn't look like a {connecting.label} bot token.</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConnecting(null)} className="h-8 rounded-full px-4 text-body-sm font-medium hover:bg-fill-strong">Cancel</button>
              <button type="submit" disabled={!connecting.valid(trimmed) || save.isPending} className="h-8 rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white disabled:opacity-45">{save.isPending ? 'Connecting…' : 'Connect'}</button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  )
}
