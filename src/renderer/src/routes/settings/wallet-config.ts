/** plugins.entries.onepassword.config, as the broker's manifest schema defines it. */
export type WalletPolicy = 'auto' | 'approve' | 'deny'
export interface OnePasswordItem { item: string; vault?: string; field?: string; policy?: WalletPolicy; description?: string }
export interface OnePasswordConfig { vault?: string; opBin?: string; defaultPolicy?: WalletPolicy; items?: Record<string, OnePasswordItem> }

const SEP = ' · '

/** One alias per card field: `card-<id8>-<field>`, matching the schema's slug pattern. */
export function cardSlug(item: string, field: string): string {
  return `card-${item.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)}-${field}`
}

/** Cards in the Wallet, one entry per 1Password item (its fields share a policy). */
export function walletCardsFromConfig(config: OnePasswordConfig | null | undefined): { item: string; title: string; policy: WalletPolicy }[] {
  const byItem = new Map<string, { item: string; title: string; policy: WalletPolicy }>()
  for (const [slug, entry] of Object.entries(config?.items ?? {})) {
    if (!slug.startsWith('card-') || byItem.has(entry.item)) continue
    byItem.set(entry.item, { item: entry.item, title: entry.description?.split(SEP)[0] ?? entry.item, policy: entry.policy ?? config?.defaultPolicy ?? 'approve' })
  }
  return [...byItem.values()]
}

type Change =
  | { vault: string; item: string; title: string; fields: { key: string; label: string }[]; policy: WalletPolicy; opBin?: string }
  | { item: string; policy: WalletPolicy | null }

/**
 * Adds a card (its fields fetched by label from 1Password's own template),
 * changes a card's policy, or removes it (policy null). Returns null when no
 * items remain, since the schema requires items whenever a vault is set.
 */
export function buildWalletConfig(current: OnePasswordConfig | null | undefined, change: Change): OnePasswordConfig | null {
  const items: Record<string, OnePasswordItem> = { ...(current?.items ?? {}) }
  if ('fields' in change) {
    for (const field of change.fields) {
      items[cardSlug(change.item, field.key)] = { item: change.item, vault: change.vault, field: `label=${field.label}`, policy: change.policy, description: `${change.title}${SEP}${field.label}`.slice(0, 200) }
    }
  } else {
    for (const [slug, entry] of Object.entries(items)) {
      if (entry.item !== change.item) continue
      if (change.policy === null) delete items[slug]
      else items[slug] = { ...entry, policy: change.policy }
    }
  }
  if (Object.keys(items).length === 0) return null
  const vault = current?.vault ?? ('vault' in change ? change.vault : Object.values(items)[0]!.vault)
  return {
    ...current,
    ...('opBin' in change && change.opBin ? { opBin: change.opBin } : {}),
    vault,
    defaultPolicy: current?.defaultPolicy ?? 'approve',
    items,
  }
}

/**
 * config.patch is a JSON merge-patch: a key left out survives, so a removed
 * card's aliases must be sent as null to be deleted.
 */
export function walletPatch(previous: OnePasswordConfig | null | undefined, next: OnePasswordConfig | null): Record<string, unknown> | null {
  if (!next) return null
  const removed = Object.keys(previous?.items ?? {}).filter((slug) => !(slug in (next.items ?? {})))
  return { ...next, items: { ...Object.fromEntries(removed.map((slug) => [slug, null])), ...next.items } }
}
