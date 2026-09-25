/** Where the Goals screen keeps the user's goals (chat confirms new ones into it). */
export const GOALS_KEY = 'clawmuse.goals.v1'

export interface Goal {
  id: string
  title: string
  completed: boolean
  createdAt: string
}

export function readGoals(): Goal[] {
  try {
    const value = JSON.parse(localStorage.getItem(GOALS_KEY) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter((goal): goal is Goal => Boolean(goal && typeof goal === 'object' && 'id' in goal && 'title' in goal))
  } catch {
    return []
  }
}

/** Set once the user has answered (or skipped) the first-run goals question. */
export const WELCOMED_KEY = 'clawmuse.welcomed.v1'

/** A new user — never asked, no goals yet — is asked what they are working toward before the first chat. */
export function needsWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === null && readGoals().length === 0
  } catch {
    return false
  }
}
