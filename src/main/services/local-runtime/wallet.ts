import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { run } from './exec.js'
import { openclawEnv, paths } from './paths.js'

/**
 * Settings > Wallet, on OpenClaw's bundled 1Password broker (extensions/
 * onepassword): payment cards stay in the user's 1Password vault; the agent
 * can only ask for fields registered in plugins.entries.onepassword.config,
 * each with a policy (auto / approve / deny), every use audited by the plugin.
 * This service covers what the gateway has no RPC for: finding `op`, storing
 * the service-account token where the plugin reads it, and listing vaults,
 * cards and the Credit Card field labels (never card values).
 */

export interface WalletStatus {
  opPath: string | null
  connected: boolean
  vaults: { id: string; name: string }[]
  error?: string
}

export interface WalletCardField { key: string; label: string }

const TOKEN_FILE = () => join(paths.home, 'credentials', 'onepassword', 'service-account-token')

export function findOp(pathEnv = openclawEnv().PATH ?? process.env.PATH ?? ''): string | null {
  const candidates = [...pathEnv.split(delimiter).filter(Boolean).map((dir) => join(dir, 'op')), '/opt/homebrew/bin/op', '/usr/local/bin/op']
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function op(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const bin = findOp()
  if (!bin) return { ok: false, error: '1Password CLI is not installed' }
  const token = existsSync(TOKEN_FILE()) ? (await readFile(TOKEN_FILE(), 'utf8')).trim() : ''
  const result = await run(bin, args, {
    env: { ...process.env as Record<string, string>, ...(token ? { OP_SERVICE_ACCOUNT_TOKEN: token } : {}), OP_LOAD_DESKTOP_APP_SETTINGS: 'false', OP_BIOMETRIC_UNLOCK_ENABLED: 'false' },
    timeoutMs: 30_000,
  })
  if (result.code === 0) return { ok: true, stdout: result.stdout }
  return { ok: false, error: result.stderr.trim().split('\n').pop() || `1Password CLI failed (exit ${result.code})` }
}

function parseList(stdout: string): { id: string; title?: string; name?: string }[] {
  try {
    const value = JSON.parse(stdout) as unknown
    return Array.isArray(value) ? value.filter((entry): entry is { id: string; title?: string; name?: string } => typeof (entry as { id?: unknown })?.id === 'string') : []
  } catch {
    return []
  }
}

export async function walletStatus(): Promise<WalletStatus> {
  const opPath = findOp()
  const connected = existsSync(TOKEN_FILE())
  if (!opPath || !connected) return { opPath, connected, vaults: [] }
  const vaults = await op(['vault', 'list', '--format', 'json'])
  if (!vaults.ok) return { opPath, connected, vaults: [], error: vaults.error }
  return { opPath, connected, vaults: parseList(vaults.stdout).map((vault) => ({ id: vault.id, name: vault.name ?? vault.id })) }
}

/** Stores a 1Password service-account token where the broker reads it (0600), keeping it only if it works. */
export async function connectWallet(token: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof token !== 'string' || !/^ops_[A-Za-z0-9_=-]{20,}$/.test(token.trim())) return { ok: false, error: 'That is not a 1Password service account token' }
  const file = TOKEN_FILE()
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 })
  await writeFile(file, token.trim(), { mode: 0o600 })
  await chmod(file, 0o600)
  const check = await op(['vault', 'list', '--format', 'json'])
  if (!check.ok) {
    await rm(file, { force: true })
    return { ok: false, error: check.error }
  }
  return { ok: true }
}

export async function disconnectWallet(): Promise<void> {
  await rm(TOKEN_FILE(), { force: true })
}

export async function walletCards(vault: unknown): Promise<{ id: string; title: string }[]> {
  if (typeof vault !== 'string' || !vault || vault.startsWith('-')) return []
  const list = await op(['item', 'list', '--vault', vault, '--categories', 'Credit Card', '--format', 'json'])
  return list.ok ? parseList(list.stdout).map((item) => ({ id: item.id, title: item.title ?? item.id })) : []
}

/**
 * The Credit Card fields to register, read from 1Password's own template
 * (`op item template get "Credit Card"`) rather than hard-coded labels.
 */
export function pickCardFields(templateJson: string): WalletCardField[] {
  let fields: { id?: string; type?: string; label?: string }[] = []
  try {
    fields = (JSON.parse(templateJson) as { fields?: typeof fields }).fields ?? []
  } catch {
    return []
  }
  const pick = (key: string, match: (field: (typeof fields)[number]) => boolean) => {
    const field = fields.find(match)
    return field?.label ? [{ key, label: field.label }] : []
  }
  return [
    ...pick('number', (f) => f.type === 'CREDIT_CARD_NUMBER'),
    ...pick('expiry', (f) => f.type === 'MONTH_YEAR' && /expir/i.test(f.label ?? f.id ?? '')),
    ...pick('cvv', (f) => f.type === 'CONCEALED' && /verif|cvv|security/i.test(f.label ?? f.id ?? '')),
    ...pick('holder', (f) => /cardholder/i.test(f.label ?? f.id ?? '')),
  ]
}

export async function walletCardFields(): Promise<WalletCardField[]> {
  const template = await op(['item', 'template', 'get', 'Credit Card', '--format', 'json'])
  return template.ok ? pickCardFields(template.stdout) : []
}

/**
 * The broker's registered items. The gateway redacts this block in config.get
 * (it names vault items), so it is read from the config file the gateway owns.
 */
export async function walletConfig(): Promise<unknown> {
  try {
    const config = JSON.parse(await readFile(paths.config, 'utf8')) as { plugins?: { entries?: { onepassword?: { config?: unknown } } } }
    return config.plugins?.entries?.onepassword?.config ?? null
  } catch {
    return null
  }
}
