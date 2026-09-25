import { describe, expect, it } from 'vitest'
import {
  describeNodeFailure,
  evaluateNodeVersion,
} from '../../../main/services/local-runtime/node-check'

/**
 * "There is no Node here" and "the Node here does not work" are different
 * problems with different fixes, and the app used to report both as *install
 * Node* — advice that is not merely unhelpful to someone who already has it,
 * it sends them to do the one thing that will not help.
 *
 * The case that produced this: a Homebrew upgrade left `/opt/homebrew/bin/node`
 * pointing at a build whose `libsimdjson` had moved, so the binary existed, was
 * executable, was first on PATH, and died on every launch.
 */
describe('describeNodeFailure', () => {
  it('names a broken install rather than blaming a missing one', () => {
    const dyld = [
      'dyld[25929]: Library not loaded: /opt/homebrew/opt/simdjson/lib/libsimdjson.29.dylib',
      '  Referenced from: /opt/homebrew/Cellar/node/25.5.0/bin/node',
    ].join('\n')
    const message = describeNodeFailure(dyld)
    expect(message).toMatch(/installed but cannot start/i)
    expect(message).toContain('libsimdjson')
    expect(message).not.toMatch(/nodejs\.org/)
  })

  it('suggests the repair that actually applies to a dyld failure', () => {
    expect(describeNodeFailure('dyld: Library not loaded: x')).toMatch(/brew reinstall node/)
  })

  it('passes through whatever the binary said when it is not a dyld error', () => {
    expect(describeNodeFailure('Killed: 9')).toBe('Node is installed but cannot start: Killed: 9')
  })

  it('falls back to "not installed" only when there is nothing to report', () => {
    // A command that was never found produces no stderr at all — that, and only
    // that, is the case where "install Node" is the right advice.
    expect(describeNodeFailure('')).toMatch(/not installed or not on PATH/)
    expect(describeNodeFailure('   \n  ')).toMatch(/not installed or not on PATH/)
  })
})

describe('evaluateNodeVersion', () => {
  it('accepts the supported range', () => {
    expect(evaluateNodeVersion('v24.16.0').ok).toBe(true)
    expect(evaluateNodeVersion('v24.99.0').ok).toBe(true)
    expect(evaluateNodeVersion('v26.1.0').ok).toBe(true)
  })

  it('rejects unsupported OpenClaw engine ranges', () => {
    for (const version of ['v22.23.1', 'v24.15.9', 'v25.9.0', 'v26.0.0']) {
      const result = evaluateNodeVersion(version)
      expect(result.ok, version).toBe(false)
      expect(result.warning).toMatch(/not supported/)
    }
  })

  it('warns rather than blocks above the tested range', () => {
    const newer = evaluateNodeVersion('v27.0.0')
    expect(newer.ok).toBe(true)
    expect(newer.warning).toMatch(/newer than/)
  })

  it('does not pretend to understand junk', () => {
    expect(evaluateNodeVersion('not a version').ok).toBe(false)
  })
})
