import { Airplane01Icon, Briefcase01Icon, Dumbbell01Icon, Mortarboard01Icon, PiggyBankIcon, Store01Icon } from '@hugeicons/core-free-icons'
import type { Goal } from '@/lib/goals'

/**
 * Starter packs: a one-click start for a new user — a common aim, written as
 * a few concrete goals the assistant can plan around (the Feed, Ideas and
 * check-ins all key off open goals). Each goal is specific enough to act on
 * and to tick off; the user edits or completes them in Goals like any other.
 */
export interface GoalPack {
  id: string
  label: string
  icon: unknown
  goals: readonly string[]
}

export const GOAL_PACKS: readonly GoalPack[] = [
  {
    id: 'online-store',
    label: 'Launch an online store',
    icon: Store01Icon,
    goals: [
      'Pick one product to sell and confirm people will pay for it',
      'Launch my online store with product photos, prices and a working checkout',
      'Get my first 10 paying customers',
    ],
  },
  {
    id: 'get-fit',
    label: 'Get fit',
    icon: Dumbbell01Icon,
    goals: [
      'Work out three times a week for the next 8 weeks',
      'Walk 8,000 steps a day',
      'Sleep at least 7 hours on weeknights',
    ],
  },
  {
    id: 'new-job',
    label: 'Find a new job',
    icon: Briefcase01Icon,
    goals: [
      'Update my résumé and LinkedIn profile for the role I want next',
      'Apply to 5 well-matched jobs every week',
      'Prepare for interviews with practice questions for my target role',
    ],
  },
  {
    id: 'learn-skill',
    label: 'Learn a skill',
    icon: Mortarboard01Icon,
    goals: [
      'Choose one skill to learn and set a clear 30-day milestone',
      'Practise it for 30 minutes, five days a week',
      "Finish a small project that shows what I've learned",
    ],
  },
  {
    id: 'save-money',
    label: 'Save money',
    icon: PiggyBankIcon,
    goals: [
      'Track every expense for 30 days to see where my money goes',
      'Cancel the subscriptions I no longer use',
      'Build an emergency fund that covers 3 months of expenses',
    ],
  },
  {
    id: 'plan-trip',
    label: 'Plan a trip',
    icon: Airplane01Icon,
    goals: [
      'Choose a destination and dates for my next trip',
      'Set a budget for the trip and save for it',
      'Book flights and a place to stay',
    ],
  },
]

const key = (title: string) => title.trim().toLowerCase()

/**
 * The goals a pack adds: its titles not already open in `existing` (so picking
 * a pack twice never duplicates a goal), each a new open goal.
 */
export function goalsFromPack(pack: GoalPack, existing: readonly Goal[], now = new Date()): Goal[] {
  const open = new Set(existing.filter((goal) => !goal.completed).map((goal) => key(goal.title)))
  const stamp = now.getTime().toString(36)
  return pack.goals
    .filter((title) => !open.has(key(title)))
    .map((title, index) => ({ id: `goal-pack-${pack.id}-${stamp}-${index}`, title, completed: false, createdAt: now.toISOString() }))
}
