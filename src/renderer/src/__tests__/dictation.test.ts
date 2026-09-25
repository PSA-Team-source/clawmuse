import { describe, expect, it, vi } from 'vitest'
import { encodeWav } from '@/lib/dictation'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('electron-log/main.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))

const { parseTranscribeOutput } = await import('../../../main/services/local-runtime/dictation')

describe('dictation', () => {
  it('encodes mono PCM16 WAV with a correct header and clamped samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
    const view = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(40, true)).toBe(8)
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767])
  })

  it('reads text or the CLI’s own error from --json output, ignoring log noise', () => {
    expect(parseTranscribeOutput('[config] warning\n{"ok":true,"outputs":[{"text":" Hello there. "}]}')).toEqual({ ok: true, text: 'Hello there.' })
    expect(parseTranscribeOutput('{"ok":false,"error":{"type":"cli_error","message":"No audio provider"}}')).toEqual({ ok: false, error: 'No audio provider' })
    expect(parseTranscribeOutput('boom')).toEqual({ ok: false, error: 'Transcription produced no result' })
  })
})
