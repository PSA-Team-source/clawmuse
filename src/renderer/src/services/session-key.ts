/**
 * Session key conventions.
 *
 * Originally ported 1:1 from mobile `src/services/session-key.ts`. Desktop has
 * since diverged in exactly one place — it is the only client that runs **many
 * bots in one gateway**, so it cannot assume the `main` agent. Mobile talks to a
 * single-agent container and is unaffected; every other helper here is still
 * byte-compatible with it.
 *
 * The gateway addresses a conversation as `agent:<agentId>:<local>`. Three
 * distinct questions get asked about that string, and conflating them is what
 * made the single-agent version wrong:
 *
 *   1. *Which bot owns this?*        → `agentIdFromSessionKey`
 *   2. *Which conversation is this?* → `normalizeSessionKey` (the local part)
 *   3. *What do I call it?*          → `canonicalSessionKey` (unique app-wide,
 *                                      and exactly what goes back on the wire)
 *
 * (2) alone is not a usable identity: every bot has a `webchat:main`, so keying
 * threads by the local part collapses the whole roster into one conversation.
 */

/** The agent the gateway assumes when a key carries no prefix. */
export const DEFAULT_AGENT_ID = 'main'

/**
 * `agent:<id>:<local>` — `<id>` cannot contain a colon, `<local>` usually does.
 * Anchored, so `webchat:agent:main:x` is left alone: only a leading prefix is
 * an agent scope.
 */
const AGENT_PREFIX = /^agent:([^:]+):(.+)$/

export interface ParsedSessionKey {
  /** `null` when the key carries no agent scope at all. */
  agentId: string | null
  /** The conversation part, with any agent scope removed. */
  local: string
}

export function parseSessionKey(key: string): ParsedSessionKey {
  const match = AGENT_PREFIX.exec(key)
  if (!match) return { agentId: null, local: key }
  return { agentId: match[1]!, local: match[2]! }
}

/**
 * The conversation part, for display and for skill/channel parsing.
 *
 * Strips **any** agent scope, not just `main`'s — a thread named "Main" should
 * read the same whichever bot is answering.
 */
export function normalizeSessionKey(key: string): string {
  return parseSessionKey(key).local
}

/** The bot a key belongs to, or `null` for an unscoped (default-agent) key. */
export function agentIdFromSessionKey(key: string): string | null {
  return parseSessionKey(key).agentId
}

/**
 * Builds the addressable key for one bot's conversation.
 *
 * The default agent stays **unprefixed**: that is the form this app has always
 * sent, the gateway resolves it to `main` on its own, and keeping it means
 * existing threads, stored ids and the mobile-compatible helpers below do not
 * shift under an upgrade.
 */
export function sessionKeyFor(agentId: string | null | undefined, local: string): string {
  if (!agentId || agentId === DEFAULT_AGENT_ID) return local
  return `agent:${agentId}:${local}`
}

/**
 * The one true name for a conversation — used as the app-side id **and** as the
 * `sessionKey` sent back to the gateway.
 *
 * Those must be the same string. `chat.send` validates an explicit `agentId`
 * against the prefix it parses out of `sessionKey` and rejects a mismatch
 * (`validateChatSelectedAgent`, openclaw `src/gateway/server-methods/chat.ts`),
 * so a client that stripped the prefix on the way out could not address any bot
 * but the default one.
 */
export function canonicalSessionKey(key: string): string {
  const { agentId, local } = parseSessionKey(key)
  return sessionKeyFor(agentId, local)
}

/**
 * The conversation an inbound frame belongs to.
 *
 * A gateway event reports the bot in **either** of two places — prefixed into
 * `sessionKey`, or as a sibling `agentId` field — and which one depends on the
 * method that produced it. Reading only the key silently merges every bot's
 * `webchat:main` into one thread; reading only `agentId` loses the scope on the
 * frames that omit it. The prefix wins when both are present: it is the key the
 * session is actually stored under.
 */
export function eventSessionKey(sessionKey: string, agentId?: string | null): string {
  const parsed = parseSessionKey(sessionKey)
  return sessionKeyFor(parsed.agentId ?? agentId ?? null, parsed.local)
}

export function skillBaseKey(skillId: string): string {
  return `webchat:skill:${skillId}`
}

export function newSkillConvKey(skillId: string): string {
  return `${skillBaseKey(skillId)}:conv:${Date.now().toString(36)}`
}

export function isSkillSessionKey(key: string, skillId: string): boolean {
  const base = skillBaseKey(skillId)
  const local = normalizeSessionKey(key)
  return local === base || local.startsWith(`${base}:`)
}

/**
 * The skill a session belongs to, or `null` for main/channel threads.
 *
 * Both `webchat:skill:<id>` and `webchat:skill:<id>:conv:<n>` answer with the
 * same id — a follow-up conversation is still that skill's conversation.
 */
export function skillIdFromSessionKey(key: string): string | null {
  const match = /^webchat:skill:([^:]+)/.exec(normalizeSessionKey(key))
  return match?.[1] ?? null
}

export const MAIN_SESSION_KEY = 'webchat:main'

export function newMainConvKey(): string {
  return `${MAIN_SESSION_KEY}:conv:${Date.now().toString(36)}`
}

export function channelSessionKey(channelId: string): string {
  return `webchat:channel:${channelId}`
}

/** A bot's default conversation — the thread its roster row opens. */
export function botMainSessionKey(botId: string): string {
  return sessionKeyFor(botId, MAIN_SESSION_KEY)
}

/** The shared thread a group chat runs in, one session per participating bot. */
export function groupSessionKey(botId: string, groupId: string): string {
  return sessionKeyFor(botId, `webchat:group:${groupId}`)
}

/** The group a key belongs to, or `null` when it is not a group thread. */
export function groupIdFromSessionKey(key: string): string | null {
  const match = /^webchat:group:(.+)$/.exec(normalizeSessionKey(key))
  return match?.[1] ?? null
}
