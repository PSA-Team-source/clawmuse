import { MarkdownMessage } from './MarkdownMessage'

interface StreamingTextProps {
  text: string
  className?: string
}

/**
 * The in-flight half of an assistant reply.
 *
 * This used to render plain text and only switch to markdown once the stream
 * finished, which made every reply visibly reflow at the end — a code block
 * spent its whole life as grey prose and then snapped into a bordered panel.
 * Rendering markdown the entire time costs one parse per delta and removes that
 * jump; an unterminated fence simply renders as an open code block, which is
 * what it is.
 */
export function StreamingText({ text, className }: StreamingTextProps) {
  return <MarkdownMessage content={text} className={className} streaming />
}
