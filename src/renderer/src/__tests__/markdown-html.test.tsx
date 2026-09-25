import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { MarkdownMessage } from '@/components/chat/MarkdownMessage'
import { StreamingText } from '@/components/chat/StreamingText'

/**
 * Replies are markdown *and* occasionally raw HTML — agents emit `<br>`,
 * `<details>`, small tables. Rendering that HTML is a product requirement; it
 * also hands a model direct reach into the DOM, so the sanitiser is the only
 * thing standing between a generated string and script execution inside the
 * app shell.
 *
 * These tests pin both halves: the useful HTML survives, everything executable
 * does not.
 */

beforeAll(() => {
  // MarkdownMessage routes links through the OS browser via the preload bridge.
  Object.defineProperty(window, 'clawmuse', {
    value: { shell: { openExternal: vi.fn() } },
    writable: true,
  })
})

describe('MarkdownMessage — raw HTML', () => {
  it('renders benign inline HTML instead of printing it literally', () => {
    const { container } = render(<MarkdownMessage content={'a<br />b'} />)
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.textContent).not.toContain('<br')
  })

  it('renders <details>/<summary> as real elements', () => {
    const { container } = render(
      <MarkdownMessage content={'<details><summary>more</summary>hidden</details>'} />,
    )
    expect(container.querySelector('details')).not.toBeNull()
    expect(container.querySelector('summary')?.textContent).toBe('more')
  })

  it('strips <script> entirely', () => {
    const { container } = render(
      <MarkdownMessage content={'before<script>window.__pwned = true</script>after'} />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('__pwned')
  })

  it('strips inline event handlers', () => {
    const { container } = render(
      <MarkdownMessage content={'<img src="x" onerror="window.__pwned = true" />'} />,
    )
    expect(container.innerHTML).not.toContain('onerror')
    expect(container.innerHTML).not.toContain('__pwned')
  })

  it('drops javascript: URLs', () => {
    const { container } = render(
      <MarkdownMessage content={'<a href="javascript:window.__pwned=1">tap</a>'} />,
    )
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('still renders fenced code with its language class', () => {
    const { container } = render(<MarkdownMessage content={'```ts\nconst a = 1\n```'} />)
    expect(container.textContent).toContain('const a = 1')
    expect(container.textContent?.toLowerCase()).toContain('ts')
  })
})

describe('StreamingText', () => {
  it('formats markdown while the reply is still streaming', () => {
    // Regression: this used to render as plain text and only become a real
    // list once the stream ended, so every reply reflowed at the finish line.
    const { container } = render(<StreamingText text={'- one\n- two'} />)
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('marks the block so the caret can trail the last line', () => {
    const { container } = render(<StreamingText text={'hello'} />)
    expect(container.querySelector('.streaming-caret')).not.toBeNull()
  })

  it('renders an unterminated code fence as an open code block', () => {
    const { container } = render(<StreamingText text={'```ts\nconst a = 1'} />)
    expect(container.textContent).toContain('const a = 1')
  })
})
