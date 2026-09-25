import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main.js'
import type { BotDraft, BotMutation, BotPermissions, BotSummary } from '@shared/ipc'
import { run, runJson } from './exec.js'
import { PROFILE, botWorkspace, openclawEnv, paths } from './paths.js'
import { resolveOpenclaw } from './resolve.js'

/**
 * The roster — every bot is an OpenClaw **agent**.
 *
 * Like `mcp.ts`, this orchestrates the CLI rather than editing `openclaw.json`:
 * `openclaw agents add|delete|set-identity` already scaffolds the workspace,
 * seeds the bootstrap files, writes `agents.list[]`, routes the delete through a
 * running gateway so config and the session store share one writer, and moves a
 * deleted workspace to Trash instead of unlinking it. Hand-writing the JSON
 * would mean reimplementing all of that and then disagreeing with it.
 *
 * ## What is shared and what is not
 *
 * Every bot shares the **computer**: one browser profile (so a site logged into
 * once is logged in for all of them), the user's shell, and the shared files
 * directory at `~/.openclaw-clawmuse/workspace`.
 *
 * Every bot keeps its **own** memory (sessions), auth profiles and instructions.
 * That last one is why each bot gets a private workspace rather than pointing
 * them all at the shared directory: persona lives in workspace files —
 * `AGENTS.md`, `SOUL.md`, `IDENTITY.md` are read from `agents.list[].workspace`
 * — so one shared workspace would give the whole roster a single personality
 * wearing different names. The shared directory is reached by absolute path
 * instead, which works because a workspace is the default cwd, not a sandbox.
 */

/** Every invocation carries the profile, or the CLI acts on `~/.openclaw`. */
function argv(args: string[]): string[] {
  return ['--profile', PROFILE, ...args]
}

const OPTS = { env: openclawEnv(), timeoutMs: 120_000 }

async function bin(): Promise<string | null> {
  return (await resolveOpenclaw())?.bin ?? null
}

/** `agents list --json`; see `buildAgentSummaries` in openclaw. */
interface RawAgent {
  id?: string
  name?: string
  identityName?: string
  identityEmoji?: string
  workspace?: string
  agentDir?: string
  model?: string
  isDefault?: boolean
}

/**
 * Agent ids are `/^[a-z0-9][a-z0-9_-]{0,63}$/i` and are lowercased on the way in
 * (`normalizeAgentId`, openclaw `src/routing/session-key.ts`). Deriving the id
 * here rather than letting the CLI coerce it keeps the id the app stores and the
 * id the gateway reports identical — they address sessions, so a silent
 * rewrite would orphan a bot's whole transcript.
 */
export function botIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48)
  return slug || 'bot'
}

/** Appends `-2`, `-3`, … until the id is free. `main` is reserved by OpenClaw. */
export function uniqueBotId(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken, 'main'])
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

/**
 * What "read and draft only" actually denies.
 *
 * Guidelines are prose and a model can talk itself past them; a deny-list is
 * enforced by the gateway before the tool is offered at all. `browser` stays
 * allowed on purpose — a bot that cannot read a page cannot research anything,
 * and reading is most of what a read-only teammate is for. Where it must not
 * *submit* is a sentence in its guidelines, which is the honest division: hard
 * stops for what a policy can express, prose for what it cannot.
 */
const READ_ONLY_DENY = ['write', 'edit', 'apply_patch', 'exec', 'process'] as const

// ── Reading the roster ──────────────────────────────────────────────────────

async function readConfig(): Promise<Record<string, unknown> | null> {
  if (!existsSync(paths.config)) return null
  try {
    return JSON.parse(await readFile(paths.config, 'utf8')) as Record<string, unknown>
  } catch (error) {
    log.warn('[bots] config unreadable:', (error as Error).message)
    return null
  }
}

interface ConfigAgentEntry {
  id?: string
  identity?: { name?: string; theme?: string; emoji?: string; avatar?: string }
  tools?: { deny?: unknown }
}

