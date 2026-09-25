import { run } from './exec.js'
import { PROFILE, openclawEnv } from './paths.js'
import { resolveOpenclaw } from './resolve.js'

/**
 * DM pairing for messaging channels. With OpenClaw's default dmPolicy
 * "pairing", a stranger who messages the bot gets a code the owner approves;
 * the gateway exposes no RPC for it, so this drives `openclaw pairing`.
 */

export const PAIRING_CHANNELS = ['telegram', 'discord'] as const
export type PairingChannel = (typeof PAIRING_CHANNELS)[number]

export interface PairingRequest {
  id: string
  code: string
  createdAt?: string
  name?: string
}

export function isPairingChannel(value: unknown): value is PairingChannel {
  return typeof value === 'string' && (PAIRING_CHANNELS as readonly string[]).includes(value)
}

export function isPairingCode(value: unknown): value is string {
  // Must not start with '-': a leading dash would be parsed as a CLI flag.
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/.test(value)
}

function argv(args: string[]): string[] {
  return ['--profile', PROFILE, ...args]
}

export function parsePairingList(stdout: string): PairingRequest[] {
  const start = stdout.indexOf('{')
  if (start < 0) return []
  try {
    const data = JSON.parse(stdout.slice(start)) as { requests?: { id?: unknown; code?: unknown; createdAt?: unknown; meta?: Record<string, unknown> }[] }
    return (data.requests ?? []).flatMap((request) => {
      if (typeof request.id !== 'string' || typeof request.code !== 'string') return []
      const meta = request.meta ?? {}
      const name = [meta.name, meta.displayName, meta.username, meta.senderName].find((value): value is string => typeof value === 'string' && value.length > 0)
      return [{ id: request.id, code: request.code, createdAt: typeof request.createdAt === 'string' ? request.createdAt : undefined, name }]
    })
  } catch {
    return []
  }
}

export async function listPairingRequests(channel: unknown): Promise<PairingRequest[]> {
  if (!isPairingChannel(channel)) return []
  const openclaw = (await resolveOpenclaw())?.bin
  if (!openclaw) return []
  const result = await run(openclaw, argv(['pairing', 'list', channel, '--json']), { env: openclawEnv(), timeoutMs: 60_000 })
  return result.code === 0 ? parsePairingList(result.stdout) : []
}

export async function approvePairingRequest(channel: unknown, code: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPairingChannel(channel) || !isPairingCode(code)) return { ok: false, error: 'Invalid pairing request' }
  const openclaw = (await resolveOpenclaw())?.bin
  if (!openclaw) return { ok: false, error: 'The local agent is not installed yet' }
  const result = await run(openclaw, argv(['pairing', 'approve', channel, code, '--notify']), { env: openclawEnv(), timeoutMs: 60_000 })
  if (result.code === 0) return { ok: true }
  return { ok: false, error: result.stderr.split('\n').map((line) => line.trim()).find((line) => line && !/ExperimentalWarning|trace-warnings|\[config\]/.test(line)) || `Approval failed (exit ${result.code})` }
}
