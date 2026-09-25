import { gatewayWS } from '@/services/gateway-ws.service'

/**
 * Word-by-word dictation over OpenClaw's talk session in "transcription" mode
 * (transport gateway-relay, brain none). The relay takes G.711 µ-law at 8 kHz
 * mono, base64, and streams back cumulative partials and final transcripts on
 * `talk.event`. Needs a streaming transcription provider (OpenAI realtime,
 * xAI, Deepgram…) configured under plugins.entries.voice-call.config.streaming;
 * without one the composer uses the record-then-transcribe path instead.
 */

const SAMPLE_RATE = 8000
const FRAME_BYTES = 800 // 100 ms
const FINAL_GRACE_MS = 1500

interface CatalogProvider { id: string; label?: string; configured?: boolean }
interface TalkCatalog { transcription?: { providers?: CatalogProvider[] } }

/** Streaming transcription providers, with whether each has credentials. */
export async function liveTranscriptionProviders(): Promise<CatalogProvider[]> {
  const catalog = await gatewayWS.call<TalkCatalog>('talk.catalog', {})
  return catalog.transcription?.providers ?? []
}

export async function liveTranscriptionReady(): Promise<boolean> {
  return (await liveTranscriptionProviders().catch(() => [])).some((provider) => provider.configured)
}

/** Standard G.711 µ-law encoding of one 16-bit linear sample. */
export function linearToMulaw(sample: number): number {
  const BIAS = 0x84
  const CLIP = 32635
  let value = Math.max(-32768, Math.min(32767, Math.round(sample)))
  const sign = value < 0 ? 0x80 : 0
  if (value < 0) value = -value
  if (value > CLIP) value = CLIP
  value += BIAS
  let exponent = 7
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) exponent--
  const mantissa = (value >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export interface LiveDictation {
  /** Stops listening, waits briefly for the last words, and returns the whole transcript. */
  stop: () => Promise<string>
  cancel: () => void
}

export async function startLiveDictation(options: { deviceId?: string; onText: (text: string) => void; onError: (message: string) => void }): Promise<LiveDictation> {
  const created = await gatewayWS.call<{ transcriptionSessionId?: string; sessionId?: string }>('talk.session.create', { mode: 'transcription', transport: 'gateway-relay', brain: 'none' })
  const sessionId = created.transcriptionSessionId ?? created.sessionId
  if (!sessionId) throw new Error('The gateway did not open a transcription session')

  const finals: string[] = []
  let partial = ''
  let closed = false
  let settle: (() => void) | null = null
  const current = () => [...finals, partial].filter(Boolean).join(' ')

  const unsubscribe = gatewayWS.on('event', (frame) => {
    if (frame.event !== 'talk.event') return
    const payload = (frame.payload ?? frame.data) as { transcriptionSessionId?: string; type?: string; text?: string; final?: boolean; message?: string } | undefined
    if (!payload || payload.transcriptionSessionId !== sessionId) return
    if (payload.type === 'partial' && typeof payload.text === 'string') {
      partial = payload.text // cumulative for the turn: replace, don't append
      options.onText(current())
    } else if (payload.type === 'transcript' && payload.final && payload.text) {
      finals.push(payload.text.trim())
      partial = ''
      options.onText(current())
      settle?.()
    } else if (payload.type === 'error') {
      options.onError(payload.message ?? 'Transcription failed')
    }
  })

  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}) } })
  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(1024, 1, 1)
  let pending: number[] = []
  processor.onaudioprocess = (event) => {
    for (const sample of event.inputBuffer.getChannelData(0)) pending.push(linearToMulaw(sample * 32767))
    while (pending.length >= FRAME_BYTES) {
      const frame = Uint8Array.from(pending.slice(0, FRAME_BYTES))
      pending = pending.slice(FRAME_BYTES)
      void gatewayWS.call('talk.session.appendAudio', { sessionId, audioBase64: toBase64(frame) }).catch(() => undefined)
    }
  }
  source.connect(processor)
  processor.connect(context.destination)

  const release = () => {
    processor.onaudioprocess = null
    source.disconnect()
    processor.disconnect()
    for (const track of stream.getTracks()) track.stop()
    void context.close()
  }
  const close = () => {
    if (closed) return
    closed = true
    unsubscribe()
    void gatewayWS.call('talk.session.close', { sessionId }).catch(() => undefined)
  }

  return {
    async stop() {
      release()
      // Closing does not flush the provider: give an in-flight turn a moment to finalise.
      if (partial) await new Promise<void>((resolve) => { settle = resolve; setTimeout(resolve, FINAL_GRACE_MS) })
      const text = current()
      close()
      return text
    },
    cancel() {
      release()
      close()
    },
  }
}
