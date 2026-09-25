import { QueryClient } from '@tanstack/react-query'

/**
 * The app's single QueryClient.
 *
 * Lives outside the component tree so the gateway socket — which is not React —
 * can invalidate queries when the agent changes something behind the user's
 * back. A cron job the agent creates during a chat has to appear on the Tasks
 * screen without the user going looking for a refresh button.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A desktop app is left open for days; refetching on focus is how the
      // user gets fresh data after coming back from lunch.
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 10_000,
    },
  },
})
