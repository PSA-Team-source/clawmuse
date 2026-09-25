import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), on: vi.fn(), focus: vi.fn() }, BrowserWindow: class {}, screen: {} }))
vi.mock('electron-log/main.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))

const { parseAppPreferences } = await import('../../../main/services/app-preferences')
const { readDroppedFiles } = await import('../../../main/windows/floating-button')

describe('app behavior preferences', () => {
  it('defaults both toggles on and ignores malformed values', () => {
    expect(parseAppPreferences(null)).toEqual({ showMenuBar: true, showFloatingButton: true, pushToTalk: 'off' })
    expect(parseAppPreferences({ showMenuBar: false, showFloatingButton: 'no', pushToTalk: 'fn' })).toEqual({ showMenuBar: false, showFloatingButton: true, pushToTalk: 'fn' })
    expect(parseAppPreferences({ pushToTalk: 'space' }).pushToTalk).toBe('off')
  })
})

describe('floating button drops', () => {
  it('reads regular files only, typed by extension, and rejects anything else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drop-'))
    const note = join(dir, 'note.md')
    writeFileSync(note, '# hi')
    const files = readDroppedFiles([note, dir, join(dir, 'missing.png'), 42])
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ name: 'note.md', type: 'text/markdown' })
    expect(new TextDecoder().decode(files[0]!.data)).toBe('# hi')
    expect(readDroppedFiles('not-a-list')).toEqual([])
  })
})
