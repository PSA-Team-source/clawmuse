import { useEffect, useMemo, useRef, useState } from 'react'
import { createTalkMeter, type AvatarState } from './animator'

/** Badges draw at 12 fps (badge-hub's BADGE_FPS — not imported: that module pulls in three.js). */
const SAMPLE_MS = 1000 / 12

/**
 * Mouth movement from a streaming reply: feeds the growth of `text` (streamed
 * text is cumulative) into a talk meter and samples it while `state` is
 * talking. 0 otherwise.
 */
export function useTalkLevel(state: AvatarState, text: string): number {
  const meter = useMemo(() => createTalkMeter(), [])
  // Text already on screen when this starts listening is not new speech.
  const seen = useRef(text.length)
  const [talk, setTalk] = useState(0)
  useEffect(() => {
    const grown = text.length - seen.current
    seen.current = text.length
    if (grown > 0) meter.push(grown)
  }, [text, meter])
  useEffect(() => {
    if (state !== 'talking') return
    const timer = setInterval(() => setTalk(Math.round(meter.level() * 20) / 20), SAMPLE_MS)
    return () => clearInterval(timer)
  }, [state, meter])
  return state === 'talking' ? talk : 0
}
