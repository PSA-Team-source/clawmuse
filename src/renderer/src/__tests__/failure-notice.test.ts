import { describe, expect, it } from 'vitest'
import { failureNotice } from '@/stores/chat.store'

/**
 * A turn that fails has to leave a mark, and the mark has to be actionable.
 *
 * The case this was written for: an adopted API key was dead, every message got
 * `HTTP 401: User not found.` from the provider, and the thread showed
 * *nothing* — the typing indicator stopped and the conversation sat there. The
 * app said "Connected" the whole time. Silence is the one response a person
 * cannot debug.
 */
describe('failureNotice', () => {
  it('names the remedy for a rejected key', () => {
    const notice = failureNotice('HTTP 401: User not found.')
    expect(notice).toMatch(/rejected the API key/i)
    expect(notice).toMatch(/Settings → Model provider/)
    // The provider's own words stay in, because they are what a search finds.
    expect(notice).toContain('User not found')
  })

  it('recognises a rejected key however it is worded', () => {
    for (const raw of ['401 Unauthorized', 'invalid_api_key', 'Unauthorised']) {
      expect(failureNotice(raw)).toMatch(/rejected the API key/i)
    }
  })

  it('tells a rate limit apart from a bad key — the fix is different', () => {
    const notice = failureNotice('HTTP 429: rate limit exceeded')
    expect(notice).toMatch(/rate-limiting/i)
    expect(notice).not.toMatch(/rejected the API key/i)
  })

  it('passes an unfamiliar error through rather than swallowing it', () => {
    expect(failureNotice('ECONNREFUSED 127.0.0.1:11434')).toBe('ECONNREFUSED 127.0.0.1:11434')
  })

  it('still says something when the gateway said nothing', () => {
    expect(failureNotice(undefined)).toBe('The agent could not answer.')
    expect(failureNotice('   ')).toBe('The agent could not answer.')
  })

  it('names the remedy when the pinned model does not exist', () => {
    expect(failureNotice('⚠️ The configured model is unavailable from the provider — it may have been renamed, retired, or is not offered on this account. This needs a config update (age')).toMatch(/^The model this chat uses is not available/)
  })

  it('marks a reason the gateway cut short instead of ending mid-word', () => {
    const cut = 'x'.repeat(155) + ' (age'
    expect(failureNotice(cut)).toBe(`${cut}…`)
    expect(failureNotice('Short reason')).toBe('Short reason')
  })

  it('treats an unknown model ref like an unavailable one', () => {
    expect(failureNotice('Unknown model: nvidia/nvidia/nemotron-3-ultra-550b-a55b:free. Run `openclaw models list`')).toMatch(/^The model this chat uses is not available/)
  })
})
