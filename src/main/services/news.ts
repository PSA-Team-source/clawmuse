/**
 * Headlines for the Feed, fetched by the app rather than by the agent.
 *
 * Muse's feed is researched server-side; the agent's own web tools here are
 * either bot-blocked (DuckDuckGo) or need a paid key (Firecrawl). Public news
 * RSS search needs neither, and fetching it in the app keeps the edition to
 * two quick model calls instead of a long tool-driven run.
 *
 * Bing News RSS comes first: it carries the publisher's own link, a snippet
 * and the article thumbnail (the Feed's pictures, as in Muse). Google News is
 * the fallback — no pictures, and links that are Google redirects.
 */

import type { NewsItem } from '@shared/assistant'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (match, code: string) => {
      if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16))
      if (code.startsWith('#')) return ENTITIES[code] ?? String.fromCodePoint(Number(code.slice(1)))
      return ENTITIES[code] ?? match
    })
    .trim()
}

/** Bing wraps every link in a click tracker; the publisher URL is its `url` parameter. */
function unwrapLink(link: string): string {
  try {
    const parsed = new URL(link)
    if (parsed.hostname.endsWith('bing.com') && parsed.pathname.includes('apiclick')) {
      const target = parsed.searchParams.get('url')
      if (target && /^https?:\/\//i.test(target)) return target
    }
  } catch { /* not a URL: kept as is and rejected below */ }
  return link
}

/**
 * Bing's thumbnail, smart-cropped (`c=7`) to 16:9 at no more than its native
 * width — asking for more pads it with white bars. Too small for a hero means
 * no picture at all.
 */
function heroImage(raw: string | undefined, maxWidth: string | undefined): string | undefined {
  if (!raw) return undefined
  const native = Number(maxWidth)
  const width = Math.min(Number.isFinite(native) && native > 0 ? native : 0, 1280)
  if (width < 480) return undefined
  try {
    const url = new URL(decode(raw))
    if (!url.hostname.endsWith('bing.com')) return undefined
    url.protocol = 'https:'
    url.searchParams.set('w', String(width))
    url.searchParams.set('h', String(Math.round((width * 9) / 16)))
    url.searchParams.set('c', '7')
    return url.toString()
  } catch {
    return undefined
  }
}

/** Parses an RSS 2.0 document's items (title, link, pubDate, source, snippet, thumbnail). */
export function parseRss(xml: string): NewsItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const field = (name: string) => item!.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]
    const title = field('title')
    const link = field('link')
    const url = link ? unwrapLink(decode(link)) : ''
    if (!title || !/^https?:\/\//.test(url)) return []
    const date = field('pubDate')
    const parsed = date ? new Date(decode(date)) : null
    const source = field('source') ?? field('News:Source')
    // Google News titles end with " - Source"; the source has its own field.
    const clean = decode(title)
    const name = source ? decode(source) : undefined
    // Google's description is an HTML link list, not a snippet — only plain text counts.
    const description = field('description')
    const image = heroImage(field('News:Image'), field('News:ImageMaxWidth'))
    const summary = description ? decode(description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
    return [{
      title: name && clean.endsWith(` - ${name}`) ? clean.slice(0, -(name.length + 3)) : clean,
      url,
      source: name,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : undefined,
      ...(summary && !description!.includes('&lt;a ') && !description!.includes('<a ') ? { summary: summary.slice(0, 600) } : {}),
      ...(image ? { image } : {}),
    }]
  })
}

async function fetchFeed(url: string): Promise<NewsItem[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ClawMuse' } })
  if (!response.ok) throw new Error(`News search failed (HTTP ${response.status})`)
  return parseRss(await response.text())
}

/** Recent headlines for one query, newest first, at most `limit`. */
export async function searchNews(query: unknown, limit = 6): Promise<NewsItem[]> {
  if (typeof query !== 'string' || !query.trim() || query.length > 200) return []
  const q = encodeURIComponent(query.trim())
  let items: NewsItem[] = []
  try {
    // `setlang`/`cc` pin English results; otherwise Bing answers in the Mac's locale.
    items = await fetchFeed(`https://www.bing.com/news/search?q=${q}&format=rss&setlang=en-US&cc=US&qft=interval%3d%228%22`)
  } catch {
    // Fall through to Google News.
  }
  if (items.length === 0) items = await fetchFeed(`https://news.google.com/rss/search?q=${encodeURIComponent(`${query.trim()} when:14d`)}&hl=en-US&gl=US&ceid=US:en`)
  return items
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, Math.max(1, Math.min(limit, 10)))
}
