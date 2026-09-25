/**
 * What to put in the thread when a turn fails.
 *
 * The gateway reports a rejected credential as `HTTP 401: User not found.`,
 * which is the provider's words and tells the user nothing they can act on —
 * it is their API key that is wrong, and the place to change it is two clicks
 * away. Naming the remedy is the difference between an error and a dead end.
 */
export function failureNotice(raw: string | undefined): string {
  const message = raw?.trim() ?? ''
  if (/free tier can only be used from within OpenCode|FreeTierError/i.test(message)) {
    return 'OpenCode only allows its free models inside the OpenCode app. Add Zen credits to your OpenCode account, or pick another provider in Settings → Model provider.'
  }
  if (/\b401\b|unauthori[sz]ed|invalid[_ ]api[_ ]key|user not found/i.test(message)) {
    return `Your model provider rejected the API key (${message || '401'}). Change it in Settings → Model provider.`
  }
  if (/billing|credits?|insufficient.?(balance|funds|quota)|\b402\b/i.test(message)) {
    return `Your model provider has no credits left on this key (${message.replace(/^⚠️\s*/, '')}). Top up with your provider, or change the key in Settings → Model provider.`
  }
  if (/configured model is unavailable|unknown model|model[^.]{0,40}\b(not found|unavailable|does not exist)|\b404\b/i.test(message)) {
    return 'The model this chat uses is not available from your provider. Pick another model from the model menu above, or choose Auto.'
  }
  if (/\b429\b|rate.?limit/i.test(message)) {
    return `Your model provider is rate-limiting this key (${message}). Wait a moment, or pick another model in Settings.`
  }
  // sessions.describe caps lastRunError, so a long reason can arrive cut mid-word.
  if (message.length >= 150 && !/[.!?)\]"']$/.test(message)) return `${message}…`
  return message || 'The agent could not answer.'
}
