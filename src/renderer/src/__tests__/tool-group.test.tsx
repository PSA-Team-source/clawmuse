import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageList } from '@/components/chat/MessageList'
import { toolDetail, toolMeta } from '@/components/chat/tool-display'
import type { Message, ToolCall } from '@/types'

/**
 * A single turn can fire a dozen tools. The store records one message per call
 * — correct as a log, unreadable as a thread: the answer ends up buried under
 * stacked JSON cards. Grouping happens at render time so the log stays honest.
 */

function toolMessage(id: string, call: Partial<Omit<ToolCall, 'id'>>): Message {
  const toolCall: ToolCall = { id, tool: 'Read', status: 'done', input: undefined, ...call }
  return {
    id: `toolmsg_${id}`,
    session_id: 'webchat:main',
    role: 'tool',
    content: '',
    status: 'sent',
    created_at: new Date(0).toISOString(),
    tool_calls: [toolCall],
  }
}

function assistantMessage(id: string, content: string): Message {
  return {
    id,
    session_id: 'webchat:main',
    role: 'assistant',
    content,
    status: 'sent',
    created_at: new Date(0).toISOString(),
  }
}

describe('tool-display', () => {
  it('maps known tools to a human verb', () => {
    expect(toolMeta('Bash').verb).toBe('Run')
    expect(toolMeta('Grep').verb).toBe('Search')
  })

  it('falls back to the raw name for unknown tools rather than hiding them', () => {
    expect(toolMeta('some_custom_mcp_tool').verb).toBe('some_custom_mcp_tool')
  })

  it('shortens file paths to the last two segments', () => {
    expect(toolDetail('Read', { file_path: '/Users/x/project/src/App.tsx' })).toBe('src/App.tsx')
  })

  it('truncates long commands', () => {
    const detail = toolDetail('Bash', { command: 'echo '.repeat(40) })
    expect(detail.length).toBeLessThanOrEqual(56)
    expect(detail.endsWith('…')).toBe(true)
  })

  it('survives a malformed input payload', () => {
    expect(toolDetail('Read', null)).toBe('')
    expect(toolDetail('Read', 'not-an-object')).toBe('')
    expect(toolDetail('Read', {})).toBe('')
  })
})

describe('MessageList — tool grouping', () => {
  it('folds consecutive tool calls into a single collapsed row', () => {
    render(
      <MessageList
        messages={[
          toolMessage('a', { tool: 'Read', input: { file_path: 'src/one.ts' } }),
          toolMessage('b', { tool: 'Read', input: { file_path: 'src/two.ts' } }),
          toolMessage('c', { tool: 'Bash', input: { command: 'npm test' } }),
        ]}
      />,
    )

    // Distinct names, not one row per call.
    expect(screen.getByText('Read, Bash')).toBeTruthy()
    expect(screen.getByText('(3)')).toBeTruthy()
  })

  it('keeps a lone tool call as a plain card', () => {
    render(<MessageList messages={[toolMessage('a', { tool: 'Read' })]} />)
    expect(screen.queryByText('(1)')).toBeNull()
  })

  it('does not merge tool runs separated by an assistant reply', () => {
    render(
      <MessageList
        messages={[
          toolMessage('a', { tool: 'Read' }),
          toolMessage('b', { tool: 'Grep' }),
          assistantMessage('m1', 'here is what I found'),
          toolMessage('c', { tool: 'Bash' }),
          toolMessage('d', { tool: 'Write' }),
        ]}
      />,
    )

    expect(screen.getByText('Read, Grep')).toBeTruthy()
    expect(screen.getByText('Bash, Write')).toBeTruthy()
  })

  it('reveals the individual calls when expanded', () => {
    render(
      <MessageList
        messages={[
          toolMessage('a', { tool: 'Read', input: { file_path: 'src/one.ts' } }),
          toolMessage('b', { tool: 'Bash', input: { command: 'npm test' } }),
        ]}
      />,
    )

    fireEvent.click(screen.getByText('Read, Bash'))
    expect(screen.getByText('Bash')).toBeTruthy()
  })

  it('ignores tool messages that carry no structured calls', () => {
    const bare: Message = {
      id: 'bare',
      session_id: 'webchat:main',
      role: 'tool',
      content: '{"raw":"io"}',
      status: 'sent',
      created_at: new Date(0).toISOString(),
    }
    const { container } = render(<MessageList messages={[bare]} />)
    expect(container.textContent).not.toContain('raw')
  })
})
