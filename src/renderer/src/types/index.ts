/**
 * Domain models + Zod schemas.
 *
 * Ported from the mobile app's `src/types/*.ts`, with one deliberate upgrade:
 * mobile type-casts every response (`client.get<T>`) and validates nothing at
 * runtime, which its own AGENTS.md flags as a gap. Here every REST response and
 * every gateway event is parsed by a schema at the boundary, so a backend shape
 * change surfaces as one clear error instead of an `undefined` three layers in.
 *
 * Schemas are permissive where the backend genuinely varies (`.passthrough()`,
 * optional fields, `.catch()` on enums) and strict where correctness matters.
 */
import { z } from 'zod'

/**
 * A list that survives one bad row.
 *
 * `z.array(item).catch([])` reads as defensive and behaves as the opposite: if a
 * single row drifts from the schema the whole array is replaced with `[]`, and
 * the screen renders its empty state over data that arrived perfectly fine. That
 * shipped — every scheduled task vanished because the gateway sends
 * `description: null` and the field was declared `.optional()`, which accepts
 * only `undefined`.
 *
 * Parsing row by row keeps the damage proportional: the row that drifted is
 * dropped, the rest render.
 */
export function tolerantArray<T extends z.ZodType>(item: T, label: string) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((rows) =>
      rows.flatMap((row) => {
        const parsed = item.safeParse(row)
        if (!parsed.success && import.meta.env.DEV) {
          console.warn(`[${label}] dropped a malformed row`, parsed.error.issues)
        }
        return parsed.success ? [parsed.data as z.infer<T>] : []
      }),
    )
}

// ── Gateway / WebSocket ─────────────────────────────────────────────────────

export type ConnectionState =
  | 'idle'
  | 'booting'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export interface GatewayRequestFrame {
  type: 'req'
  id: string
  method: string
  params?: unknown
}

export const gatewayResponseFrameSchema = z.object({
  type: z.literal('res'),
  id: z.string(),
  ok: z.boolean().optional(),
  payload: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.union([z.string(), z.number()]).optional(),
      message: z.string(),
      // Kept rather than stripped: the gateway puts the machine-readable reason
      // for a refused handshake in here (`details.code === 'PAIRING_REQUIRED'`,
      // plus the pending `requestId`). Matching on the prose message instead
      // means the app breaks the day upstream rewords it.
      details: z
        .object({ code: z.string().optional(), requestId: z.string().optional() })
        .loose()
        .optional(),
    })
    .optional(),
})

