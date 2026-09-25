import { create } from 'zustand'
import type { ShareCardInput } from '@shared/share-card'

/**
 * The card the user asked to share. Any screen opens it with `shareCard(…)`;
 * one `ShareCardDialog` at the app root draws it and offers Copy / Save / Share.
 */
export const useShareCardStore = create<{ request: ShareCardInput | null; close: () => void }>((set) => ({
  request: null,
  close: () => set({ request: null }),
}))

export function shareCard(input: ShareCardInput): void {
  useShareCardStore.setState({ request: input })
}
