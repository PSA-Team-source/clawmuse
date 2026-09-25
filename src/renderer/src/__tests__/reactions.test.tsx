import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MessageToolbar, ReactionBadge } from '@/components/chat/MessageToolbar'
import type { Message } from '@/types'

const reply: Message = { id: 'm-1', session_id: 's', role: 'assistant', content: 'Done', status: 'sent', created_at: '2026-09-23T10:00:00Z' }

describe('message reactions', () => {
  it('reacts to an agent reply from the picker, shows the badge, and remembers it', async () => {
    render(<><MessageToolbar message={reply} isUser={false} onReply={() => undefined} /><ReactionBadge messageId="m-1" isUser={false} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'React' }))
    fireEvent.click(await screen.findByRole('button', { name: 'React 👍' }))
    expect(screen.getByLabelText('Your reaction: 👍')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('clawmuse.reactions.v1') ?? '{}')).toEqual({ 'm-1': ['👍'] })
  })

  it('offers no reaction on your own or failed messages', () => {
    render(<MessageToolbar message={{ ...reply, id: 'm-2', status: 'failed' }} isUser={false} />)
    expect(screen.queryByRole('button', { name: 'React' })).toBeNull()
  })
})