export const gatewayEventFrameSchema = z
  .object({
    type: z.literal('event'),
    event: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()

export const gatewayFrameSchema = z.union([gatewayResponseFrameSchema, gatewayEventFrameSchema])

export type GatewayResponseFrame = z.infer<typeof gatewayResponseFrameSchema>
export type GatewayEventFrame = z.infer<typeof gatewayEventFrameSchema>
export type GatewayFrame = GatewayRequestFrame | GatewayResponseFrame | GatewayEventFrame

export type ChatStreamState = 'delta' | 'final' | 'error' | 'aborted'

export const chatEventPayloadSchema = z
  .object({
    state: z.enum(['delta', 'final', 'error', 'aborted']),
    sessionKey: z.string(),
    /** Present on `state: 'error'` — why the turn failed, in the gateway's words. */
    error: z.string().optional(),
    /** What the gateway actually sends on `state: "error"` (chat-send-handler broadcastChatTerminal). */
    errorMessage: z.string().optional(),
    // Which bot is speaking. The gateway sends it alongside the key rather than
    // always inside it, so a multi-bot client has to read both — see
    // `eventSessionKey` in `services/session-key.ts`.
    agentId: z.string().optional(),
    text: z.string().optional(),
    // Reasoning arrives one of two ways depending on which schema the gateway
    // is using: a top-level string, or `{type:'thinking'}` blocks in content.
    thinking: z.string().optional(),
    message: z
      .object({
        role: z.string().optional(),
        content: z
          .array(
            z
              .object({
                type: z.string(),
                text: z.string().optional(),
                thinking: z.string().optional(),
              })
              .loose(),
          )
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose()

export type ChatEventPayload = z.infer<typeof chatEventPayloadSchema>

export const agentEventPayloadSchema = z
  .object({
    type: z.enum(['tool_call', 'tool_result']),
    sessionKey: z.string().optional(),
    agentId: z.string().optional(),
    tool: z.string().optional(),
    status: z.string().optional(),
    id: z.string().optional(),
    args: z.unknown().optional(),
    result: z.unknown().optional(),
    isError: z.boolean().optional(),
  })
  .loose()

export type AgentEventPayload = z.infer<typeof agentEventPayloadSchema>

export const execApprovalPayloadSchema = z
  .object({
    id: z.string(),
    tool: z.string(),
    args: z.unknown().optional(),
    sessionKey: z.string().optional(),
    /** Which bot is asking — the roster badges the row it belongs to. */
    agentId: z.string().optional(),
  })
  .loose()

export type ExecApprovalPayload = z.infer<typeof execApprovalPayloadSchema>

// ── Chat ────────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'tool'
export type MessageStatus = 'sending' | 'sent' | 'failed' | 'streaming'
export type AttachmentType = 'image' | 'file' | 'audio'
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

export interface Attachment {
  id: string
  type: AttachmentType
  /** Object URL for preview. The raw bytes live in `data` for sending. */
  uri: string
  name?: string
  size?: number
  mimeType?: string
  /** base64 payload — the gateway rejects file paths/URLs. */
  data?: string
}

export interface ToolCall {
  id: string
  tool: string
  input: unknown
  result?: unknown
  isError?: boolean
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface Message {
  id: string
  session_id: string
  role: MessageRole
  content: string
  /** Model reasoning that preceded this answer, when the gateway sent any. */
  thinking?: string
  status: MessageStatus
  tool_calls?: ToolCall[]
  attachments?: Attachment[]
  created_at: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read?: number
    cache_write?: number
  }
}

export interface Session {
  id: string
  name: string
  channel_id?: string
  channel_type?: string
  last_message?: string
  last_message_at?: string
  /** The runtime's last turn in this session ended in error (so last_message is a failure notice). */
  last_run_failed?: boolean
  unread_count?: number
  /** The gateway's own read state (`sessions.list` → `unread`), cleared with `sessions.patch {unread:false}`. */
  unread?: boolean
  pinned?: boolean
  /** Archived sessions are listed only by `sessions.list {archived:true}`. */
  archived?: boolean
  /** The gateway's transcript id for this key (`sessionId`); archiving must name it as `expectedSessionId`. */
  gateway_session_id?: string
  model?: string
  model_override_source?: 'auto' | 'user' | 'default'
  thinking_level?: ThinkingLevel
  verbose?: boolean
}

export interface SessionPatch {
  /** Sent to the gateway as `label` — `sessions.patch` has no `name` field. */
  name?: string
  pinned?: boolean
  archived?: boolean
  /** `false` records the session as read; `true` marks it unread. */
  unread?: boolean
  /** Required with `archived`: the gateway refuses a lifecycle change aimed at a session that was reset or replaced since. */
  expectedSessionId?: string
  model?: string
  thinkingLevel?: ThinkingLevel
  verbose?: boolean
  usageFooter?: string
}

export interface QueuedMessage {
  sessionId: string
  text: string
  attachments?: Attachment[]
  timestamp: number
}

// ── User / subscription ─────────────────────────────────────────────────────

export const userSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    email: z.string(),
    name: z.string().optional(),
    subscription_status: z
      .enum(['active', 'inactive', 'trialing', 'canceled'])
      .catch('inactive'),
    subscription_plan: z.string().optional(),
    created_at: z.string().optional(),
    stripe_customer_id: z.string().optional(),
  })
  .loose()

export type User = z.infer<typeof userSchema>
export type SubscriptionTier = 'pro' | 'max'

/**
 * `user` and `token` are the back-compat fields; the canonical pair lives under
 * `data`. The refresh token is read from there — without it a desktop session
 * simply dies when the access token expires, dropping the user at the login
 * screen mid-task.
 */
export const authResponseSchema = z
  .object({
    user: userSchema,
    token: z.string(),
    data: z
      .object({
        access_token: z.string().optional(),
        refresh_token: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose()

export const refreshResponseSchema = z
  .object({
    data: z
      .object({
        access_token: z.string(),
        refresh_token: z.string().optional(),
      })
      .loose(),
  })
  .loose()

export const meResponseSchema = z.object({ user: userSchema }).loose()

export const usageInfoSchema = z
  .object({
    tier: z.enum(['pro', 'max']).catch('pro'),
    used: z.number().catch(0),
    limit: z.number().catch(0),
    remaining: z.number().catch(0),
    percent: z.number().catch(0),
    resetsAt: z.string().nullable().catch(null),
    capped: z.boolean().catch(false),
  })
  .loose()

export type UsageInfo = z.infer<typeof usageInfoSchema>

// ── Sandbox ─────────────────────────────────────────────────────────────────

export const sandboxSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    port: z.number(),
    gateway_token: z.string().optional(),
    status: z.enum(['starting', 'running', 'stopped', 'error']).catch('starting'),
    user_id: z.union([z.string(), z.number()]).transform(String).optional(),
    created_at: z.string().optional(),
  })
  .loose()

export type Sandbox = z.infer<typeof sandboxSchema>

export const sandboxHealthSchema = z.object({ ok: z.boolean().optional(), ready: z.boolean().optional() }).loose()
export type SandboxHealth = z.infer<typeof sandboxHealthSchema>

// ── Channels ────────────────────────────────────────────────────────────────

export type ChannelType =
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'instagram'
  | 'linkedin'
  | 'signal'
  | 'imessage'

export type ChannelStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

export interface Channel {
  id: string
  type: ChannelType
  name: string
  description: string
  status: ChannelStatus
  metadata?: { phone?: string; username?: string; bot_name?: string }
  config?: Record<string, unknown>
}

export const whatsAppStatusSchema = z
  .object({ connected: z.boolean().catch(false), phone: z.string().optional(), name: z.string().optional() })
  .loose()

export type WhatsAppStatus = z.infer<typeof whatsAppStatusSchema>

// ── Skills ──────────────────────────────────────────────────────────────────

export interface Skill {
  skillKey: string
  name: string
  description: string
  emoji: string
  homepage?: string
  enabled: boolean
  eligible: boolean
  bundled: boolean
  source?: string
  missingBins: string[]
}

// ── Scheduled tasks ─────────────────────────────────────────────────────────

export const cronScheduleSchema = z
  .object({
    kind: z.enum(['cron', 'every', 'at']).optional(),
    expr: z.string().optional(),
    everyMs: z.number().optional(),
    at: z.string().optional(),
    tz: z.string().optional(),
  })
  .loose()

export type CronSchedule = z.infer<typeof cronScheduleSchema>

export const scheduledTaskSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    cron_job_id: z.string(),
    name: z.string().catch('Untitled task'),
    /** The gateway's friendly label for jobs it declares itself ("Heartbeat (main)"). */
    display_name: z.string().nullish(),
    // `nullish`, not `optional`: the gateway sends explicit nulls for columns it
    // has no value for. `.optional()` accepts undefined only, so a null here
    // failed the whole task — and with it the whole list.
    description: z.string().nullish(),
    enabled: z.boolean().catch(true),
    schedule: cronScheduleSchema.catch({}),
    payload: z.record(z.string(), z.unknown()).catch({}),
    skill_id: z.string().nullish(),
    session_target: z.string().nullish(),
    next_run_at: z.string().nullish(),
    last_run_at: z.string().nullish(),
    last_status: z.string().nullish(),
    /** Why the last run failed. Without it "failed" is a dead end for the user. */
    last_error: z.string().nullish(),
    created_at: z.string().nullish(),
  })
  .loose()

export type ScheduledTask = z.infer<typeof scheduledTaskSchema>

export const tasksResponseSchema = z
  .object({ tasks: tolerantArray(scheduledTaskSchema, 'tasks') })
  .loose()

// ── Facebook Ads ────────────────────────────────────────────────────────────

export const adAccountSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    account_id: z.string().optional(),
    currency: z.string().optional(),
    account_status: z.number().optional(),
  })
  .loose()

export type AdAccount = z.infer<typeof adAccountSchema>

export const facebookStatusSchema = z
  .object({
    connected: z.boolean().catch(false),
    tokenExpired: z.boolean().optional(),
    profile: z.object({ id: z.string().optional(), name: z.string().optional() }).loose().nullish(),
    adAccount: adAccountSchema.nullish(),
    page: z.object({ id: z.string().optional(), name: z.string().optional() }).loose().nullish(),
  })
  .loose()

export type FacebookStatus = z.infer<typeof facebookStatusSchema>

export type AdStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED'

export const campaignSchema = z
  .object({
    id: z.string(),
    name: z.string().catch('Untitled campaign'),
    status: z.string().catch('PAUSED'),
    objective: z.string().optional(),
    daily_budget: z.string().optional(),
    lifetime_budget: z.string().optional(),
    created_time: z.string().optional(),
    start_time: z.string().optional(),
  })
  .loose()

export type Campaign = z.infer<typeof campaignSchema>

/**
 * An ad set holds the money and the targeting; the ad above it holds only the
 * creative. Budget arrives from Graph as a string of **cents**.
 */
export const adSetSchema = z
  .object({
    id: z.string(),
    name: z.string().catch('Untitled ad set'),
    status: z.string().catch('PAUSED'),
    campaign_id: z.string().optional(),
    daily_budget: z.string().optional(),
    lifetime_budget: z.string().optional(),
    optimization_goal: z.string().optional(),
    billing_event: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
  })
  .loose()

export type AdSet = z.infer<typeof adSetSchema>

/**
 * One brand in the BrandSphere feed.
 *
 * Every field except `id` and `brand` is nullable on the wire: the feed is
 * assembled from a scraped store table where growth, traffic and creatives are
 * frequently missing, and one absent column must not drop the whole row.
 */
export const brandPostSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    brand: z.string().catch('Unknown store'),
    emoji: z.string().nullish(),
    logo: z.string().nullish(),
    category: z.string().nullish(),
    rank: z.string().nullish(),
    revenue: z.string().nullish(),
    visitors: z.string().nullish(),
    growth: z.string().nullish(),
    description: z.string().nullish(),
    images: z.array(z.string()).catch([]),
    likes: z.number().nullish(),
    comments: z.number().nullish(),
  })
  .loose()