function configAgents(config: Record<string, unknown> | null): ConfigAgentEntry[] {
  const entries = (config?.agents as { entries?: unknown } | undefined)?.entries
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return []
  return Object.entries(entries as Record<string, unknown>).flatMap(([id, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? [{ ...(value as ConfigAgentEntry), id }]
      : [],
  )
}

/**
 * The roster, as the runtime sees it.
 *
 * The CLI is authoritative for which bots exist and where they live; the config
 * document is read alongside it only for `identity.theme`, which the summary
 * does not carry and which is where a bot's one-line job is stored.
 */
export async function listBots(): Promise<BotSummary[]> {
  const openclaw = await bin()
  if (!openclaw) return []
  const result = await runJson<RawAgent[] | { agents?: RawAgent[] }>(
    openclaw,
    argv(['agents', 'list', '--json']),
    OPTS,
  )
  if (!result.ok) {
    log.warn('[bots] agents list failed:', result.error)
    return []
  }
  const raw = Array.isArray(result.data) ? result.data : (result.data.agents ?? [])
  const config = await readConfig()
  const byId = new Map(
    configAgents(config)
      .filter((entry): entry is ConfigAgentEntry & { id: string } => typeof entry.id === 'string')
      .map((entry) => [entry.id.toLowerCase(), entry]),
  )

  return raw
    .filter((entry): entry is RawAgent & { id: string } => typeof entry.id === 'string' && entry.id.length > 0)
    .map((entry) => {
      const configured = byId.get(entry.id.toLowerCase())
      const identity = configured?.identity ?? {}
      return {
        id: entry.id,
        name: entry.identityName ?? identity.name ?? entry.name ?? entry.id,
        job: identity.theme ?? '',
        emoji: entry.identityEmoji ?? identity.emoji ?? null,
        avatar: identity.avatar ?? null,
        isDefault: entry.isDefault === true,
        workspace: entry.workspace ?? null,
        model: entry.model ?? null,
        permissions: permissionsOf(configured?.tools?.deny),
      } satisfies BotSummary
    })
}

// ── Instructions ────────────────────────────────────────────────────────────

/**
 * The bot's operating guidelines, as `AGENTS.md` in its own workspace.
 *
 * The shared computer is named by absolute path, and the boundary is prose:
 * that is how OpenClaw's standing orders work, and it is also exactly the
 * contract Grok Bot ships — an approval controls the *proposed* action, so the
 * useful place to say "ask first" is before the tool call, not after it.
 */
export function agentsMarkdown(draft: { name: string; job: string; guidelines: string }): string {
  const guidelines = draft.guidelines.trim()
  return [
    `# ${draft.name}`,
    '',
    '## Job',
    '',
    draft.job.trim() || 'General assistant.',
    '',
    '## Operating guidelines',
    '',
    guidelines || 'Ask before anything irreversible. Report back with what you did.',
    '',
    '## The shared computer',
    '',
    `Shared files live in \`${paths.workspace}\`. Anything another bot or the user`,
    'needs to see goes there by absolute path; your own workspace is scratch space',
    'only. The browser and the terminal are shared too, so a site that is already',
    'logged in stays logged in for you — check before asking the user to sign in',
    'again.',
    '',
    '## Working with the other bots',
    '',
    'Use `sessions_list` to see who else is on this machine and `sessions_send` to',
    'hand work over or ask a question. Say in the thread what you handed off and to',
    'whom — a handoff the user cannot see reads as silence.',
    '',
  ].join('\n')
}

async function writeInstructions(workspace: string, draft: BotDraft): Promise<void> {
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'AGENTS.md'), agentsMarkdown(draft), 'utf8')
}

// ── Mutations ───────────────────────────────────────────────────────────────

function failure(error: string): BotMutation {
  return { ok: false, error }
}

/**
 * Creates a bot: workspace + `agents.list[]` entry + identity + instructions.
 *
 * Non-interactive mode "requires both an agent name and `--workspace`", and any
 * explicit flag switches the command out of the wizard — so both are always
 * passed, and the app never has a half-answered prompt waiting on a TTY that
 * does not exist inside an Electron main process.
 */
export async function createBot(draft: BotDraft): Promise<BotMutation> {
  const openclaw = await bin()
  if (!openclaw) return failure('the local runtime is not installed yet')

  const name = draft.name.trim()
  if (!name) return failure('a bot needs a name')

  const existing = await listBots()
  const id = uniqueBotId(botIdFromName(name), existing.map((bot) => bot.id))
  const workspace = botWorkspace(id)

  // Written before the CLI runs: `agents add` seeds bootstrap files into a
  // workspace, and seeding on top of our AGENTS.md leaves it alone, while the
  // reverse order would race it.
  await writeInstructions(workspace, draft)

  const added = await run(
    openclaw,
    argv(['agents', 'add', id, '--workspace', workspace, '--non-interactive', '--json']),
    OPTS,
  )
  if (added.code !== 0) {
    return failure(added.stderr.trim() || added.stdout.trim() || `exit ${added.code}`)
  }

  const identity = await setIdentity(openclaw, id, { name, job: draft.job, emoji: draft.emoji })
  if (!identity.ok) return identity

  await applyPermissions(openclaw, id, draft.permissions ?? 'full')

  const bot: BotSummary = {
    id,
    name,
    job: draft.job,
    emoji: draft.emoji ?? null,
    avatar: null,
    isDefault: false,
    workspace,
    model: null,
    permissions: draft.permissions ?? 'full',
  }
  log.info(`[bots] created ${id} (${name})`)
  return { ok: true, bot }
}

