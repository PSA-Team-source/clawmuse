import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import log from 'electron-log/main.js'
import { paths } from './paths.js'

/**
 * The shared computer's screen.
 *
 * `POST /screenshot` on the browser control API answers with a **path** to a
 * saved PNG, not with the image, so something has to read it. That something is
 * the main process, because the renderer must never be handed a `file://` read
 * primitive — a prompt-injected agent that can drive the UI would otherwise be
 * one URL away from `~/.ssh`.
 *
 * The rule is the same one `fs-bridge.ts` uses: realpath first, then require
 * the result to sit inside the profile. A symlink planted in the media
 * directory is exactly the case a prefix check on the raw string misses.
 */

const MAX_SHOT_BYTES = 12 * 1024 * 1024

function isInsideProfile(real: string, home: string): boolean {
  return real === home || real.startsWith(home + sep)
}

/** A screenshot as a `data:` URL, or null when the path is not ours to read. */
export async function readBrowserShot(path: string): Promise<string | null> {
  try {
    const home = await realpath(paths.home)
    const real = await realpath(resolve(path))
    if (!isInsideProfile(real, home)) {
      log.warn('[computer] refused a screenshot outside the profile')
      return null
    }
    const buffer = await readFile(real)
    if (buffer.byteLength > MAX_SHOT_BYTES) {
      log.warn(`[computer] screenshot too large (${buffer.byteLength} bytes)`)
      return null
    }
    const mime = real.endsWith('.jpg') || real.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch (error) {
    // A missing file is the normal case when the browser has not started yet.
    log.debug?.('[computer] could not read screenshot:', (error as Error).message)
    return null
  }
}