export type BrandPost = z.infer<typeof brandPostSchema>

export const brandFeedResponseSchema = z
  .object({
    success: z.boolean().optional(),
    data: tolerantArray(brandPostSchema, 'brandsphere'),
  })
  .loose()

export const facebookPageSchema = z
  .object({ id: z.string(), name: z.string().catch('Untitled page') })
  .loose()

export type FacebookPage = z.infer<typeof facebookPageSchema>

export const adPixelSchema = z
  .object({ id: z.string(), name: z.string().catch('Untitled pixel') })
  .loose()

export type AdPixel = z.infer<typeof adPixelSchema>

/** The three creative shapes Meta accepts; each one builds a different story spec. */
export type AdFormat = 'single_image' | 'single_video' | 'carousel'

/** Graph API returns every metric as a string; parsing to number is the caller's job. */
export const adInsightSchema = z
  .object({
    impressions: z.string().optional(),
    clicks: z.string().optional(),
    spend: z.string().optional(),
    cpc: z.string().optional(),
    cpm: z.string().optional(),
    ctr: z.string().optional(),
    reach: z.string().optional(),
    date_start: z.string().optional(),
    date_stop: z.string().optional(),
  })
  .loose()

export type AdInsight = z.infer<typeof adInsightSchema>

export type DatePreset = 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d'