/**
 * Writes the tool policy for one bot.
 *
 * Through `config set` with the agent's own index rather than by rewriting the
 * file: the CLI owns this document, holds whatever lock it needs, and validates
 * before it saves. Finding the index by id each time is what keeps that safe —
 * agents get added and deleted, so a cached position would eventually point at
 * somebody else.
 */
async function applyPermissions(
  openclaw: string,
  id: string,
  permissions: BotPermissions,
): Promise<void> {
  const config = await readConfig()
  const index = configAgents(config).findIndex((entry) => entry.id?.toLowerCase() === id.toLowerCase())
  if (index < 0) {
    log.warn(`[bots] no agents.entries entry for "${id}" — permissions not applied`)
    return
  }

  const value = permissions === 'read-only' ? JSON.stringify(READ_ONLY_DENY) : '[]'
  const result = await run(
    openclaw,
    argv(['config', 'set', `agents.entries.${id}.tools.deny`, value, '--strict-json']),
    OPTS,
  )
  if (result.code !== 0) {
    log.warn(`[bots] could not set permissions for ${id}:`, result.stderr.trim() || result.stdout.trim())
  }
}

/** `full` unless the deny-list says otherwise. */
export function permissionsOf(deny: unknown): BotPermissions {
  if (!Array.isArray(deny)) return 'full'
  return READ_ONLY_DENY.every((tool) => deny.includes(tool)) ? 'read-only' : 'full'
}

