import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BRAND_CORAL, brandBadgeSvg } from '@shared/brand'
import { CARD_BODY_CHARS, isAllowedCardImage, trimForCard, type ShareCardInput } from '@shared/share-card'

/**
 * The share card's page, built as a string for an offscreen window.
 *
 * Model text is rendered to static markup by react-markdown with `skipHtml`:
 * raw HTML in the reply is dropped, never parsed, and every text node is
 * escaped by React. Links become plain text (a PNG has nothing to click) and
 * markdown images are dropped (the card has one picture, validated by main).
 * The page carries no script, and its CSP forbids any and every fetch.
 */

export const CARD_WIDTH = 600

const KIND_LABEL: Record<ShareCardInput['kind'], string> = { feed: 'From my Feed', idea: 'Idea', answer: 'Answer', recap: 'My week' }

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

function markdownHtml(markdown: string): string {
  return renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [remarkGfm],
    skipHtml: true,
    urlTransform: () => '',
    components: {
      img: () => null,
      a: ({ children }: { children?: ReactNode }) => createElement('span', { className: 'link' }, children),
      input: () => null,
    },
  }, markdown))
}

/** The card's picture is drawn only from an inline `data:` image (main fetches and inlines it); anything else draws none. */
export function shareCardHtml(input: ShareCardInput): string {
  const card = { ...input, image: input.image?.startsWith('data:') && isAllowedCardImage(input.image) ? input.image : undefined }
  const body = card.body ? trimForCard(card.body, card.image ? CARD_BODY_CHARS.withImage : CARD_BODY_CHARS.withoutImage) : ''
  const title = card.title ? escapeHtml(card.title.length > 140 ? `${card.title.slice(0, 139).trimEnd()}…` : card.title) : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${BRAND_CORAL}}
body{width:${CARD_WIDTH}px;font:400 17px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;color:#1d1d1f;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
#card{padding:28px 28px 20px;background:radial-gradient(120% 80% at 0% 0%,#ff8a6b 0%,rgba(255,138,107,0) 60%),linear-gradient(160deg,#ff6a55 0%,${BRAND_CORAL} 50%,#e8433a 100%)}
.sheet{background:#fff;border-radius:24px;padding:26px 28px 28px;box-shadow:0 18px 40px rgba(120,20,10,.22),0 2px 6px rgba(120,20,10,.12)}
.head{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.head svg{flex:none;display:block}
.brand{font-weight:700;font-size:16px;letter-spacing:-.01em}
.kind{margin-left:auto;padding:4px 11px;border-radius:999px;background:#fff0ee;color:#d93a2f;font-size:12.5px;font-weight:600;letter-spacing:.01em}
.hero{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;margin:0 0 18px}
.emoji{font-size:40px;line-height:1;margin:0 0 12px}
h1{margin:0 0 10px;font-size:25px;line-height:1.25;font-weight:700;letter-spacing:-.02em;overflow-wrap:anywhere}
.body{overflow-wrap:anywhere;color:#2c2c2e}
.body>:first-child{margin-top:0}.body>:last-child{margin-bottom:0}
.body p{margin:0 0 10px}
.body h1,.body h2,.body h3,.body h4,.body h5,.body h6{font-size:18px;line-height:1.35;margin:14px 0 6px;font-weight:650}
.body ul,.body ol{margin:0 0 10px;padding-left:22px}.body li{margin:2px 0}
.body li::marker{color:${BRAND_CORAL}}
.body strong{font-weight:650;color:#1d1d1f}
.body .link{color:#d93a2f;font-weight:500}
.body blockquote{margin:0 0 10px;padding:2px 0 2px 14px;border-left:3px solid #ffd2cc;color:#48484a}
.body code{font:500 14.5px/1.5 "SF Mono",ui-monospace,Menlo,Consolas,monospace;background:#f4f4f5;border-radius:6px;padding:1px 5px}
.body pre{margin:0 0 10px;padding:12px 14px;background:#f4f4f5;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.body pre code{background:none;padding:0}
.body table{border-collapse:collapse;margin:0 0 10px;font-size:15px}.body th,.body td{border:1px solid #e5e5ea;padding:4px 8px;text-align:left}
.body hr{border:0;border-top:1px solid #e5e5ea;margin:14px 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:4px 0 18px}
.stat{background:#fff5f3;border-radius:14px;padding:12px 12px 10px}
.stat b{display:block;font-size:28px;line-height:1.1;font-weight:750;letter-spacing:-.02em;color:#d93a2f;font-variant-numeric:tabular-nums}
.stat span{display:block;margin-top:2px;font-size:13px;line-height:1.3;color:#48484a}
.source{margin-top:16px;color:#8e8e93;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.foot{margin-top:16px;text-align:center;color:rgba(255,255,255,.88);font-size:13px;font-weight:500;letter-spacing:.01em}
.foot b{font-weight:700;color:#fff}
</style></head><body><div id="card"><div class="sheet">
<div class="head">${brandBadgeSvg(30)}<span class="brand">ClawMuse</span><span class="kind">${KIND_LABEL[card.kind]}</span></div>
${card.image ? `<img class="hero" src="${escapeHtml(card.image)}" alt="">` : ''}
${card.emoji ? `<div class="emoji">${escapeHtml(card.emoji)}</div>` : ''}
${title ? `<h1>${title}</h1>` : ''}
${card.stats?.length ? `<div class="stats">${card.stats.map((stat) => `<div class="stat"><b>${escapeHtml(stat.value.toLocaleString('en-US'))}</b><span>${escapeHtml(stat.label)}</span></div>`).join('')}</div>` : ''}
${body ? `<div class="body">${markdownHtml(body)}</div>` : ''}
${card.source ? `<div class="source">${escapeHtml(card.source)}</div>` : ''}
</div><div class="foot">Made with <b>ClawMuse</b> · clawmuse.app</div></div></body></html>`
}
