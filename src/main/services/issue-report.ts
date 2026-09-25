import { open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, shell } from 'electron'
import log from 'electron-log/main.js'
import * as runtime from './local-runtime/index.js'

/**
 * Muse's "Report a bug" gathers the description with diagnostics. ClawMuse has
 * no service to send it to, so it writes the same bundle to Downloads and shows
 * it in Finder — a file the user can attach wherever they ask for help.
 */

const TAIL_LINES = 300
const MAX_DESCRIPTION = 10_000

const TAIL_BYTES = 256 * 1024

/** Last lines of a log without loading a multi-hundred-MB file into memory. */
async function tail(path: string): Promise<string> {
  try {
    const file = await open(path, 'r')
    try {
      const { size } = await file.stat()
      const length = Math.min(size, TAIL_BYTES)
      const { buffer } = await file.read(Buffer.alloc(length), 0, length, size - length)
      return buffer.toString('utf8').split('\n').slice(-TAIL_LINES).join('\n').trim() || '(empty)'
    } finally {
      await file.close()
    }
  } catch {
    return '(not found)'
  }
}

export function reportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `ClawMuse report ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}.md`
}

export async function saveIssueReport(description: unknown): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (typeof description !== 'string' || !description.trim()) return { ok: false, error: 'Describe what went wrong first' }
  const resolution = runtime.getResolution()
  const status = runtime.getStatus()
  const body = [
    '# ClawMuse report',
    '',
    `- Created: ${new Date().toISOString()}`,
    `- App: ${app.getVersion()} (${process.platform} ${process.arch}, Electron ${process.versions.electron})`,
    `- Local agent: ${resolution ? `openclaw ${resolution.version} (${resolution.source})` : 'not installed'} — ${status.state}`,
    '',
    '## What went wrong',
    '',
    description.trim().slice(0, MAX_DESCRIPTION),
    '',
    '## App log (last 300 lines)',
    '',
    '```',
    await tail(log.transports.file.getFile().path),
    '```',
    '',
    '## Local agent log (last 300 lines)',
    '',
    '```',
    await tail(await runtime.resolveLogPath()),
    '```',
    '',
  ].join('\n')
  const path = join(app.getPath('downloads'), reportFileName(new Date()))
  try {
    await writeFile(path, body, 'utf8')
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
  shell.showItemInFolder(path)
  return { ok: true, path }
}
