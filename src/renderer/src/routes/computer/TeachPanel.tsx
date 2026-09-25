import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RecordIcon, StopIcon } from '@hugeicons/core-free-icons'
import { GhostButton, GradientButton, PillButton } from '@/components/brand'
import { BotAvatar } from '@/components/chat'
import { TextField, useToast } from '@/components/patterns'
import { Dialog, Icon } from '@/components/primitives'
import { botMainSessionKey } from '@/services/session-key'
import { MAX_RECORDING_MS, type Recorder, type Recording, type TeachStep, startRecording, teachPrompt } from '@/services/teach'
import { useBotsStore } from '@/stores/bots.store'
import { useChatStore } from '@/stores/chat.store'
import { cn } from '@/lib/cn'

/**
 * Show a bot how something is done, once.
 *
 * The recording is a trail of pages, not a click-by-click capture, and the copy
 * here says so — the value is in the sequence, and overselling it would only
 * cost trust the first time the draft skipped a click nobody recorded.
 *
 * What comes out is a *proposal* the bot writes through Skill Workshop, which
 * the user reviews before anything becomes a live skill.
 */
export function TeachPanel() {
  const navigate = useNavigate()
  const { show } = useToast()
  const bots = useBotsStore((state) => state.bots)
  const sendMessage = useChatStore((state) => state.sendMessage)

  const recorder = useRef<Recorder | null>(null)
  const [steps, setSteps] = useState<TeachStep[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [recording, setRecording] = useState(false)
  const [result, setResult] = useState<Recording | null>(null)
  const [name, setName] = useState('')
  const [botId, setBotId] = useState<string | null>(null)

  // Read from the wall clock rather than counted up, so a sleeping Mac does not
  // leave a recording that thinks it is two minutes old after an hour.
  const stopRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    if (!recording) return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt
      setElapsed(ms)
      // The ten-minute stop. A recorder left running until the user remembered
      // it would hand the model an hour of unrelated browsing.
      if (ms >= MAX_RECORDING_MS) stopRef.current()
    }, 1_000)
    return () => clearInterval(timer)
  }, [recording])

  // An interval that outlives the screen keeps polling a browser nobody is
  // watching.
  useEffect(
    () => () => {
      recorder.current?.stop()
    },
    [],
  )

  function start(): void {
    setSteps([])
    setElapsed(0)
    setResult(null)
    recorder.current = startRecording(setSteps)
    setRecording(true)
  }

  stopRef.current = stop

  function stop(): void {
    const finished = recorder.current?.stop() ?? null
    recorder.current = null
    setRecording(false)
    setResult(finished)
    setBotId((current) => current ?? bots[0]?.id ?? null)
  }

  function teach(): void {
    if (!result || !botId || !name.trim()) return
    void sendMessage(botMainSessionKey(botId), teachPrompt(result, name.trim()))
    setResult(null)
    setName('')
    show({ title: 'Sent — it will come back with a draft', variant: 'success' })
    navigate(`/chat/${encodeURIComponent(botMainSessionKey(botId))}`)
  }

  const minutes = Math.floor(elapsed / 60_000)
  const seconds = Math.floor((elapsed % 60_000) / 1000)

  return (
    <>
      {recording ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-caption text-error">
            <span className="size-2 animate-pulse rounded-full bg-error" />
            {minutes}:{String(seconds).padStart(2, '0')} · {steps.length} page
            {steps.length === 1 ? '' : 's'}
          </span>
          <GhostButton size="sm" onClick={stop}>
            <span className="flex items-center gap-1.5">
              <Icon icon={StopIcon} size={13} />
              Stop
            </span>
          </GhostButton>
        </div>
      ) : (
        <PillButton onClick={start} disabled={bots.length === 0}>
          <Icon icon={RecordIcon} size={13} className="text-current" />
          Teach a task
        </PillButton>
      )}

      {result && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setResult(null)
          }}
          title="Teach this to a bot"
          description={`${result.steps.length} page${result.steps.length === 1 ? '' : 's'} over ${Math.round(result.durationMs / 1000)}s. This is the trail you took, not a click-by-click recording — the bot will infer the steps and tell you what it inferred.`}
        >
          <div className="flex flex-col gap-4">
            <TextField
              label="What is this task called?"
              value={name}
              onChange={setName}
              placeholder="Export last month's invoices"
              autoFocus
            />

            <div className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-content-tertiary">Who learns it</span>
              <div className="max-h-48 overflow-y-auto rounded-box border border-line">
                {bots.map((bot) => (
                  <button
                    key={bot.id}
                    type="button"
                    onClick={() => setBotId(bot.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                      bot.id === botId ? 'bg-fill-accent' : 'hover:bg-fill-raised',
                    )}
                  >
                    <BotAvatar
                      id={bot.id}
                      name={bot.name}
                      emoji={bot.emoji}
                      avatar={bot.avatar}
                      size={24}
                    />
                    <span className="truncate text-body-sm text-content-primary">{bot.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <p className="text-caption text-content-faint">
              It comes back with a draft skill for you to approve — nothing becomes live on its own.
            </p>

            <div className="flex justify-end gap-2">
              <GhostButton onClick={() => setResult(null)}>Discard</GhostButton>
              <GradientButton onClick={teach} disabled={!name.trim() || !botId}>
                Send it
              </GradientButton>
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}
