import { describe, expect, it } from 'vitest'
import { MAX_RECORDING_MS, teachPrompt, type Recording } from '@/services/teach'

const recording: Recording = {
  startedAt: 0,
  durationMs: 95_000,
  steps: [
    { offsetMs: 0, url: 'https://billing.example.com/', title: 'Billing' },
    { offsetMs: 42_000, url: 'https://billing.example.com/invoices?month=07' },
  ],
  requests: ['POST https://billing.example.com/api/exports'],
}

describe('teachPrompt', () => {
  it('lists the trail with timings', () => {
    const prompt = teachPrompt(recording, 'Export invoices')
    expect(prompt).toContain('1. 0:00 https://billing.example.com/ — Billing')
    expect(prompt).toContain('2. 0:42 https://billing.example.com/invoices?month=07')
  })

  it('names the task the user gave it', () => {
    expect(teachPrompt(recording, 'Export invoices')).toContain('"Export invoices"')
  })

  it('includes the traffic the pages made', () => {
    expect(teachPrompt(recording, 'x')).toContain('POST https://billing.example.com/api/exports')
  })

  it('asks for a proposal, never a live skill', () => {
    // Skill Workshop's contract is proposal-first: apply is the only write, and
    // it re-runs the scanner. A prompt that asked for a skill directly would
    // route around the one review step in the whole feature.
    const prompt = teachPrompt(recording, 'x')
    expect(prompt).toContain('skill_workshop')
    expect(prompt).toMatch(/PROPOSAL/)
    expect(prompt).toMatch(/do not write an active skill/i)
  })

  it('asks what the draft still cannot decide', () => {
    // A recording shows the happy path exactly once. Every branch — the missing
    // record, the expired login — is invisible in it.
    const prompt = teachPrompt(recording, 'x')
    expect(prompt).toMatch(/missing or looks wrong/i)
    expect(prompt).toMatch(/stop and ask/i)
  })

  it('is honest that this is a trail, not a click recording', () => {
    expect(teachPrompt(recording, 'x')).toMatch(/not a click-by-click recording/i)
  })

  it('says so plainly when nothing was captured', () => {
    const empty = { ...recording, steps: [], requests: [] }
    expect(teachPrompt(empty, 'x')).toMatch(/no pages captured/i)
  })
})

describe('the recording cap', () => {
  it('is ten minutes', () => {
    expect(MAX_RECORDING_MS).toBe(10 * 60_000)
  })
})
