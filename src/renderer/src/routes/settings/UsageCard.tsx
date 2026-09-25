import { useQuery } from '@tanstack/react-query'
import { SettingsGroup } from '@/components/settings'
import { gatewayWS } from '@/services/gateway-ws.service'

interface UsageWindow { label: string; usedPercent: number; resetAt?: number }
interface UsageStatus { providers?: { provider: string; displayName?: string; windows?: UsageWindow[]; error?: string }[] }
interface UsageCost { daily?: { date: string; totalTokens?: number; totalCost?: number }[] }

/** Totals for the most recent `days` entries of usage.cost's daily series. */
export function recentTotals(cost: UsageCost | undefined, days = 7): { tokens: number; cost: number } {
  const recent = [...(cost?.daily ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-days)
  return recent.reduce((sum, day) => ({ tokens: sum.tokens + (day.totalTokens ?? 0), cost: sum.cost + (day.totalCost ?? 0) }), { tokens: 0, cost: 0 })
}

/**
 * Muse's Usage card (plan, "% used", reset date, progress bar) on real local
 * data: provider quota windows where the provider reports them (usage.status),
 * and the last seven days of tokens and cost the agent recorded (usage.cost).
 */
export function UsageCard() {
  const status = useQuery({ queryKey: ['usage-status'], queryFn: () => gatewayWS.call<UsageStatus>('usage.status', {}), staleTime: 60_000 })
  const cost = useQuery({ queryKey: ['usage-cost'], queryFn: () => gatewayWS.call<UsageCost>('usage.cost', {}), staleTime: 60_000 })
  if (!cost.data && !status.data) return null
  const windows = (status.data?.providers ?? []).flatMap((provider) => (provider.windows ?? []).map((window) => ({ ...window, name: provider.displayName ?? provider.provider })))
  const totals = recentTotals(cost.data)
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: totals.cost < 1 ? 4 : 2 })
  return (
    <SettingsGroup title="Usage" className="mb-0">
      {windows.map((window) => (
        <div key={`${window.name}-${window.label}`} className="settings-row flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-body text-content-primary">{window.name} · {window.label}</p>
              {window.resetAt && <p className="text-caption text-content-secondary">Resets on {new Date(window.resetAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p>}
            </div>
            <span className="text-body text-content-secondary">{Math.round(window.usedPercent)}% used</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill-strong" role="progressbar" aria-valuenow={Math.round(window.usedPercent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${window.name} ${window.label} usage`}>
            <div className="h-full rounded-full bg-muse-blue" style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }} />
          </div>
        </div>
      ))}
      {cost.data && (
        <div className="settings-row flex items-center justify-between gap-3">
          <div>
            <p className="text-body text-content-primary">Last 7 days</p>
            <p className="text-caption text-content-secondary">Recorded by your local agent</p>
          </div>
          <span className="text-body text-content-secondary">{totals.tokens === 0 ? 'No usage' : `${totals.tokens.toLocaleString()} tokens · ${money.format(totals.cost)}`}</span>
        </div>
      )}
    </SettingsGroup>
  )
}
