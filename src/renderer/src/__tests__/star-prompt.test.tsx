import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { canOfferStar, recordStarPrompt, REPOSITORY_URL, STAR_PROMPT_KEY } from '@/lib/star-prompt'
import { StarPrompt } from '@/routes/muse/StarPrompt'

const openExternal = vi.fn(async () => undefined)

beforeEach(() => {
  localStorage.clear()
  openExternal.mockClear()
  ;(window as unknown as { clawmuse: unknown }).clawmuse = { shell: { openExternal } }
})
afterEach(cleanup)

const outcome = () => (JSON.parse(localStorage.getItem(STAR_PROMPT_KEY) ?? 'null') as { outcome: string } | null)?.outcome

describe('GitHub star note', () => {
  it('is offered until it has been shown once, then never again', () => {
    expect(canOfferStar()).toBe(true)
    recordStarPrompt('shown')
    expect(canOfferStar()).toBe(false)
  })

  it('stays quiet when storage cannot be read', () => {
    expect(canOfferStar({ getItem: () => { throw new Error('blocked') } })).toBe(false)
  })

  it('opens the repository in the browser and closes for good on Star', () => {
    const onClose = vi.fn()
    render(<StarPrompt onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Star on GitHub' }))
    expect(openExternal).toHaveBeenCalledWith(REPOSITORY_URL)
    expect(onClose).toHaveBeenCalledOnce()
    expect(outcome()).toBe('starred')
    expect(canOfferStar()).toBe(false)
  })

  it('closes for good on Dismiss without opening anything', () => {
    const onClose = vi.fn()
    render(<StarPrompt onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(openExternal).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
    expect(outcome()).toBe('dismissed')
    expect(canOfferStar()).toBe(false)
  })
})
