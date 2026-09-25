import { useState, type AnchorHTMLAttributes, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/primitives'

interface MarkdownMessageProps {
  content: string
  className?: string
  /** Appends a blinking caret after the last block — used while a reply streams. */
  streaming?: boolean
}

/**
 * Raw HTML in a reply is worth rendering (agents emit `<br>`, `<details>`,
 * small tables), but it arrives from a model and is therefore untrusted input.
 * `rehypeRaw` parses it and `rehypeSanitize` immediately strips anything that
 * can execute — script/style elements, `on*` handlers, `javascript:` URLs.
 *
 * Order is the whole security property: raw must parse before sanitize runs,
 * never after. The default schema already permits the `language-*` class the
 * code renderer below keys off.
 */
const rehypePlugins = [rehypeRaw, rehypeSanitize]

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <div className="group relative my-2 overflow-hidden rounded-field border border-line bg-bg-surface">
      <div className="flex items-center justify-between border-b border-line-hairline px-3 py-1.5">
        <span className="text-micro font-medium uppercase tracking-label text-content-muted">
          {language || 'text'}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex cursor-pointer items-center gap-1 rounded-field px-1.5 py-0.5 text-micro font-medium text-content-tertiary hover:bg-fill-raised hover:text-content-primary"
          title="Copy code"
        >
          <Icon icon={copied ? Tick02Icon : Copy01Icon} size={12} className="text-current" strokeWidth={2} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="selectable overflow-x-auto p-3">
        <code className="font-mono text-footnote leading-code text-code-fg">{code}</code>
      </pre>
    </div>
  )
}

function ExternalLink({
  href,
  children,
  node: _node,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href) void window.clawmuse.shell.openExternal(href)
      }}
      className="cursor-pointer text-primary-light underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
    >
      {children}
    </a>
  )
}

const components: Components = {
  a: ExternalLink,
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className ?? '')
    const text = String(children).replace(/\n$/, '')
    // Fenced blocks carry a `language-*` class; unlabelled multi-line code also
    // renders as a block — only single-line, unlabelled code is truly inline.
    if (match || text.includes('\n')) {
      return <CodeBlock language={match?.[1]} code={text} />
    }
    return (
      <code className="rounded-xs bg-fill-raised px-1.5 py-0.5 font-mono text-footnote text-primary-light">
        {children}
      </code>
    )
  },
  pre({ children }: { children?: ReactNode }) {
    // `code` above owns the full block chrome (header, copy button, scroll) —
    // `pre` would otherwise double-wrap it in browser default styling.
    return <>{children}</>
  },
}

/** react-markdown + GFM, with copyable fenced code blocks and links routed through the OS browser. */
export function MarkdownMessage({ content, className, streaming }: MarkdownMessageProps) {
  return (
    <div
      className={cn(
        'text-body text-content-primary [&_h1]:my-2 [&_h1]:text-headline [&_h1]:font-bold',
        // The caret rides the last rendered block rather than sitting on its own
        // line, so a streaming paragraph reads like a cursor mid-sentence.
        streaming &&
          'streaming-caret [&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:content-["▋"] [&>*:last-child]:after:text-primary-light',
        '[&_h2]:my-1.5 [&_h2]:text-headline [&_h2]:font-semibold [&_h3]:my-1 [&_h3]:text-body [&_h3]:font-semibold',
        '[&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
        '[&_strong]:font-bold [&_em]:italic',
        '[&_blockquote]:my-1 [&_blockquote]:rounded-xs [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary [&_blockquote]:bg-fill-accent [&_blockquote]:py-0.5 [&_blockquote]:pl-3',
        '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
