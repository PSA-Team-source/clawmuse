import { z } from 'zod'
import { gatewayWS } from '@/services/gateway-ws.service'

/**
 * Terminal sessions, hosted by the gateway.
 *
 * No `node-pty` here on purpose. The gateway already runs a PTY host
 * (`terminal.open/input/resize/close`, streaming through `terminal.data`), so
 * shelling out from Electron would mean a native module, an ABI rebuild per
 * Electron version, an `asarUnpack` entry and a notarization risk — to end up
 * with a *worse* result: a shell the agent knows nothing about, outside the
 * workspace and sandbox policy it operates under.
 *
 * Going through the gateway means the terminal the user types in is the same
 * environment the agent acts in.
 */

const openResultSchema = z
  .object({
    sessionId: z.string(),
    shell: z.string().optional(),
    cwd: z.string().optional(),
    /** True when the gateway confined the shell to the workspace. */
    confined: z.boolean().optional(),
  })
  .loose()

export type TerminalSession = z.infer<typeof openResultSchema>

const dataEventSchema = z
  .object({
    sessionId: z.string(),
    // Gateways differ on the field name; accept both rather than render nothing.
    data: z.string().optional(),
    chunk: z.string().optional(),
  })
  .loose()

const exitEventSchema = z
  .object({ sessionId: z.string(), exitCode: z.number().optional() })
  .loose()

export async function openTerminal(cols: number, rows: number): Promise<TerminalSession> {
  // `cols`/`rows` are required — the gateway rejects the call without them, and
  // there is no `cwd` parameter: the working directory comes from the agent's
  // configured workspace, which is the point.
  const result = await gatewayWS.call('terminal.open', { cols, rows })
  return openResultSchema.parse(result)
}

export function writeTerminal(sessionId: string, data: string): Promise<unknown> {
  return gatewayWS.call('terminal.input', { sessionId, data })
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): Promise<unknown> {
  return gatewayWS.call('terminal.resize', { sessionId, cols, rows })
}

export function closeTerminal(sessionId: string): Promise<unknown> {
  return gatewayWS.call('terminal.close', { sessionId })
}

export interface TerminalHandlers {
  onData: (data: string) => void
  onExit: (code: number | undefined) => void
}

/**
 * Subscribes to one session's output.
 *
 * Filters by `sessionId` because every terminal shares the single gateway
 * socket — without the guard, two open tabs would each render both streams.
 */
export function subscribeTerminal(sessionId: string, handlers: TerminalHandlers): () => void {
  return gatewayWS.on('event', (frame) => {
    if (frame.event === 'terminal.data') {
      const parsed = dataEventSchema.safeParse(frame.payload ?? frame.data)
      if (!parsed.success || parsed.data.sessionId !== sessionId) return
      const chunk = parsed.data.data ?? parsed.data.chunk
      if (chunk) handlers.onData(chunk)
      return
    }
    if (frame.event === 'terminal.exit') {
      const parsed = exitEventSchema.safeParse(frame.payload ?? frame.data)
      if (!parsed.success || parsed.data.sessionId !== sessionId) return
      handlers.onExit(parsed.data.exitCode)
    }
  })
}
