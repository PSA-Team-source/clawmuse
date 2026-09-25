/**
 * The one-time "star ClawMuse on GitHub" note.
 *
 * It appears once, right after the user Loves a Feed story: the moment the app
 * has been useful by the user's own account, not a timer or a launch count.
 * It is recorded as shown the moment it appears, so it never comes back —
 * whether the user stars, dismisses, or simply scrolls past it.
 */

export const STAR_PROMPT_KEY = 'clawmuse.starPrompt.v1'
export const REPOSITORY_URL = 'https://github.com/PSA-Team-source/clawmuse'

export type StarPromptOutcome = 'shown' | 'starred' | 'dismissed'

/** Whether the note may still be offered: never shown before. */
export function canOfferStar(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(STAR_PROMPT_KEY) === null
  } catch {
    // Storage unreadable: staying quiet is the safe way to be wrong.
    return false
  }
}

export function recordStarPrompt(outcome: StarPromptOutcome, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STAR_PROMPT_KEY, JSON.stringify({ outcome, at: new Date().toISOString() }))
  } catch {
    /* Not persisted: the component still hides it for this session. */
  }
}
