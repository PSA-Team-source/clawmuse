import { gatewayWS } from '@/services/gateway-ws.service'

/**
 * OpenClaw's team secret store (`secrets.store.*`, gateway 2026.8+), the data
 * behind Muse's "Secure credentials store".
 *
 * Two kinds of entry share one table:
 * - `secret` — write-only. `secrets.store.list` never carries the value, and
 *   `allowedHosts` is the only policy: the exact hostnames the gateway's egress
 *   proxy may substitute it into. `[]` means no website ever receives it;
 *   config SecretRefs can still use it.
 * - `env` — intentionally agent-readable; the list carries its value.
 *
 * `secrets.store.set` always takes the value (a secret cannot be empty), so a
 * secret's websites can only change when its password is entered again.
 */

export type SecretStoreEntry =
  | { name: string; kind: 'secret'; allowedHosts: string[]; createdAtMs: number; updatedAtMs: number; updatedBy?: string }
  | { name: string; kind: 'env'; value: string; createdAtMs: number; updatedAtMs: number; updatedBy?: string }

export interface SecretStoreSet {
  name: string
  value: string
  kind: 'secret' | 'env'
  allowedHosts?: string[]
}

/** `ENV_SECRET_REF_ID_RE` — the name doubles as the entry's SecretRef id. */
export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/

/** Parses the gateway's list reply, dropping anything that is not a well-formed entry. */
export function parseSecretStoreList(raw: unknown): SecretStoreEntry[] {
  const entries = (raw as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) throw new Error('secrets.store.list returned no entries')
  return entries.flatMap((entry): SecretStoreEntry[] => {
    const e = entry as Record<string, unknown>
    if (typeof e.name !== 'string' || typeof e.updatedAtMs !== 'number') return []
    const base = { name: e.name, createdAtMs: typeof e.createdAtMs === 'number' ? e.createdAtMs : e.updatedAtMs, updatedAtMs: e.updatedAtMs, ...(typeof e.updatedBy === 'string' && e.updatedBy ? { updatedBy: e.updatedBy } : {}) }
    if (e.kind === 'secret') return [{ ...base, kind: 'secret', allowedHosts: Array.isArray(e.allowedHosts) ? e.allowedHosts.filter((host): host is string => typeof host === 'string') : [] }]
    if (e.kind === 'env' && typeof e.value === 'string') return [{ ...base, kind: 'env', value: e.value }]
    return []
  })
}

/**
 * One allowed host from what a person types: a full URL keeps only its
 * hostname (Muse's field is "URL"), anything else is passed through for the
 * gateway to validate — it owns the exact-hostname rules and says what is wrong.
 */
