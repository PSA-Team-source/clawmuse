import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DictationResult } from '@shared/ipc'
import { run } from './exec.js'
import { PROFILE, openclawEnv } from './paths.js'
import { resolveOpenclaw } from './resolve.js'

/**
 * Dictation = OpenClaw's own `infer audio transcribe`, with whatever
 * audio-understanding model the user's provider serves (OpenRouter routes it to
 * Whisper). Chromium's webkitSpeechRecognition has no backend inside Electron —
 * it fails with `network` — and OpenClaw's live talk transcription needs a
 * separate streaming provider, so this is the path that works on the key the
 * user already configured.
 *
 * ponytail: one CLI spawn per utterance (~5s of process start on top of the
 * model call). The upgrade is a gateway RPC for audio.transcribe if OpenClaw
 * ever exposes one, or talk.session transcription when a streaming provider
 * is configured.
 */

/** 16 kHz mono PCM16 is 32 KB/s — 25 MB is ~13 minutes, well past any utterance. */
export const MAX_DICTATION_BYTES = 25 * 1024 * 1024

interface CliOutput {
  ok?: boolean
  outputs?: { text?: string }[]
  error?: { message?: string } | string
}

/** The CLI prints JSON even when it fails; read the reason from it, not stderr noise. */
export function parseTranscribeOutput(stdout: string): DictationResult {
  const start = stdout.indexOf('{')
  if (start < 0) return { ok: false, error: 'Transcription produced no result' }
  let data: CliOutput
  try {
    data = JSON.parse(stdout.slice(start)) as CliOutput
  } catch {
    return { ok: false, error: 'Transcription produced an unreadable result' }
  }
  if (data.ok) {
    const text = (data.outputs ?? []).map((output) => output.text?.trim() ?? '').filter(Boolean).join(' ')
    return { ok: true, text }
  }
  const reason = typeof data.error === 'string' ? data.error : data.error?.message
  return { ok: false, error: reason || 'Transcription failed' }
}

export async function transcribeDictation(wav: unknown, language: unknown): Promise<DictationResult> {
  if (!(wav instanceof Uint8Array) || wav.byteLength < 44) return { ok: false, error: 'No audio was recorded' }
  if (wav.byteLength > MAX_DICTATION_BYTES) return { ok: false, error: 'That recording is too long to transcribe' }
  // RIFF....WAVE — only the WAV the composer encodes is accepted at this boundary.
  const header = Buffer.from(wav.buffer, wav.byteOffset, 12).toString('latin1')
  if (!header.startsWith('RIFF') || header.slice(8) !== 'WAVE') return { ok: false, error: 'Unsupported audio format' }

  const openclaw = (await resolveOpenclaw())?.bin
  if (!openclaw) return { ok: false, error: 'The local agent is not installed yet' }

  const dir = await mkdtemp(join(tmpdir(), 'clawmuse-dictation-'))
  const file = join(dir, 'dictation.wav')
  try {
    await writeFile(file, wav)
    const args = ['--profile', PROFILE, 'infer', 'audio', 'transcribe', '--file', file, '--json']
    if (typeof language === 'string' && /^[a-z]{2,3}$/i.test(language)) args.push('--language', language.toLowerCase())
    const result = await run(openclaw, args, { env: openclawEnv(), timeoutMs: 90_000 })
    if (result.timedOut) return { ok: false, error: 'Transcription timed out' }
    return parseTranscribeOutput(result.stdout)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
