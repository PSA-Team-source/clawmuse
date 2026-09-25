import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../main/services/local-runtime/exec.js', () => ({ run: vi.fn() }))
vi.mock('../../../main/services/local-runtime/paths.js', () => ({ PROFILE: 'clawmuse', openclawEnv: () => ({}) }))
vi.mock('../../../main/services/local-runtime/resolve.js', () => ({ resolveOpenclaw: async () => ({ bin: '/bin/openclaw' }) }))

const { approvePairingRequest, isPairingCode, parsePairingList } = await import('../../../main/services/local-runtime/channel-pairing')

describe('channel pairing', () => {
  it('reads pending requests from the CLI JSON, keeping a sender name when present', () => {
    const out = '[config] warn\n{"channel":"telegram","requests":[{"id":"42","code":"AB12CD","createdAt":"2026-09-23T15:00:00Z","meta":{"username":"sam"}},{"id":7}]}'
    expect(parsePairingList(out)).toEqual([{ id: '42', code: 'AB12CD', createdAt: '2026-09-23T15:00:00Z', name: 'sam' }])
    expect(parsePairingList('nope')).toEqual([])
  })

  it('refuses unknown channels and malformed codes before spawning anything', async () => {
    expect(isPairingCode('AB12CD')).toBe(true)
    expect(isPairingCode('a; rm -rf /')).toBe(false)
    expect(await approvePairingRequest('whatsapp', 'AB12CD')).toEqual({ ok: false, error: 'Invalid pairing request' })
    expect(await approvePairingRequest('telegram', '--help')).toEqual({ ok: false, error: 'Invalid pairing request' })
  })
})
