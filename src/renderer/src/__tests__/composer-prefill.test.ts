import { afterEach, describe, expect, it } from 'vitest'
import { onComposerPrefill, PENDING_PROMPT_KEY, prefillComposer } from '@/lib/composer-prefill'
import { editTaskPrompt } from '@/routes/status/UpcomingTab'

describe('prefillComposer (Muse setComposerInputValue)', () => {
  afterEach(() => sessionStorage.clear())

  it('hands the text to a mounted composer and stores nothing', () => {
    const received: string[] = []
    const off = onComposerPrefill((text) => received.push(text))
    prefillComposer('Change your name to ')
    off()
    expect(received).toEqual(['Change your name to '])
    expect(sessionStorage.getItem(PENDING_PROMPT_KEY)).toBeNull()
  })

  it('keeps the text for the next chat when none is open', () => {
    prefillComposer(editTaskPrompt({ name: 'heartbeat-main', display_name: 'Heartbeat (main)' }))
    expect(sessionStorage.getItem(PENDING_PROMPT_KEY)).toBe('Edit my scheduled task “Heartbeat (main)”: ')
  })
})
