import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../main/services/local-runtime/exec.js', () => ({ run: vi.fn() }))
vi.mock('../../../main/services/local-runtime/paths.js', () => ({ paths: { home: '/tmp/x', config: '/tmp/x/c.json' }, openclawEnv: () => ({ PATH: '' }) }))

const { pickCardFields } = await import('../../../main/services/local-runtime/wallet')
const { parsePluginApproval } = await import('@/stores/plugin-approvals.store')

describe('wallet', () => {
  it('picks card fields by type from the 1Password template, using its labels', () => {
    const template = JSON.stringify({ fields: [
      { id: 'cardholder', type: 'STRING', label: 'cardholder name' },
      { id: 'ccnum', type: 'CREDIT_CARD_NUMBER', label: 'number' },
      { id: 'cvv', type: 'CONCEALED', label: 'verification number' },
      { id: 'expiry', type: 'MONTH_YEAR', label: 'expiry date' },
    ] })
    expect(pickCardFields(template)).toEqual([
      { key: 'number', label: 'number' },
      { key: 'expiry', label: 'expiry date' },
      { key: 'cvv', label: 'verification number' },
      { key: 'holder', label: 'cardholder name' },
    ])
    expect(pickCardFields('not json')).toEqual([])
  })

  it('parses plugin approval requests, keeping only known decisions', () => {
    expect(parsePluginApproval({ id: 'plugin:1', request: { title: '1Password: card-x-number', description: 'Agent main requests card-x-number', allowedDecisions: ['allow-once', 'deny', 'bogus'] }, expiresAtMs: 5 }))
      .toMatchObject({ id: 'plugin:1', severity: 'warning', allowedDecisions: ['allow-once', 'deny'], expiresAtMs: 5 })
    expect(parsePluginApproval({ id: 1 })).toBeNull()
  })
})