export function hostFromInput(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
  if (hasScheme || /[/?#]/.test(text)) {
    try {
      return new URL(hasScheme ? text : `https://${text}`).hostname.toLowerCase().replace(/\.+$/u, '')
    } catch {
      return text
    }
  }
  return text.toLowerCase().replace(/\.+$/u, '')
}

/**
 * The shape half of OpenClaw's `normalizeExactAllowedHost`, so a typo is caught
 * while typing: one exact hostname or IP — no wildcard, scheme, path or port.
 * The gateway still decides; its message is shown if it disagrees.
 */
export function isPlausibleHost(host: string): boolean {
  if (!host || /[\s/?#@*]/u.test(host)) return false
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (bare.includes(':')) return /^[0-9a-f:.]+$/i.test(bare)
  return bare.split('.').every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'))
}

/** A comma/whitespace separated host list, each normalised by `hostFromInput`, de-duplicated. */
export function parseHosts(text: string): string[] {
  return [...new Set(text.split(/[,\s]+/u).map(hostFromInput).filter(Boolean))]
}

/** `github.com` → `GITHUB_COM_PASSWORD`; empty when nothing usable is left. */
export function suggestSecretName(host: string): string {
  const stem = host.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!stem) return ''
  const name = `${/^[A-Z]/.test(stem) ? '' : 'SITE_'}${stem}`.slice(0, 119)
  return `${name}_PASSWORD`
}

export function sameHosts(a: readonly string[], b: readonly string[]): boolean {
  const x = [...a].sort()
  const y = [...b].sort()
  return x.length === y.length && x.every((host, i) => host === y[i])
}

export async function listSecretStore(): Promise<SecretStoreEntry[]> {
  return parseSecretStoreList(await gatewayWS.call('secrets.store.list', {}))
}

export async function setSecretStoreEntry(params: SecretStoreSet): Promise<void> {
  await gatewayWS.call('secrets.store.set', params.kind === 'secret' ? params : { name: params.name, value: params.value, kind: 'env' })
}

export async function deleteSecretStoreEntry(name: string): Promise<void> {
  await gatewayWS.call('secrets.store.delete', { name })
}

/**
 * Whether this gateway runs the destination-bound egress proxy — the only way
 * an agent command can use a stored secret on a website. `status` carries
 * `secretEgressProxy` only while the proxy is active
 * (`secrets.egressProxy.enabled`, off by default, applied on gateway restart).
 */
export async function secretEgressActive(): Promise<boolean> {
  const status = (await gatewayWS.call('status', {})) as { secretEgressProxy?: unknown } | null
  return status?.secretEgressProxy != null
}

/*
 * Logins: a password and its username as two `secret` entries.
 *
 * OpenClaw has no username field, so a login is a pair of entries sharing one
 * stem: `<STEM>_PASSWORD` and `<STEM>_USERNAME` (GITHUB_COM_PASSWORD ↔
 * GITHUB_COM_USERNAME), both `kind: "secret"` with the same `allowedHosts`.
 * That is also how an agent uses it: a Gateway-hosted exec gets every store
 * secret as an environment variable of the entry's name holding a sentinel
 * (`readSecretStoreExecEnvironment` → `storeSecretEnv`), and the egress proxy
 * swaps each sentinel for the real value only on that entry's allowed hosts —
 * so `$GITHUB_COM_USERNAME` and `$GITHUB_COM_PASSWORD` work together on
 * github.com. The agent's `secrets` tool lists both names.
 */

export type SecretEntry = Extract<SecretStoreEntry, { kind: 'secret' }>
export type EnvEntry = Extract<SecretStoreEntry, { kind: 'env' }>

export interface Login {
  /** The password entry's name, present or not — the login's identity. */
  passwordName: string
  /** Null when the password's name has no `_PASSWORD` stem to pair with. */
  usernameName: string | null
  password?: SecretEntry
  username?: SecretEntry
  /** The password's hosts, else the username's. */
  hosts: string[]
  updatedAtMs: number
  updatedBy?: string
}

const PASSWORD_SUFFIX = '_PASSWORD'
const USERNAME_SUFFIX = '_USERNAME'

/** `GITHUB_COM_PASSWORD` → `GITHUB_COM_USERNAME`; null for a name outside the convention. */
export function pairedUsernameName(passwordName: string): string | null {
  return passwordName.endsWith(PASSWORD_SUFFIX) && passwordName.length > PASSWORD_SUFFIX.length
    ? `${passwordName.slice(0, -PASSWORD_SUFFIX.length)}${USERNAME_SUFFIX}`
    : null
}

/** Pairs secret entries into logins (a lone username is kept, never hidden); env entries stay apart. */
export function pairLogins(entries: readonly SecretStoreEntry[]): { logins: Login[]; envs: EnvEntry[] } {
  const byPassword = new Map<string, { password?: SecretEntry; username?: SecretEntry }>()
  const envs: EnvEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'env') { envs.push(entry); continue }
    const isUsername = entry.name.endsWith(USERNAME_SUFFIX) && entry.name.length > USERNAME_SUFFIX.length
    const key = isUsername ? `${entry.name.slice(0, -USERNAME_SUFFIX.length)}${PASSWORD_SUFFIX}` : entry.name
    const slot = byPassword.get(key) ?? {}
    if (isUsername) slot.username = entry
    else slot.password = entry
    byPassword.set(key, slot)
  }
  const logins = [...byPassword.entries()].map(([passwordName, { password, username }]): Login => {
    const newest = [password, username].filter((entry): entry is SecretEntry => Boolean(entry)).sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0]!
    return {
      passwordName,
      usernameName: pairedUsernameName(passwordName),
      ...(password ? { password } : {}),
      ...(username ? { username } : {}),
      hosts: (password ?? username)!.allowedHosts,
      updatedAtMs: newest.updatedAtMs,
      ...(newest.updatedBy ? { updatedBy: newest.updatedBy } : {}),
    }
  })
  return { logins: logins.sort((a, b) => a.passwordName.localeCompare(b.passwordName)), envs }
}

export type LoginPlanError = 'unchanged' | 'password-required' | 'username-required' | 'no-username-slot'

/**
 * The `secrets.store.set` calls for one edit of a login, password first.
 *
 * Values are write-only, so an entry's hosts can only change by rewriting its
 * value: changing websites needs every entry the login has entered again —
 * otherwise the pair would end up on different hosts.
 */
export function planLoginWrites(login: Login, draft: { hosts: string[]; password: string; username: string }): { writes: SecretStoreSet[] } | { error: LoginPlanError } {
  const hostsChanged = !sameHosts(draft.hosts, login.hosts)
  if (draft.username && !login.usernameName) return { error: 'no-username-slot' }
  if (hostsChanged && login.password && !draft.password) return { error: 'password-required' }
  if (hostsChanged && login.username && !draft.username) return { error: 'username-required' }
  const writes: SecretStoreSet[] = []
  if (draft.password) writes.push({ name: login.passwordName, value: draft.password, kind: 'secret', allowedHosts: draft.hosts })
  if (draft.username) writes.push({ name: login.usernameName!, value: draft.username, kind: 'secret', allowedHosts: draft.hosts })
  return writes.length ? { writes } : { error: 'unchanged' }
}

/** Runs writes in order and stops at the first failure, reporting exactly what was saved. */
export async function writeInOrder(writes: readonly SecretStoreSet[]): Promise<{ saved: string[]; failed?: { name: string; error: unknown } }> {
  const saved: string[] = []
  for (const write of writes) {
    try {
      await setSecretStoreEntry(write)
      saved.push(write.name)
    } catch (error) {
      return { saved, failed: { name: write.name, error } }
    }
  }
  return { saved }
}
