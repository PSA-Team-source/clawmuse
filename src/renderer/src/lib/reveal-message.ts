/**
 * Scrolls a search hit's message into view once its thread has rendered it.
 *
 * The thread mounts and loads history after navigation, so the bubble is not
 * there yet when the hit is chosen; this waits for it rather than guessing a
 * delay. A message outside the loaded history simply leaves the thread open.
 */
export function revealMessage(messageId: string): void {
  const selector = `[data-message-id="${CSS.escape(messageId)}"]`
  const reveal = (el: Element) => requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }))
  const existing = document.querySelector(selector)
  if (existing) { reveal(existing); return }
  const observer = new MutationObserver(() => {
    const el = document.querySelector(selector)
    if (!el) return
    observer.disconnect()
    clearTimeout(timer)
    reveal(el)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const timer = setTimeout(() => observer.disconnect(), 8000)
}
