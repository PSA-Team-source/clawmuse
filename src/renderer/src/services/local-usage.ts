import { z } from 'zod'
import { gatewayWS } from '@/services/gateway-ws.service'
import { tolerantArray } from '@/types'

/**
 * Token usage in local mode.
 *
 * There is no plan and no quota here — the user pays their own provider, or
 * pays nothing at all when the model runs on this machine. So the meaningful
 * numbers are tokens spent and (when a cloud provider is in play) what it cost,
 * not "83% of your allowance". `usage.cost` reads the gateway's own session
 * logs, so it counts everything the agent did, including scheduled runs the app
 * was not open for.
 */

const dailySchema = z
  .object({
    date: z.string(),
    input: z.number().catch(0),
    output: z.number().catch(0),
    totalTokens: z.number().catch(0),
    totalCost: z.number().catch(0),
  })
  .loose()

const usageCostSchema = z.object({ daily: tolerantArray(dailySchema, 'usage.daily') }).loose()

export interface LocalUsage {
  todayTokens: number
  periodTokens: number
  /** In USD. Stays 0 for a fully local model, which is the point. */
  periodCost: number
  days: number
}

export async function readLocalUsage(days = 30): Promise<LocalUsage> {
  const parsed = usageCostSchema.safeParse(await gatewayWS.usageCost(days))
  if (!parsed.success) return { todayTokens: 0, periodTokens: 0, periodCost: 0, days }

  const rows = parsed.data.daily
  // The gateway keys rows by local calendar date, so compare against the local
  // date rather than a UTC slice — otherwise "today" is wrong for most of the
  // day in any timezone east of UTC.
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`

  return {
    todayTokens: rows.find((row) => row.date === todayKey)?.totalTokens ?? 0,
    periodTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
    periodCost: rows.reduce((sum, row) => sum + row.totalCost, 0),
    days,
  }
}

/** Compact human form: 1_234 → "1.2k". */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}
