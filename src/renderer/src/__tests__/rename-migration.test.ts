import { homedir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron-log/main.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const H = homedir()

describe('LocalFang → ClawMuse migration', () => {
  it('re-roots every stored path from both old homes, longest first', async () => {
    const { rewriteLegacyPaths } = await import('../../../main/services/local-runtime/node-check.js')
    const config = JSON.stringify({
      a: `${H}/.localfang/agents/inbox/agent`,
      b: `${H}/.openclaw-localfang/bots/scout`,
      c: `${H}/.localfang`,
      keep: `${H}/.localfangish/other`,
    })
    const out = JSON.parse(rewriteLegacyPaths(config))
    expect(out.a).toBe(`${H}/.openclaw-clawmuse/agents/inbox/agent`)
    expect(out.b).toBe(`${H}/.openclaw-clawmuse/bots/scout`)
    expect(out.c).toBe(`${H}/.openclaw-clawmuse`)
    expect(out.keep).toBe(`${H}/.localfangish/other`)
  })

  it('copies old localStorage keys to the new names without clobbering', async () => {
    const { migrateLegacyStorage } = await import('../lib/migrate-storage')
    const store = new Map<string, string>([
      ['localfang:appearance', 'dark'],
      ['localfang.groups', '[1]'],
      ['clawmuse.groups', '[2]'],
      ['unrelated', 'x'],
    ])
    const storage = {
      get length() {
        return store.size
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage
    expect(migrateLegacyStorage(storage)).toBe(1)
    expect(store.get('clawmuse:appearance')).toBe('dark')
    expect(store.get('clawmuse.groups')).toBe('[2]')
  })

  it('rewrites a pre-rename deep link to the current scheme', async () => {
    vi.doMock('electron', () => ({ app: { isPackaged: false, setAsDefaultProtocolClient: vi.fn() } }))
    vi.doMock('../../../main/windows/main-window.js', () => ({
      createMainWindow: vi.fn(),
      focusedOrFirstWindow: vi.fn(),
      getMainWindows: () => [],
    }))
    const { normalizeDeepLink } = await import('../../../main/services/deeplink.js')
    expect(normalizeDeepLink('localfang://oauth/facebook?code=1')).toBe('clawmuse://oauth/facebook?code=1')
    expect(normalizeDeepLink('clawmuse://chat')).toBe('clawmuse://chat')
    expect(normalizeDeepLink('https://example.com')).toBeNull()
  })
})
