import { describe, expect, it } from 'vitest'
import { buildWalletConfig, cardSlug, walletCardsFromConfig } from '@/routes/settings/wallet-config'

describe('wallet config (1Password broker)', () => {
  const fields = [{ key: 'number', label: 'number' }, { key: 'cvv', label: 'verification number' }]

  it('registers one approval-gated alias per card field, by label, and lists the card once', () => {
    const config = buildWalletConfig(null, { vault: 'Payments', item: 'AbC123xyz9', title: 'Visa', fields, policy: 'approve', opBin: '/opt/homebrew/bin/op' })!
    expect(config.vault).toBe('Payments')
    expect(config.opBin).toBe('/opt/homebrew/bin/op')
    expect(config.items![cardSlug('AbC123xyz9', 'cvv')]).toEqual({ item: 'AbC123xyz9', vault: 'Payments', field: 'label=verification number', policy: 'approve', description: 'Visa · verification number' })
    expect(Object.keys(config.items!).every((slug) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug))).toBe(true)
    expect(walletCardsFromConfig(config)).toEqual([{ item: 'AbC123xyz9', title: 'Visa', policy: 'approve' }])
  })

  it('changes a card policy across its fields, and removing the last card clears the block', () => {
    const added = buildWalletConfig(null, { vault: 'P', item: 'id1', title: 'Visa', fields, policy: 'approve' })
    const allowed = buildWalletConfig(added, { item: 'id1', policy: 'auto' })!
    expect(Object.values(allowed.items!).map((item) => item.policy)).toEqual(['auto', 'auto'])
    expect(buildWalletConfig(allowed, { item: 'id1', policy: null })).toBeNull()
  })
})
