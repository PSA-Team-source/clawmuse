import type { BotSummary } from '@shared/ipc'
import { BotAvatar } from '@/components/chat'

/**
 * `@`-addressing in a group.
 *
 * Names have spaces — "@Inbox Manager" — so a naive `@\w+` match would address
 * "Inbox" and leave "Manager" in the message body. Matching is therefore done
 * against the roster: the longest bot name that appears after an `@` wins, and
 * a partial word only completes through the autocomplete.
 */

/** The trailing `@fragment` the user is currently typing, if any. */
export function mentionQuery(text: string): string | null {
  const match = /@([\p{L}\p{N} _-]*)$/u.exec(text)
  return match ? (match[1] ?? '') : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The bots a message is addressed to.
 *
 * Empty means "the room" — that is the caller's decision to make, not this
 * function's, so it does not fall back to everyone.
 */
export function addressedBots(text: string, bots: BotSummary[]): BotSummary[] {
  // Longest name first, and each match is *consumed*. Testing alone is not
  // enough: with an "Account" and an "Account Manager" on the roster,
  // "@Account Manager" matches both — `\b` is happy to end at the space — and
  // the message goes to a bot it was not addressed to.
  const byLength = [...bots].sort((a, b) => b.name.length - a.name.length)
  const found = new Set<string>()
  let remaining = text
  for (const bot of byLength) {
    const pattern = new RegExp(`@${escapeRegExp(bot.name)}\\b`, 'i')
    if (!pattern.test(remaining)) continue
    found.add(bot.id)
    remaining = remaining.replace(new RegExp(`@${escapeRegExp(bot.name)}\\b`, 'gi'), ' ')
  }
  // Back into roster order, so the fan-out is deterministic.
  return bots.filter((bot) => found.has(bot.id))
}

/**
 * Removes the addressing from the body before it goes to the model.
 *
 * The bot already knows it was addressed — it received the message. Leaving
 * "@Talent Scout" in the text invites it to answer *about* the mention.
 */
export function stripMentions(text: string, bots: BotSummary[]): string {
  let out = text
  for (const bot of [...bots].sort((a, b) => b.name.length - a.name.length)) {
    out = out.replace(new RegExp(`@${escapeRegExp(bot.name)}\\b`, 'gi'), '')
  }
  return out.replace(/\s{2,}/g, ' ').trim()
}

/** The picker that appears while an `@` is being typed. */
export function MentionAutocomplete({
  text,
  bots,
  onPick,
}: {
  text: string
  bots: BotSummary[]
  onPick: (bot: BotSummary) => void
}) {
  const query = mentionQuery(text)
  if (query === null) return null

  const matches = bots.filter((bot) => bot.name.toLowerCase().startsWith(query.toLowerCase()))
  if (matches.length === 0) return null

  return (
    <div className="mb-2 flex flex-col gap-0.5 rounded-box border border-line bg-bg-card p-1">
      {matches.map((bot) => (
        <button
          key={bot.id}
          type="button"
          onClick={() => onPick(bot)}
          className="flex items-center gap-2 rounded-field px-2 py-1.5 text-left hover:bg-fill-raised"
        >
          <BotAvatar id={bot.id} name={bot.name} emoji={bot.emoji} avatar={bot.avatar} size={20} />
          <span className="text-body-sm text-content-primary">{bot.name}</span>
          <span className="truncate text-caption text-content-faint">{bot.job}</span>
        </button>
      ))}
    </div>
  )
}
