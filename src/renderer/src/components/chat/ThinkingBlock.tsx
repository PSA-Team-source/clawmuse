import { cn } from '@/lib/cn'
import { Collapsible } from '@/components/primitives'
import { MarkdownMessage } from './MarkdownMessage'

interface ThinkingBlockProps {
  text: string
  /** While the answer is still streaming the block opens itself and animates. */
  streaming?: boolean
  className?: string
}

/**
 * The model's reasoning, shown above the answer it produced.
 *
 * Two deliberate choices. It defaults **open while streaming** — watching the
 * agent think is the only feedback during a long tool-heavy turn — and
 * **collapsed once finished**, because a settled thread should read as answers,
 * not transcripts. And it renders as markdown: reasoning contains lists and
 * code as often as prose.
 */
export function ThinkingBlock({ text, streaming, className }: ThinkingBlockProps) {
  if (!text.trim()) return null

  return (
    <Collapsible
      // `key` on the streaming flag so a turn that starts open and finishes
      // closed actually re-initialises, rather than keeping the state it had
      // when it first mounted.
      key={streaming ? 'streaming' : 'settled'}
      defaultOpen={Boolean(streaming)}
      className={cn('mb-1', className)}
      triggerClassName="w-auto py-0.5 text-footnote text-content-muted transition-colors hover:text-content-secondary"
      summary={
        <span className={streaming ? 'animate-fb-pulse' : undefined}>
          {streaming ? 'Thinking…' : 'Thought process'}
        </span>
      }
    >
      <div className="ml-4 mt-1 border-l border-line-hairline pl-3">
        <MarkdownMessage
          content={text}
          className="text-footnote leading-relaxed text-content-tertiary [overflow-wrap:anywhere]"
        />
      </div>
    </Collapsible>
  )
}
