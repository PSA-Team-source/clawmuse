import { createServer } from 'node:net'
import { DEFAULT_PORT } from './paths.js'

/**
 * Port selection for the local gateway.
 *
 * `multiple-gateways.md` warns that derived browser/canvas/CDP ports allocate
 * from the base port upwards, and recommends leaving ~20 ports between
 * gateways. So candidates step by 20, not by 1 — stepping by 1 would land the
 * second gateway inside the first one's derived range.
 */

const STEP = 20
const MAX_ATTEMPTS = 10

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    // Bind loopback specifically: the gateway binds loopback, so a service
    // occupying only an external interface is not a conflict.
    server.listen(port, '127.0.0.1')
  })
}

/**
 * True when something is already listening — which, for our port, most likely
 * means a gateway we should attach to rather than a conflict.
 */
export async function isPortTaken(port: number): Promise<boolean> {
  return !(await isPortFree(port))
}

export async function pickPort(preferred = DEFAULT_PORT): Promise<number> {
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const candidate = preferred + i * STEP
    if (await isPortFree(candidate)) return candidate
  }
  throw new Error(`No free port found between ${preferred} and ${preferred + MAX_ATTEMPTS * STEP}`)
}
