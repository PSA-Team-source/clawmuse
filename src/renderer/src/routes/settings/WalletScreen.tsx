import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsButton, SettingsGroup, SettingsRow } from '@/components/settings'
import { TextField, useToast } from '@/components/patterns'
import { Dialog, Select } from '@/components/primitives'
import { gatewayWS } from '@/services/gateway-ws.service'
import { buildWalletConfig, walletCardsFromConfig, walletPatch, type OnePasswordConfig, type WalletPolicy } from '@/routes/settings/wallet-config'

const POLICIES: { value: WalletPolicy; label: string }[] = [
  { value: 'approve', label: 'Ask every time' },
  { value: 'auto', label: 'Allow' },
  { value: 'deny', label: "Don't allow" },
]
const CONFIG_KEY = ['onepassword-config'] as const

/**
 * Muse's Settings > Wallet (SettingsWalletTab), on OpenClaw's bundled 1Password
 * broker. Cards never leave the user's vault until the agent asks for one and
 * the policy allows it — by default, each request is approved in ClawMuse.
 */
export default function WalletScreen() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['wallet-status'], queryFn: () => window.clawmuse.wallet.status() })
  const config = useQuery({
    queryKey: CONFIG_KEY,
    // config.get redacts this block, so main reads it from the gateway's config file.
    queryFn: async () => ((await window.clawmuse.wallet.config()) as OnePasswordConfig | null) ?? null,
  })
  const cards = walletCardsFromConfig(config.data)
  const [connectOpen, setConnectOpen] = useState(false)
  const [token, setToken] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [vault, setVault] = useState('')
  const [busy, setBusy] = useState(false)
  const vaultCards = useQuery({ queryKey: ['wallet-cards', vault], enabled: Boolean(vault), queryFn: () => window.clawmuse.wallet.cards(vault) })

  async function writeConfig(next: OnePasswordConfig | null): Promise<void> {
    await gatewayWS.setConfig('plugins.entries.onepassword.config', walletPatch(config.data, next))
    queryClient.setQueryData(CONFIG_KEY, next)
  }

  async function connect(): Promise<void> {
    setBusy(true)
    const result = await window.clawmuse.wallet.connect(token)
    setBusy(false)
    if (!result.ok) { toast.show({ title: 'Could not connect 1Password', description: result.error, variant: 'error' }); return }
    setConnectOpen(false)
    setToken('')
    void queryClient.invalidateQueries({ queryKey: ['wallet-status'] })
  }

  async function addCard(card: { id: string; title: string }): Promise<void> {
    setBusy(true)
    try {
      const fields = await window.clawmuse.wallet.cardFields()
      if (fields.length === 0) throw new Error('1Password did not return the Credit Card fields')
      await writeConfig(buildWalletConfig(config.data, { vault, item: card.id, title: card.title, fields, policy: 'approve', opBin: status.data?.opPath ?? undefined }))
      setAddOpen(false)
      toast.show({ title: `${card.title} added to Wallet`, description: 'ClawMuse will ask you before the agent uses it.' })
    } catch (error) {
      toast.show({ title: 'Could not add the card', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function setPolicy(item: string, policy: WalletPolicy | null): Promise<void> {
    try {
      await writeConfig(buildWalletConfig(config.data, { item, policy }))
    } catch (error) {
      toast.show({ title: 'Could not update this permission', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    }
  }

  const ready = status.data?.opPath && status.data.connected && !status.data.error

  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">Wallet</h1>
        <p className="-mt-3 text-body-sm text-content-secondary">Add payment methods to allow ClawMuse to make secure purchases and transactions for you.</p>

        {status.data && !ready && (
          <div className="flex flex-col gap-2">
            <SettingsGroup title="Set up" className="mb-0">
              <SettingsRow
                label="1Password CLI"
                description={status.data.opPath ? 'Installed' : 'Your cards stay in 1Password; ClawMuse uses its command-line tool'}
                right={status.data.opPath ? undefined : <SettingsButton onClick={() => void window.clawmuse.shell.openExternal('https://www.1password.dev/cli/get-started/')}>Install</SettingsButton>}
              />
              <SettingsRow
                label="Service account"
                description={status.data.error ?? (status.data.connected ? 'Connected' : 'A read-only service account for the vault that holds your cards')}
                right={status.data.opPath ? <SettingsButton onClick={() => setConnectOpen(true)}>{status.data.connected ? 'Replace' : 'Connect'}</SettingsButton> : undefined}
              />
            </SettingsGroup>
            <p className="px-3 text-footnote text-content-secondary">Create one in 1Password with access to a single vault. <button type="button" className="text-muse-blue" onClick={() => void window.clawmuse.shell.openExternal('https://www.1password.dev/service-accounts/get-started/')}>How to create a service account</button></p>
          </div>
        )}

        {ready && (
          <>
            <SettingsGroup title="Payment methods" className="mb-0">
              {cards.map((card) => (
                <SettingsRow
                  key={card.item}
                  label={card.title}
                  description="Create spend requests"
                  right={<span className="flex items-center gap-2">
                    <Select size="compact" className="muse-plain-select" aria-label={`${card.title}, create spend requests`} value={card.policy} items={POLICIES} onValueChange={(value) => void setPolicy(card.item, value as WalletPolicy)} />
                    <SettingsButton onClick={() => void setPolicy(card.item, null)}>Remove</SettingsButton>
                  </span>}
                />
              ))}
              <SettingsRow label="Add payment method" onClick={() => { setVault(status.data!.vaults[0]?.id ?? ''); setAddOpen(true) }} />
            </SettingsGroup>
            <SettingsGroup className="mb-0">
              <SettingsRow label="1Password" description="Connected" right={<SettingsButton onClick={() => void (async () => { await writeConfig(null); await window.clawmuse.wallet.disconnect(); void queryClient.invalidateQueries({ queryKey: ['wallet-status'] }) })()}>Disconnect</SettingsButton>} />
            </SettingsGroup>
          </>
        )}
      </div>

      <Dialog open={connectOpen} onOpenChange={setConnectOpen} title="Connect 1Password" className="w-[420px] p-5">
        <form onSubmit={(event) => { event.preventDefault(); void connect() }} className="flex flex-col gap-4">
          <p className="text-body-sm text-content-secondary">Paste a service account token. It is stored only on this computer, readable by you alone.</p>
          <TextField label="Service account token" type="password" value={token} onChange={setToken} autoFocus />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConnectOpen(false)} className="h-8 rounded-full px-4 text-body-sm font-medium hover:bg-fill-strong">Cancel</button>
            <button type="submit" disabled={busy || !token.trim().startsWith('ops_')} className="h-8 rounded-full bg-muse-blue px-4 text-body-sm font-medium text-white disabled:opacity-45">{busy ? 'Connecting…' : 'Connect'}</button>
          </div>
        </form>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen} title="Add payment method" className="w-[420px] p-5">
        <div className="flex flex-col gap-3">
          {(status.data?.vaults.length ?? 0) > 1 && <Select aria-label="Vault" value={vault} items={status.data!.vaults.map((v) => ({ value: v.id, label: v.name }))} onValueChange={setVault} />}
          {vaultCards.data?.length === 0 && <p className="py-4 text-center text-body-sm text-content-secondary">No credit cards in this vault.</p>}
          {vaultCards.data?.filter((card) => !cards.some((existing) => existing.item === card.id)).map((card) => (
            <SettingsRow key={card.id} label={card.title} right={<SettingsButton disabled={busy} onClick={() => void addCard(card)}>Add to Wallet</SettingsButton>} />
          ))}
        </div>
      </Dialog>
    </div>
  )
}
