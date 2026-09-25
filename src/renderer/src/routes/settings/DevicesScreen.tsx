import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { useToast } from '@/components/patterns'
import { Dialog } from '@/components/primitives'
import { gatewayWS } from '@/services/gateway-ws.service'
import { formatRelativeTime } from '@/utils/format'

interface PairedDevice {
  deviceId: string
  displayName?: string
  platform?: string
  clientMode?: string
  connected?: boolean
  lastSeenAtMs?: number
  approvedAtMs?: number
}

interface PendingRequest {
  requestId: string
  displayName?: string
  platform?: string
}

interface PairList {
  paired: PairedDevice[]
  pending: PendingRequest[]
}

const PLATFORM: Record<string, string> = { darwin: 'Mac', win32: 'Windows', linux: 'Linux', ios: 'iPhone', android: 'Android' }

function describe(device: PairedDevice): string {
  const platform = device.platform ? PLATFORM[device.platform] ?? device.platform : undefined
  const status = device.connected ? 'Connected' : device.lastSeenAtMs ? `Last seen ${formatRelativeTime(new Date(device.lastSeenAtMs).toISOString())}` : 'Not connected'
  return platform ? `${platform} · ${status}` : status
}

/**
 * Muse's Settings > Devices (SettingsDevicesTab): "This device", "Other
 * devices", each opening a detail view. Backed by the local gateway's own
 * pairing registry (device.pair.*) — every app or phone paired with this agent.
 */
