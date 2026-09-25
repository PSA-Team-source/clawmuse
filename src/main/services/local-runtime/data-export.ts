import { app, shell } from 'electron'
import { run } from './exec.js'
import { PROFILE, openclawEnv } from './paths.js'
import { resolveOpenclaw } from './resolve.js'

/**
 * Muse's "Download your agent data" = OpenClaw's own `backup create`: config,
 * credentials, sessions and every bot workspace in one verified archive,
 * written to Downloads and revealed. Restorable with `openclaw backup restore`.
 */
export async function exportAgentData(): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const openclaw = (await resolveOpenclaw())?.bin
  if (!openclaw) return { ok: false, error: 'The local agent is not installed yet' }
  const result = await run(
    openclaw,
    ['--profile', PROFILE, 'backup', 'create', '--output', app.getPath('downloads'), '--verify', '--json'],
    { env: openclawEnv(), timeoutMs: 15 * 60_000 },
  )
  if (result.timedOut) return { ok: false, error: 'The export took too long and was stopped' }
  const start = result.stdout.indexOf('{')
  if (result.code !== 0 || start < 0) {
    return { ok: false, error: result.stderr.split('\n').find((line) => /error|fail/i.test(line))?.trim() || `Export failed (exit ${result.code})` }
  }
  try {
    const data = JSON.parse(result.stdout.slice(start)) as { archivePath?: string; verified?: boolean }
    if (!data.archivePath) return { ok: false, error: 'Export finished without an archive' }
    shell.showItemInFolder(data.archivePath)
    return { ok: true, path: data.archivePath }
  } catch {
    return { ok: false, error: 'Export produced an unreadable result' }
  }
}
