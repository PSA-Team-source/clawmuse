import type { McpMutation, McpProbe, McpServerDefinition, McpServerSummary } from '@shared/ipc'
import { run, runJson } from './exec.js'
import { PROFILE, openclawEnv } from './paths.js'
import { resolveOpenclaw } from './resolve.js'

/**
 * Connectors — MCP servers this machine hosts.
 *
 * Everything here goes through `openclaw mcp …` rather than editing
 * `openclaw.json` directly, and that is the whole design. OpenClaw already owns
 * this registry: it spawns stdio servers, runs the OAuth dance for HTTP ones,
 * probes them for their tool list, and reloads a running gateway without a
 * restart. Writing the JSON ourselves would mean reimplementing all of that and
 * then disagreeing with it.
 *
 * It is also why `mcp` is no longer in the config generator's owned keys: two
 * editors, one of which silently wins on every boot, is not a registry.
 *
 * This is what makes "your machine is the server" true beyond the agent core —
 * any MCP server in the ecosystem can run here, with no account and no cloud.
 */

interface RawServer {
  name?: string
  enabled?: boolean
  configured?: boolean
  ok?: boolean
  transport?: string
  launch?: string
  auth?: string
}

function summarise(raw: RawServer): McpServerSummary {
  return {
    name: raw.name ?? '(unnamed)',
    enabled: raw.enabled !== false,
    configured: raw.configured !== false,
    ok: typeof raw.ok === 'boolean' ? raw.ok : null,
    transport: raw.transport ?? null,
    launch: raw.launch ?? null,
    auth: raw.auth ?? null,
  }
}

/** Every invocation carries the profile, or the CLI acts on `~/.openclaw` instead. */
function argv(args: string[]): string[] {
  return ['--profile', PROFILE, ...args]
}

const OPTS = { env: openclawEnv(), timeoutMs: 60_000 }

async function bin(): Promise<string | null> {
  return (await resolveOpenclaw())?.bin ?? null
}

/** Saved connectors and, where the runtime knows it, whether each one answers. */
export async function listMcpServers(): Promise<McpServerSummary[]> {
  const openclaw = await bin()
  if (!openclaw) return []
  const result = await runJson<{ servers?: RawServer[] }>(openclaw, argv(['mcp', 'status', '--json']), OPTS)
  if (!result.ok) return []
  return (result.data.servers ?? []).map(summarise)
}

/**
 * Registers a connector.
 *
 * `mcp set` takes the definition as a JSON argument, which is also why the
 * definition type above mirrors OpenClaw's own — it is passed through, not
 * translated.
 */
export async function setMcpServer(
  name: string,
  definition: McpServerDefinition,
): Promise<McpMutation> {
  const openclaw = await bin()
  if (!openclaw) return { ok: false, error: 'the local runtime is not installed yet' }
  const result = await run(openclaw, argv(['mcp', 'set', name, JSON.stringify(definition)]), OPTS)
  if (result.code !== 0) {
    return { ok: false, error: result.stderr.trim() || result.stdout.trim() || `exit ${result.code}` }
  }
  // A running gateway keeps its own view of the registry; without this the
  // connector only appears after the next restart.
  await run(openclaw, argv(['mcp', 'reload']), OPTS).catch(() => undefined)
  return { ok: true }
}

export async function removeMcpServer(
  name: string,
): Promise<McpMutation> {
  const openclaw = await bin()
  if (!openclaw) return { ok: false, error: 'the local runtime is not installed yet' }
  const result = await run(openclaw, argv(['mcp', 'unset', name]), OPTS)
  if (result.code !== 0) {
    return { ok: false, error: result.stderr.trim() || result.stdout.trim() || `exit ${result.code}` }
  }
  await run(openclaw, argv(['mcp', 'reload']), OPTS).catch(() => undefined)
  return { ok: true }
}

/**
 * Opens a live connection and reports what the server offers.
 *
 * Worth a separate action from `list`: `status` reads config and is instant,
 * while this actually starts the server, which is the only way to find out that
 * a command is missing from PATH or a URL needs an OAuth login first.
 */
export async function probeMcpServer(
  name: string,
): Promise<McpProbe> {
  const openclaw = await bin()
  if (!openclaw) return { ok: false, error: 'the local runtime is not installed yet' }
  const result = await runJson<{
    tools?: (string | { name?: string })[]
    diagnostics?: (string | { message?: string })[]
  }>(openclaw, argv(['mcp', 'probe', name, '--json']), OPTS)
  if (!result.ok) return { ok: false, error: result.error }

  // `tools` is a flat array of strings — `["filesystem__read_file", …]` — not
  // objects. Reading it as `{ name }` returned fourteen empty strings for a
  // server offering fourteen tools, and the screen said "no tools offered".
  // Both shapes are accepted here so a future CLI change is a nuisance rather
  // than a silent zero.
  const tools = (result.data.tools ?? [])
    .map((tool) => (typeof tool === 'string' ? tool : (tool?.name ?? '')))
    .filter(Boolean)

  // A probe can connect and still be broken; the CLI puts that here.
  const diagnostics = (result.data.diagnostics ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : (entry?.message ?? '')))
    .filter(Boolean)
  if (tools.length === 0 && diagnostics.length > 0) {
    return { ok: false, error: diagnostics.join('; ') }
  }

  return { ok: true, tools }
}