export default function DevicesScreen() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)
  const selfId = useQuery({ queryKey: ['device-id'], queryFn: () => window.clawmuse.runtime.deviceId(), staleTime: Infinity })
  const list = useQuery({
    queryKey: ['device-pairs'],
    queryFn: async () => {
      const raw = (await gatewayWS.call('device.pair.list', {})) as Partial<PairList>
      return { paired: raw.paired ?? [], pending: raw.pending ?? [] } satisfies PairList
    },
    refetchInterval: 15_000,
  })
  const act = useMutation({
    mutationFn: ({ method, params }: { method: string; params: Record<string, string> }) => gatewayWS.call(method, params),
    onSuccess: () => { setOpenId(null); void queryClient.invalidateQueries({ queryKey: ['device-pairs'] }) },
    onError: (error) => toast.show({ title: 'That did not work', description: error instanceof Error ? error.message : undefined, variant: 'error' }),
  })

  const bind = useQuery({
    queryKey: ['gateway-bind'],
    queryFn: async () => {
      const current = await gatewayWS.getConfig()
      const source = (current.sourceConfig ?? current.config ?? {}) as { gateway?: { bind?: unknown } }
      return typeof source.gateway?.bind === 'string' ? source.gateway.bind : 'loopback'
    },
  })
  const [adding, setAdding] = useState(false)
  const [invite, setInvite] = useState<{ kind: 'loading' } | { kind: 'code'; code: string; qr?: string; expiresAtMs?: number } | { kind: 'needs-network' } | { kind: 'error'; message: string }>({ kind: 'loading' })

  async function requestCode(attempts = 1): Promise<void> {
    setInvite({ kind: 'loading' })
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const result = await gatewayWS.call<{ setupCode: string; qrDataUrl?: string; expiresAtMs?: number }>('device.pair.setupCode', { includeQr: true })
        setInvite({ kind: 'code', code: result.setupCode, qr: result.qrDataUrl, expiresAtMs: result.expiresAtMs })
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not create a pairing code'
        if (/loopback/i.test(message)) { setInvite({ kind: 'needs-network' }); return }
        if (attempt === attempts - 1) setInvite({ kind: 'error', message })
        else await new Promise((resolve) => setTimeout(resolve, 3000)) // gateway restarting after a bind change
      }
    }
  }

  async function setNetworkAccess(on: boolean): Promise<void> {
    try {
      await gatewayWS.setConfig('gateway.bind', on ? 'lan' : 'loopback')
      await queryClient.invalidateQueries({ queryKey: ['gateway-bind'] })
      if (on) await requestCode(10)
    } catch (error) {
      toast.show({ title: 'Could not change network access', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    }
  }

  const paired = list.data?.paired ?? []
  const current = paired.find((device) => device.deviceId === selfId.data?.deviceId)
  const others = paired.filter((device) => device.deviceId !== selfId.data?.deviceId)
  const open = paired.find((device) => device.deviceId === openId)

  if (open) {
    const isSelf = open.deviceId === selfId.data?.deviceId
    return (
      <div className="h-full w-full overflow-y-auto bg-bg-base">
        <div className="drag h-11 w-full shrink-0" />
        <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
          <button type="button" onClick={() => setOpenId(null)} className="self-start text-body-sm text-content-secondary hover:text-content-primary">‹ Devices</button>
          <h1 className="text-title-1 font-bold text-content-primary">{isSelf ? 'This device' : open.displayName ?? 'Device'}</h1>
          <SettingsGroup className="mb-0">
            <SettingsRow label="Name" value={(isSelf ? selfId.data?.name : undefined) || open.displayName || '—'} />
            <SettingsRow label="Status" value={describe(open)} />
            {open.approvedAtMs && <SettingsRow label="Paired" value={new Date(open.approvedAtMs).toLocaleDateString()} />}
          </SettingsGroup>
          {!isSelf && (
            <SettingsGroup className="mb-0">
              <SettingsRow label="Remove device" description="It loses access to this agent until it pairs again" danger onClick={() => act.mutate({ method: 'device.pair.remove', params: { deviceId: open.deviceId } })} />
            </SettingsGroup>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">Devices</h1>
        {list.isError ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-body text-content-secondary">Unable to load devices.</p>
            <SettingsButton onClick={() => void list.refetch()}>Try again</SettingsButton>
          </div>
        ) : list.isPending ? null : (
          <>
            {(list.data?.pending.length ?? 0) > 0 && (
              <SettingsGroup title="Waiting for approval" className="mb-0">
                {list.data!.pending.map((request) => (
                  <SettingsRow
                    key={request.requestId}
                    label={request.displayName ?? 'New device'}
                    description={request.platform ? PLATFORM[request.platform] ?? request.platform : undefined}
                    right={<span className="flex gap-2">
                      <SettingsButton disabled={act.isPending} onClick={() => act.mutate({ method: 'device.pair.reject', params: { requestId: request.requestId } })}>Decline</SettingsButton>
                      <SettingsButton disabled={act.isPending} onClick={() => act.mutate({ method: 'device.pair.approve', params: { requestId: request.requestId } })}>Approve</SettingsButton>
                    </span>}
                  />
                ))}
              </SettingsGroup>
            )}
            {current && (
              <SettingsGroup title="This device" className="mb-0">
                <SettingsRow label={selfId.data?.name || current.displayName || 'This device'} description={describe(current)} onClick={() => setOpenId(current.deviceId)} />
              </SettingsGroup>
            )}
            {others.length > 0 && (
              <SettingsGroup title="Other devices" className="mb-0">
                {others.map((device) => <SettingsRow key={device.deviceId} label={device.displayName ?? 'Device'} description={describe(device)} onClick={() => setOpenId(device.deviceId)} />)}
              </SettingsGroup>
            )}
            {!current && others.length === 0 && <p className="py-12 text-center text-body text-content-secondary">No devices found.</p>}
            <SettingsGroup className="mb-0">
              <SettingsRow label="Add a device" description="Pair the OpenClaw app on your phone or another computer" onClick={() => { setAdding(true); void requestCode() }} />
              {bind.data && bind.data !== 'loopback' && (
                <SettingsRow label="Network access" description="Devices on your network can reach this agent" right={<SettingsButton onClick={() => void setNetworkAccess(false)}>Turn off</SettingsButton>} />
              )}
            </SettingsGroup>
          </>
        )}
      </div>

      <Dialog open={adding} onOpenChange={setAdding} title="Add a device" className="w-[420px] p-5">
        {invite.kind === 'loading' && <p className="py-6 text-center text-body-sm text-content-secondary">Preparing a pairing code…</p>}
        {invite.kind === 'needs-network' && (
          <div className="flex flex-col gap-4">
            <p className="text-body-sm text-content-secondary">Your agent only accepts connections from this computer. To pair another device, let devices on your network reach it. They still need a pairing code, and you approve each one here.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(false)} className="h-8 rounded-full px-4 text-body-sm font-medium hover:bg-fill-strong">Cancel</button>
              <button type="button" onClick={() => void setNetworkAccess(true)} className="h-8 rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white">Allow on this network</button>
            </div>
          </div>
        )}
        {invite.kind === 'code' && (
          <div className="flex flex-col items-center gap-3 text-center">
            {invite.qr && <img src={invite.qr} alt="Pairing QR code" className="size-52 rounded-xl bg-white p-2" />}
            <p className="text-body-sm text-content-secondary">Scan with the OpenClaw app, or enter this code:</p>
            <p className="select-all font-mono text-title-3 text-content-primary">{invite.code}</p>
            {invite.expiresAtMs && <p className="text-footnote text-content-secondary">Expires {new Date(invite.expiresAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. The device will appear under Waiting for approval.</p>}
          </div>
        )}
        {invite.kind === 'error' && <p role="alert" className="py-4 text-body-sm text-error">{invite.message}</p>}
      </Dialog>
    </div>
  )
}
