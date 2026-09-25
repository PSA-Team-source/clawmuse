import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { run } from './exec.js'
import { PROFILE, openclawEnv } from './paths.js'
import { resolveOpenclaw } from './resolve.js'

/** Workspace-relative, so IDENTITY.md stays small and the gateway serves it at /avatar/main. */
export const AGENT_AVATAR_PATH = 'avatars/clawmuse-avatar.png'
const MAX_AVATAR_BYTES = 1024 * 1024

/**
 * The main agent's workspace exactly as OpenClaw resolves it (per-agent
 * subfolders, installs migrated from ~/.openclaw-clawmuse) — asked of the CLI rather
 * than re-derived here.
 */
export async function mainAgentWorkspace(openclaw: string): Promise<string | null> {
  const result = await run(openclaw, ['--profile', PROFILE, 'agents', 'list', '--json'], { env: openclawEnv(), timeoutMs: 60_000 })
  const start = result.stdout.indexOf('[')
  if (result.code !== 0 || start < 0) return null
  try {
    const agents = JSON.parse(result.stdout.slice(start)) as { id?: string; workspace?: unknown }[]
    const main = agents.find((agent) => agent.id === 'main')
    return typeof main?.workspace === 'string' && main.workspace ? main.workspace : null
  } catch {
    return null
  }
}

/**
 * Sets the local agent's name and avatar through OpenClaw's own
 * `agents set-identity` (the gateway's agents.update does not apply to the
 * implicit default agent). The image is written into the agent workspace.
 */
export async function setAgentIdentity(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { name, pngBase64 } = (input ?? {}) as { name?: unknown; pngBase64?: unknown }
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 64) : ''
  let avatar: Buffer | null = null
  if (pngBase64 !== undefined) {
    if (typeof pngBase64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(pngBase64)) return { ok: false, error: 'Invalid image' }
    avatar = Buffer.from(pngBase64, 'base64')
    // PNG signature — only the square PNG the app encodes is accepted.
    if (avatar.byteLength > MAX_AVATAR_BYTES || avatar.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return { ok: false, error: 'Invalid image' }
  }
  if (!cleanName && !avatar) return { ok: false, error: 'Nothing to change' }

  const openclaw = (await resolveOpenclaw())?.bin
  if (!openclaw) return { ok: false, error: 'The local agent is not installed yet' }
  if (avatar) {
    const workspace = await mainAgentWorkspace(openclaw)
    if (!workspace) return { ok: false, error: "Could not find the agent's workspace" }
    await mkdir(join(workspace, 'avatars'), { recursive: true })
    await writeFile(join(workspace, AGENT_AVATAR_PATH), avatar)
  }
  const args = ['--profile', PROFILE, 'agents', 'set-identity', '--agent', 'main', '--json']
  if (cleanName) args.push('--name', cleanName)
  if (avatar) args.push('--avatar', AGENT_AVATAR_PATH)
  const result = await run(openclaw, args, { env: openclawEnv(), timeoutMs: 60_000 })
  if (result.code === 0) return { ok: true }
  return { ok: false, error: result.stderr.split('\n').map((line) => line.trim()).find((line) => line && !/ExperimentalWarning|trace-warnings|\[config\]/.test(line)) || `Could not update the agent (exit ${result.code})` }
}
