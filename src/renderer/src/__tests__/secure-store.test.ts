import { describe, expect, it, vi } from 'vitest'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/services/gateway-ws.service', () => ({ gatewayWS: { call } }))
import { SECRET_NAME_RE, hostFromInput, isPlausibleHost, pairLogins, pairedUsernameName, parseHosts, parseSecretStoreList, planLoginWrites, sameHosts, writeInOrder, suggestSecretName, type SecretStoreEntry } from '@/routes/settings/secure-store'

describe('secure store', () => {
  it('reads the gateway list without ever keeping a secret value', () => {
    // Shape captured from a live `secrets.store.list` (OpenClaw 2026.9.5), plus an env entry.
    const entries = parseSecretStoreList({
      entries: [
        { name: 'CLAWMUSE_TEST_PROBE', scopeKind: 'team', scopeId: '', createdAtMs: 1, updatedAtMs: 2, updatedBy: 'sang nguyen', kind: 'secret', allowedHosts: ['api.example.com', 'example.com'], value: 'must-not-survive' },
        { name: 'REGION', scopeKind: 'team', scopeId: '', createdAtMs: 3, updatedAtMs: 3, kind: 'env', value: 'eu-west-1' },
        { name: 'BROKEN', kind: 'secret' },
      ],
    })
    expect(entries).toEqual([
      { name: 'CLAWMUSE_TEST_PROBE', kind: 'secret', allowedHosts: ['api.example.com', 'example.com'], createdAtMs: 1, updatedAtMs: 2, updatedBy: 'sang nguyen' },
      { name: 'REGION', kind: 'env', value: 'eu-west-1', createdAtMs: 3, updatedAtMs: 3 },
    ])
    expect(() => parseSecretStoreList({})).toThrow()
  })

  it('turns what people type into exact hostnames', () => {
    expect(hostFromInput('https://GitHub.com/login?next=/')).toBe('github.com')
    expect(hostFromInput('github.com/login')).toBe('github.com')
    expect(hostFromInput(' Example.COM. ')).toBe('example.com')
    expect(parseHosts('https://a.com, b.com\nA.com  ')).toEqual(['a.com', 'b.com'])
    expect(sameHosts(['b.com', 'a.com'], ['a.com', 'b.com'])).toBe(true)
    expect(sameHosts(['a.com'], ['a.com', 'b.com'])).toBe(false)
  })

  it('flags hosts the gateway would refuse', () => {
    for (const ok of ['github.com', 'localhost', '127.0.0.1', '[::1]', 'bücher.de']) expect(isPlausibleHost(ok), ok).toBe(true)
    for (const bad of ['', '*.github.com', 'github.com:443', 'a b.com', '-a.com', 'a..com', 'user@a.com']) expect(isPlausibleHost(bad), bad).toBe(false)
  })

  it('suggests a valid SecretRef name from the website', () => {
    expect(suggestSecretName('github.com')).toBe('GITHUB_COM_PASSWORD')
    expect(suggestSecretName('1password.com')).toBe('SITE_1PASSWORD_COM_PASSWORD')
    expect(suggestSecretName('')).toBe('')
    const long = suggestSecretName(`${'a'.repeat(60)}.${'b'.repeat(60)}.com`)
    expect(SECRET_NAME_RE.test(long)).toBe(true)
  })

  const secret = (name: string, allowedHosts: string[], updatedAtMs = 1): SecretStoreEntry => ({ name, kind: 'secret', allowedHosts, createdAtMs: 1, updatedAtMs })

  it('pairs <STEM>_PASSWORD with <STEM>_USERNAME and keeps a lone username visible', () => {
    expect(pairedUsernameName('GITHUB_COM_PASSWORD')).toBe('GITHUB_COM_USERNAME')
    expect(pairedUsernameName('STRIPE_API_KEY')).toBeNull()
    expect(pairedUsernameName('_PASSWORD')).toBeNull()
    const { logins, envs } = pairLogins([
      secret('GITHUB_COM_PASSWORD', ['github.com'], 5),
      secret('GITHUB_COM_USERNAME', ['github.com'], 9),
      secret('STRIPE_API_KEY', ['api.stripe.com']),
      secret('ORPHAN_USERNAME', ['orphan.com']),
      { name: 'REGION', kind: 'env', value: 'eu', createdAtMs: 1, updatedAtMs: 1 },
    ])
    expect(envs.map((entry) => entry.name)).toEqual(['REGION'])
    expect(logins.map((login) => [login.passwordName, login.usernameName, Boolean(login.password), Boolean(login.username), login.hosts, login.updatedAtMs])).toEqual([
      ['GITHUB_COM_PASSWORD', 'GITHUB_COM_USERNAME', true, true, ['github.com'], 9],
      ['ORPHAN_PASSWORD', 'ORPHAN_USERNAME', false, true, ['orphan.com'], 1],
      ['STRIPE_API_KEY', null, true, false, ['api.stripe.com'], 1],
    ])
  })

  it('writes a login password-first, and never moves one half of it to other websites', () => {
    const [login] = pairLogins([secret('GITHUB_COM_PASSWORD', ['github.com']), secret('GITHUB_COM_USERNAME', ['github.com'])]).logins
    const moved = ['github.com', 'gist.github.com']
    expect(planLoginWrites(login!, { hosts: ['github.com'], password: '', username: '' })).toEqual({ error: 'unchanged' })
    expect(planLoginWrites(login!, { hosts: moved, password: '', username: 'me' })).toEqual({ error: 'password-required' })
    expect(planLoginWrites(login!, { hosts: moved, password: 'pw', username: '' })).toEqual({ error: 'username-required' })
    expect(planLoginWrites(login!, { hosts: ['github.com'], password: '', username: 'me' })).toEqual({ writes: [{ name: 'GITHUB_COM_USERNAME', value: 'me', kind: 'secret', allowedHosts: ['github.com'] }] })
    expect(planLoginWrites(login!, { hosts: moved, password: 'pw', username: 'me' })).toEqual({
      writes: [
        { name: 'GITHUB_COM_PASSWORD', value: 'pw', kind: 'secret', allowedHosts: moved },
        { name: 'GITHUB_COM_USERNAME', value: 'me', kind: 'secret', allowedHosts: moved },
      ],
    })
    const [key] = pairLogins([secret('STRIPE_API_KEY', [])]).logins
    expect(planLoginWrites(key!, { hosts: [], password: '', username: 'me' })).toEqual({ error: 'no-username-slot' })
  })

  it('stops at the first failed write and reports exactly what was saved', async () => {
    call.mockResolvedValueOnce({ ok: true, reloaded: false }).mockRejectedValueOnce(new Error('WebSocket disconnected'))
    const result = await writeInOrder([
      { name: 'A_PASSWORD', value: 'pw', kind: 'secret', allowedHosts: [] },
      { name: 'A_USERNAME', value: 'me', kind: 'secret', allowedHosts: [] },
      { name: 'NEVER_SENT', value: 'x', kind: 'secret' },
    ])
    expect(result.saved).toEqual(['A_PASSWORD'])
    expect(result.failed?.name).toBe('A_USERNAME')
    expect(call).toHaveBeenCalledTimes(2)
  })
})
