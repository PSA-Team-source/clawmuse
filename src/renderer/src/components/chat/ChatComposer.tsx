import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react'
import { IconButton } from '@/components/brand'
import { ArrowUp02Icon, Add01Icon, Mic01Icon, StopIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/cn'
import { playDictationCue, startDictationRecording, type DictationRecording } from '@/lib/dictation'
import { liveTranscriptionReady, startLiveDictation, type LiveDictation } from '@/lib/live-dictation'
import { useSettingsStore } from '@/stores/settings.store'
import { useToast } from '@/components/patterns'

interface ChatComposerProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onAttach?: (files: File[]) => void
  onStop?: () => void
  isStreaming?: boolean
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

const MAX_HEIGHT_PX = 192 // Muse: max-h-48

/** Auto-growing composer: Enter sends, Shift+Enter newlines, paste-image and the attach button both hand off to `onAttach`. */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onAttach,
  onStop,
  isStreaming,
  disabled,
  placeholder = 'Message',
  autoFocus,
  className,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recordingRef = useRef<DictationRecording | null>(null)
  const liveRef = useRef<LiveDictation | null>(null)
  const valueRef = useRef(value)
  const [dictation, setDictation] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle')
  const toast = useToast()
  const dictationDeviceId = useSettingsStore((state) => state.dictationDeviceId)
  const dictationAutoSend = useSettingsStore((state) => state.dictationAutoSend)
  const dictationAudioCues = useSettingsStore((state) => state.dictationAudioCues)
  // Auto-send fires after the transcript lands in the parent's state, so it
  // must call the onSend from the render that already holds that text.
  const onSendRef = useRef(onSend)
  useLayoutEffect(() => { onSendRef.current = onSend })

  useEffect(() => {
    valueRef.current = value
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  useEffect(() => () => { recordingRef.current?.cancel(); liveRef.current?.cancel() }, [])

  const canSend = value.trim().length > 0 && !disabled

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!onAttach) return
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length > 0) onAttach(files)
  }

  function handleFilePick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) onAttach?.(files)
    e.target.value = '' // allow re-picking the same file
  }

  function applyTranscript(base: string, text: string): string {
    const next = `${base}${base && text && !base.endsWith(' ') ? ' ' : ''}${text}`
    valueRef.current = next
    onChange(next)
    return next
  }

  async function toggleDictation(): Promise<void> {
    if (dictation === 'recording' && liveRef.current) {
      const live = liveRef.current
      liveRef.current = null
      setDictation('transcribing')
      if (dictationAudioCues) playDictationCue('stop')
      await live.stop()
      setDictation('idle')
      textareaRef.current?.focus()
      if (dictationAutoSend && valueRef.current.trim()) requestAnimationFrame(() => onSendRef.current())
      return
    }
    if (dictation === 'recording') {
      const recording = recordingRef.current
      recordingRef.current = null
      if (!recording) return
      setDictation('transcribing')
      const wav = recording.stop()
      if (dictationAudioCues) playDictationCue('stop')
      const result = await window.clawmuse.dictation.transcribe(wav, navigator.language.split('-')[0])
      setDictation('idle')
      if (!result.ok) {
        toast.show({ title: 'Could not transcribe', description: result.error, variant: 'error' })
        return
      }
      if (!result.text) return
      const current = valueRef.current
      const next = `${current}${current && !current.endsWith(' ') ? ' ' : ''}${result.text}`
      valueRef.current = next
      onChange(next)
      textareaRef.current?.focus()
      if (dictationAutoSend) requestAnimationFrame(() => onSendRef.current())
      return
    }
    if (dictation !== 'idle') return
    setDictation('starting')
    // Word-by-word when a streaming transcription provider is configured.
    if (await liveTranscriptionReady()) {
      const base = valueRef.current
      try {
        liveRef.current = await startLiveDictation({
          deviceId: dictationDeviceId,
          onText: (text) => applyTranscript(base, text),
          onError: (message) => toast.show({ title: 'Live dictation stopped', description: message, variant: 'error' }),
        })
        setDictation('recording')
        if (dictationAudioCues) playDictationCue('start')
        return
      } catch (error) {
        liveRef.current = null
        toast.show({ title: 'Live dictation unavailable', description: error instanceof Error ? error.message : undefined, variant: 'error' })
        setDictation('idle')
        return
      }
    }
    try {
      recordingRef.current = await startDictationRecording(dictationDeviceId)
      setDictation('recording')
      if (dictationAudioCues) playDictationCue('start')
    } catch (error) {
      setDictation('idle')
      toast.show({ title: 'Microphone unavailable', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    }
  }

  return (
    <div className={cn('muse-composer flex items-center gap-2 border border-line-hairline bg-bg-panel p-3 shadow-composer', className)}>
      {onAttach && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.csv,.json"
            onChange={handleFilePick}
            className="hidden"
          />
          <IconButton
            icon={Add01Icon}
            size="sm"
            label="Attach files"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="text-content-primary"
          />
        </>
      )}

      <textarea
        ref={textareaRef}
        data-composer-input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={dictation === 'recording' ? 'Listening…' : dictation === 'transcribing' ? 'Transcribing…' : placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={1}
        maxLength={8000}
        className="selectable min-w-0 max-h-48 flex-1 resize-none bg-transparent text-content-primary outline-none placeholder:text-content-tertiary"
      />

      <IconButton
        icon={Mic01Icon}
        size="sm"
        label={dictation === 'recording' ? 'Stop dictation' : dictation === 'transcribing' ? 'Transcribing…' : 'Dictate a message'}
        onClick={() => void toggleDictation()}
        disabled={disabled || dictation === 'starting' || dictation === 'transcribing'}
        className={cn('text-content-primary', dictation === 'recording' && 'text-muse-blue', dictation === 'transcribing' && 'animate-pulse')}
      />

      {isStreaming ? (
        <IconButton
          icon={StopIcon}
          size="sm"
          label="Stop generating"
          onClick={onStop}
          shape="circle"
          className="muse-primary-action hover:scale-110"
        />
      ) : (
        <IconButton
          icon={ArrowUp02Icon}
          size="sm"
          label="Send message"
          onClick={onSend}
          disabled={!canSend}
          shape="circle"
          className="muse-primary-action"
        />
      )}
    </div>
  )
}
