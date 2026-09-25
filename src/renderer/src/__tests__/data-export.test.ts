import { describe, expect, it, vi } from 'vitest'

const reveal = vi.fn()
const run = vi.fn()
vi.mock('electron', () => ({ app: { getPath: () => '/Users/x/Downloads' }, shell: { showItemInFolder: reveal } }))
vi.mock('../../../main/services/local-runtime/exec.js', () => ({ run }))
vi.mock('../../../main/services/local-runtime/paths.js', () => ({ PROFILE: 'clawmuse', openclawEnv: () => ({}) }))
vi.mock('../../../main/services/local-runtime/resolve.js', () => ({ resolveOpenclaw: async () => ({ bin: '/bin/openclaw' }) }))

const { exportAgentData } = await import('../../../main/services/local-runtime/data-export')

describe('agent data export', () => {
  it('runs a verified OpenClaw backup into Downloads and reveals the archive', async () => {
    run.mockResolvedValueOnce({ code: 0, timedOut: false, stderr: '', stdout: '[config] note\n{"archivePath":"/Users/x/Downloads/a-openclaw-backup.tar.gz","verified":true}' })
    expect(await exportAgentData()).toEqual({ ok: true, path: '/Users/x/Downloads/a-openclaw-backup.tar.gz' })
    expect(run.mock.calls[0]![1]).toEqual(['--profile', 'clawmuse', 'backup', 'create', '--output', '/Users/x/Downloads', '--verify', '--json'])
    expect(reveal).toHaveBeenCalledWith('/Users/x/Downloads/a-openclaw-backup.tar.gz')
  })

  it('reports the CLI failure instead of claiming success', async () => {
    run.mockResolvedValueOnce({ code: 1, timedOut: false, stdout: '', stderr: 'Error: disk full' })
    expect(await exportAgentData()).toEqual({ ok: false, error: 'Error: disk full' })
  })
})
