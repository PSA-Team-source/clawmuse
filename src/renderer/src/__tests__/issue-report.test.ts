import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'report-'))
const appLog = join(dir, 'main.log')
writeFileSync(appLog, Array.from({ length: 500 }, (_, i) => `app line ${i}`).join('\n'))
const reveal = vi.fn()

vi.mock('electron', () => ({ app: { getPath: () => dir, getVersion: () => '9.9.9' }, shell: { showItemInFolder: reveal } }))
vi.mock('electron-log/main.js', () => ({ default: { transports: { file: { getFile: () => ({ path: appLog }) } } } }))
vi.mock('../../../main/services/local-runtime/index.js', () => ({
  getResolution: () => ({ version: '2026.9.5', source: 'managed' }),
  getStatus: () => ({ state: 'ready' }),
  resolveLogPath: async () => join(dir, 'missing.log'),
}))

const { saveIssueReport } = await import('../../../main/services/issue-report')

describe('issue report', () => {
  it('writes description + diagnostics + log tails to Downloads and reveals it', async () => {
    const result = await saveIssueReport('Dictation never finished')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = readFileSync(result.path, 'utf8')
    expect(text).toContain('Dictation never finished')
    expect(text).toContain('openclaw 2026.9.5 (managed) — ready')
    expect(text).toContain('app line 499')
    expect(text).not.toContain('app line 199')
    expect(text).toContain('(not found)')
    expect(reveal).toHaveBeenCalledWith(result.path)
  })

  it('refuses an empty description', async () => {
    expect(await saveIssueReport('  ')).toEqual({ ok: false, error: 'Describe what went wrong first' })
  })
})
