import { describe, expect, it } from 'vitest'
import { parseRss } from '../../../main/services/news'

describe('parseRss (Google News)', () => {
  it('reads title, link, source and date, trimming the " - Source" suffix and entities', () => {
    const xml = `<rss><channel><item><title>Stripe &amp; Shopify expand payments - Reuters</title><link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Wed, 23 Sep 2026 14:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item><item><title>No link</title></item></channel></rss>`
    expect(parseRss(xml)).toEqual([{ title: 'Stripe & Shopify expand payments', url: 'https://news.google.com/rss/articles/abc?oc=5', source: 'Reuters', publishedAt: '2026-09-23T14:00:00.000Z' }])
  })
  it('reads Bing: the publisher link out of the click tracker, the snippet and a 16:9 hero no wider than the original', () => {
    const xml = `<rss><channel><item><title>Shopify taps Muse</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.wsj.com%2farticles%2fx&amp;mkt=en-ww</link><description>Shopify plans to allow Meta&#8217;s agent to buy.</description><pubDate>Mon, 21 Sep 2026 15:30:00 GMT</pubDate><News:Source>The Wall Street Journal</News:Source><News:Image>http://www.bing.com/th?id=ONUT.abc&amp;pid=News</News:Image><News:ImageMaxWidth>700</News:ImageMaxWidth></item><item><title>Tiny picture</title><link>https://example.com/t</link><News:Image>http://www.bing.com/th?id=ONUT.t&amp;pid=News</News:Image><News:ImageMaxWidth>200</News:ImageMaxWidth></item></channel></rss>`
    const [first, second] = parseRss(xml)
    expect(first).toEqual({ title: 'Shopify taps Muse', url: 'https://www.wsj.com/articles/x', source: 'The Wall Street Journal', publishedAt: '2026-09-21T15:30:00.000Z', summary: 'Shopify plans to allow Meta’s agent to buy.', image: 'https://www.bing.com/th?id=ONUT.abc&pid=News&w=700&h=394&c=7' })
    expect(second!.image).toBeUndefined()
  })
})
