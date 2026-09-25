/** The draft a chat reads when it mounts (see ChatThreadScreen). */
export const PENDING_PROMPT_KEY = 'clawmuse.pendingPrompt'
const EVENT = 'clawmuse-prefill-composer'

/**
 * Muse's setComposerInputValue + `hatch-focus-composer`: puts text in the open
 * chat's composer and focuses it. With no chat mounted, the text waits in
 * session storage for the next one to open.
 */
export function prefillComposer(text: string): void {
  const event = new CustomEvent<string>(EVENT, { detail: text, cancelable: true })
  if (window.dispatchEvent(event)) {
    try { sessionStorage.setItem(PENDING_PROMPT_KEY, text) } catch { /* private mode: nothing to keep it in */ }
  }
}

/** Subscribes a composer; the handler claims the text so it is not also stored. */
export function onComposerPrefill(handler: (text: string) => void): () => void {
  const listener = (event: Event) => {
    event.preventDefault()
    handler((event as CustomEvent<string>).detail)
  }
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
