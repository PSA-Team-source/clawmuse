/**
 * Display formatting helpers shared by every screen in this route group.
 * Uses `Intl` throughout instead of hand-rolled math so pluralisation and
 * locale rules (currently `en`) stay correct without a bundled i18n lib.
 */

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** Largest-first so a 400-day-old item reports in years, not 400 "days ago". */
const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
]

/** "2 minutes ago" / "in 3 hours". Falls back to seconds under a minute. Empty string for an unparsable date. */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const diffMs = date.getTime() - Date.now()
  if (Number.isNaN(diffMs)) return ''

  const absMs = Math.abs(diffMs)
  for (const { unit, ms } of RELATIVE_UNITS) {
    if (absMs >= ms) return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / ms), unit)
  }
  return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / 1000), 'second')
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** "Jul 20, 2026, 3:45 PM". Returns an em dash for an unparsable date so callers never render "Invalid Date". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return DATE_TIME_FORMATTER.format(date)
}

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** "1.2k", "3.4M" — for counters where full precision would just add noise. */
export function formatNumber(value: number): string {
  return COMPACT_NUMBER_FORMATTER.format(value)
}

// One formatter per currency code, built lazily — callers only ever pass a
// handful of distinct currencies (USD/EUR/…), so caching avoids reconstructing
// an Intl formatter on every render without pre-building ones nobody needs.
const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>()

function currencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = CURRENCY_FORMATTERS.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en', { style: 'currency', currency })
    CURRENCY_FORMATTERS.set(currency, formatter)
  }
  return formatter
}

/** "$1,234.50" — falls back to a plain "123.45 XYZ" if `currency` isn't a valid ISO 4217 code. */
export function formatCurrency(value: number, currency = 'USD'): string {
  try {
    return currencyFormatter(currency).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

/** Truncates to `maxLength` (ellipsis included) without cutting mid-surrogate-pair for typical text. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return '…'
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

/**
 * File size in the units a file browser shows.
 *
 * Base 1024 with decimal-ish labels — the convention macOS Finder and every
 * code editor use, so the numbers match what the user sees elsewhere.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
