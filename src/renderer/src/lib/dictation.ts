/** The rate OpenClaw's transcription path is exercised with; Whisper resamples to 16 kHz anyway. */
export const DICTATION_SAMPLE_RATE = 16_000

/** Mono float samples → a 16-bit PCM RIFF/WAVE file. */
export function encodeWav(samples: Float32Array, sampleRate = DICTATION_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

export interface DictationRecording {
  /** Stops the microphone and returns the take as WAV. */
  stop: () => Uint8Array
  /** Stops the microphone and discards the take. */
  cancel: () => void
}

/**
 * Opens the microphone and buffers 16 kHz mono samples until stopped.
 *
 * ponytail: ScriptProcessorNode is deprecated but still shipped by Chromium and
 * needs no worklet module file; move to an AudioWorklet if Chromium drops it.
 */
export async function startDictationRecording(deviceId = ''): Promise<DictationRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } })
  const context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE })
  const sampleRate = context.sampleRate
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  source.connect(processor)
  processor.connect(context.destination)

  const release = () => {
    processor.onaudioprocess = null
    source.disconnect()
    processor.disconnect()
    for (const track of stream.getTracks()) track.stop()
    void context.close()
  }

  return {
    stop() {
      release()
      const samples = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        samples.set(chunk, offset)
        offset += chunk.length
      }
      return encodeWav(samples, sampleRate)
    },
    cancel: release,
  }
}

/**
 * Muse's "Play audio cues": a short rising tone when listening starts and a
 * falling one when it stops. Synthesised, so there is no asset to ship.
 */
export function playDictationCue(kind: 'start' | 'stop'): void {
  try {
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const [from, to] = kind === 'start' ? [660, 880] : [880, 660]
    const now = context.currentTime
    oscillator.frequency.setValueAtTime(from, now)
    oscillator.frequency.linearRampToValueAtTime(to, now + 0.12)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.18)
    oscillator.onended = () => void context.close()
  } catch {
    // Audio output unavailable — the cue is a courtesy, dictation still works.
  }
}