// ── Store Builder ───────────────────────────────────────────────────────────

export const storeStatusSchema = z
  .object({
    ok: z.boolean().optional(),
    storeId: z.union([z.string(), z.number()]).transform(String).optional(),
    storeName: z.string().optional(),
    merchantId: z.union([z.string(), z.number()]).transform(String).optional(),
    error: z.string().optional(),
  })
  .loose()

export type StoreStatus = z.infer<typeof storeStatusSchema>

export const storeThemeSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().catch('Untitled theme'),
    status: z.string().optional(),
    preview_url: z.string().nullish(),
    production_url: z.string().nullish(),
    updated_at: z.string().optional(),
    created_at: z.string().optional(),
  })
  .loose()

export type StoreTheme = z.infer<typeof storeThemeSchema>

export const themesResponseSchema = z
  .object({ ok: z.boolean().optional(), themes: z.array(storeThemeSchema).optional(), error: z.string().optional() })
  .loose()

// ── Agent Studio (admin) ────────────────────────────────────────────────────

/**
 * Mirrors the `shared_skills` table. There is no `category` column — an earlier
 * version of this schema declared one, which `.loose()` quietly tolerated while
 * the field could never be read or written.
 *
 * Every nullable column uses `.nullish()`: the server sends explicit nulls, and
 * `.optional()` accepts only `undefined`, which would fail the whole row.
 */
export const adminSkillSchema = z
  .object({
    slug: z.string(),
    name: z.string().nullish(),
    description: z.string().nullish(),
    emoji: z.string().nullish(),
    use_case: z.string().nullish(),
    color: z.string().nullish(),
    user_types: z.array(z.string()).nullish(),
    priority: z.number().nullish(),
    modes: z.array(z.string()).nullish(),
    version: z.number().nullish(),
    enabled: z.boolean().optional(),
    skill_md: z.string().nullish(),
  })
  .loose()

export type AdminSkill = z.infer<typeof adminSkillSchema>

export const whoAmISchema = z.object({ admin: z.boolean().catch(false), email: z.string().optional() }).loose()
export type WhoAmI = z.infer<typeof whoAmISchema>

// ── 3D Room ─────────────────────────────────────────────────────────────────

export interface RoomCharacterConfig {
  skillId: string
  skillName: string
  description: string
  appearanceSeed: number
  emoji?: string
}

export interface RoomData {
  id: string
  name: string
  characterConfigs: RoomCharacterConfig[]
}

/** What the store hands to the renderer. */
export interface GameCharacter {
  id: number
  skillId: string
  name: string
  description: string
  color: string
  bodyStyle: string
  appearanceSeed: number
  emoji?: string
  taskCount: number
}