async function setIdentity(
  openclaw: string,
  id: string,
  identity: { name?: string; job?: string; emoji?: string },
): Promise<BotMutation> {
  const args = ['agents', 'set-identity', '--agent', id, '--json']
  if (identity.name) args.push('--name', identity.name)
  // `theme` is the persona/vibe field OpenClaw renders into the system prompt.
  // The one-line job is exactly that, and it is the only per-bot field that
  // survives outside the workspace — which is what the roster reads.
  if (identity.job) args.push('--theme', identity.job)
  if (identity.emoji) args.push('--emoji', identity.emoji)

  const result = await run(openclaw, argv(args), OPTS)
  if (result.code !== 0) {
    return failure(result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`)
  }
  return { ok: true, bot: null }
}

/** Renames / re-briefs a bot. The id never changes — it addresses the sessions. */
export async function updateBot(id: string, draft: BotDraft): Promise<BotMutation> {
  const openclaw = await bin()
  if (!openclaw) return failure('the local runtime is not installed yet')

  const bots = await listBots()
  const bot = bots.find((entry) => entry.id === id)
  if (!bot) return failure(`no bot called "${id}"`)

  const identity = await setIdentity(openclaw, id, {
    name: draft.name.trim(),
    job: draft.job,
    emoji: draft.emoji,
  })
  if (!identity.ok) return identity

  await applyPermissions(openclaw, id, draft.permissions ?? 'full')
  await writeInstructions(bot.workspace ?? botWorkspace(id), draft)
  return {
    ok: true,
    bot: { ...bot, name: draft.name.trim(), job: draft.job, emoji: draft.emoji ?? bot.emoji },
  }
}

/** Copies a bot's brief into a new one. Memory is deliberately not copied. */
export async function duplicateBot(id: string, name: string): Promise<BotMutation> {
  const bots = await listBots()
  const source = bots.find((entry) => entry.id === id)
  if (!source) return failure(`no bot called "${id}"`)

  const workspace = source.workspace ?? botWorkspace(id)
  const guidelines = await readFile(join(workspace, 'AGENTS.md'), 'utf8').catch(() => '')

  return createBot({
    name,
    job: source.job,
    guidelines: guidelinesSection(guidelines),
    ...(source.emoji ? { emoji: source.emoji } : {}),
  })
}

/**
 * Pulls the user's own words back out of a generated `AGENTS.md`.
 *
 * A duplicate that copied the whole file would carry two "shared computer"
 * sections after the next edit, growing one section per duplication.
 */
export function guidelinesSection(markdown: string): string {
  const match = /##\s+Operating guidelines\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/.exec(markdown)
  return (match?.[1] ?? '').trim()
}

/**
 * What the Edit profile sheet puts in the guidelines box.
 *
 * A hand-edited `AGENTS.md` with no recognisable section is returned whole
 * rather than as an empty box: losing the user's instructions because a heading
 * was renamed would be the worst possible failure here.
 */
export async function readGuidelines(id: string): Promise<string> {
  const bots = await listBots()
  const workspace = bots.find((bot) => bot.id === id)?.workspace ?? botWorkspace(id)
  const markdown = await readFile(join(workspace, 'AGENTS.md'), 'utf8').catch(() => '')
  if (!markdown.trim()) return ''
  return guidelinesSection(markdown) || markdown.trim()
}

// ── First run ───────────────────────────────────────────────────────────────

/**
 * The roster a fresh install opens with.
 *
 * Four bots, not one: the product is "a team you message", and a single row in
 * the sidebar teaches the opposite. Each brief is written to be usable as-is —
 * a seeded bot that says "you are a helpful assistant" is a stub wearing a name.
 *
 * Nothing here needs a connector. A seeded bot the user cannot actually run is
 * worse than an empty roster, so bots that depend on a linked account (ads,
 * store) are offered when that account is linked, not before.
 */
export const SEED_ROSTER: BotDraft[] = [
  {
    name: 'Inbox Manager',
    job: 'keeps the inbox triaged and nothing waiting on a reply',
    emoji: '📥',
    guidelines: [
      'Triage first, write second. Group what arrived into: needs the user, needs a',
      'reply you can draft, needs nothing. Say the counts before the detail.',
      '',
      'Draft replies in the user\'s voice — read the last few sent messages before',
      'writing the first one. Send nothing without being asked; a draft in the thread',
      'is the deliverable.',
      '',
      'Never archive, delete, or mark read on the user\'s behalf. Flagging is fine.',
      '',
      'End every pass with what is still open and who is blocking it.',
    ].join('\n'),
  },
  {
    name: 'Account Manager',
    job: 'tracks the customer accounts and the follow-ups they are owed',
    emoji: '🤝',
    guidelines: [
      'Own the follow-up, not the CRM hygiene: what was promised, by when, and is it',
      'late. Late items lead.',
      '',
      'Before writing to any account record, show the change and wait. Reading and',
      'summarising needs no permission; writing does.',
      '',
      'Quote the customer verbatim when it matters. A paraphrase of a complaint loses',
      'the part that made it one.',
      '',
      'When something needs a decision the user has to make, put the options and your',
      'recommendation in the thread instead of stalling on it.',
    ].join('\n'),
  },
  {
    name: 'Talent Scout',
    job: 'sources candidates and keeps the hiring pipeline moving',
    emoji: '🔍',
    guidelines: [
      'Start from the role, not the search. If the brief is thin, ask the two or three',
      'questions that would change who you look for, then go.',
      '',
      'For each candidate: why them, in one line, with a link. No résumé retyping.',
      '',
      'Rank, and say what the ranking cost — "stronger backend, no fintech" is useful;',
      '"great fit" is not.',
      '',
      'Never contact a candidate without explicit approval of the exact message.',
    ].join('\n'),
  },
  {
    name: 'Expense Manager',
    job: 'reconciles receipts and flags spending that looks wrong',
    emoji: '🧾',
    guidelines: [
      'Match receipts to charges. Report the unmatched in both directions — a charge',
      'with no receipt and a receipt with no charge are different problems.',
      '',
      'Flag: duplicates, an unexpected renewal, a step change against the same period',
      'last month, and anything outside the categories already in use.',
      '',
      'Money is written exactly as the source has it, currency included. Never round',
      'in a total the user might paste somewhere else.',
      '',
      'Filing, submitting, or paying anything is an approval, every time, however',
      'small the amount.',
    ].join('\n'),
  },
]

/**
 * Creates the starting roster, once.
 *
 * Idempotent by construction: it does nothing at all once any bot beyond the
 * built-in `main` exists, so a user who deleted three of the four does not find
 * them back on the next launch.
 */
export async function seedRoster(): Promise<BotSummary[]> {
  const existing = await listBots()
  if (existing.some((bot) => bot.id !== 'main')) return existing

  const created: BotSummary[] = []
  for (const draft of SEED_ROSTER) {
    const result = await createBot(draft)
    if (result.ok && result.bot) created.push(result.bot)
    // One bad seed must not cost the other three — the roster is a starting
    // point, not a transaction.
    else if (!result.ok) log.warn(`[bots] could not seed "${draft.name}": ${result.error}`)
  }
  if (created.length > 0) log.info(`[bots] seeded ${created.length} bots`)
  return [...existing, ...created]
}

/**
 * Deletes a bot.
 *
 * `--force` because there is no TTY to confirm on, and the CLI's own safety net
 * is better than a prompt anyway: the workspace, agent state and transcripts go
 * to Trash rather than being unlinked, and a workspace another agent also uses
 * is retained rather than taken away from it.
 */
export async function deleteBot(id: string): Promise<BotMutation> {
  const openclaw = await bin()
  if (!openclaw) return failure('the local runtime is not installed yet')
  if (id === 'main') return failure('the default bot cannot be deleted')

  const result = await run(openclaw, argv(['agents', 'delete', id, '--force', '--json']), OPTS)
  if (result.code !== 0) {
    return failure(result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`)
  }
  log.info(`[bots] deleted ${id}`)
  return { ok: true, bot: null }
}
