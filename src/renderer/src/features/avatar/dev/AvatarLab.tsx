/**
 * Dev-only avatar workbench (`#/dev/avatar`). Registered in App.tsx behind
 * `import.meta.env.DEV`, so production builds drop the route and this chunk.
 *
 * Also exposes `window.__avatarLab` so CDP scripts can drive states, run
 * exports and read frame timings without clicking.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AVATAR_ACCESSORIES,
  AVATAR_REACTIONS,
  AVATAR_STATES,
  AVATAR_STYLES,
  AvatarBadge,
  AvatarStage,
  CLAWMUSE_CORAL,
  createTalkMeter,
  exportClip,
  exportGif,
  exportPng,
  type AvatarAccessory,
  type AvatarConfig,
  type AvatarController,
  type AvatarState,
  type AvatarStyle,
  type StageStats,
} from '@/features/avatar'

const BADGE_SIZES = [24, 32, 40, 48, 64, 80, 100]
const BADGE_CAST: { config: AvatarConfig; state: AvatarState }[] = [
  { config: {}, state: 'idle' },
  { config: { style: 'mage', seed: 'kira' }, state: 'talking' },
  { config: { style: 'striker', seed: 'blaze', accessory: 'cap' }, state: 'idle' },
  { config: { style: 'sentinel', seed: 'nova' }, state: 'working' },
  { config: { style: 'healer', seed: 'sage', accessory: 'crown' }, state: 'waving' },
  { config: { seed: 'muse-2', accessory: 'headphones' }, state: 'thinking' },
  { config: { seed: 'muse-3', accessory: 'glasses', colors: { outfit: '#5B7CFF' } }, state: 'celebrating' },
  { config: { style: 'mage', seed: 'orbit', accessory: 'glasses' }, state: 'sleeping' },
  { config: { style: 'striker', seed: 'volt', accessory: 'headphones' }, state: 'talking' },
  { config: { style: 'healer', seed: 'fern' }, state: 'idle' },
]

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

const button =
  'rounded-button border border-line px-3 py-1.5 text-footnote text-content-primary hover:bg-fill-raised data-[on=true]:border-primary data-[on=true]:bg-fill-accent'

export default function AvatarLab() {
  const [state, setState] = useState<AvatarState>('idle')
  const [style, setStyle] = useState<AvatarStyle>('muse')
  const [accessory, setAccessory] = useState<AvatarAccessory>('none')
  const [outfit, setOutfit] = useState(CLAWMUSE_CORAL)
  const [seed, setSeed] = useState('clawmuse')
  const [talk, setTalk] = useState(0)
  const [streaming, setStreaming] = useState(false)
  const [badges, setBadges] = useState(true)
  const [stats, setStats] = useState<StageStats | null>(null)
  const [hub, setHub] = useState<{ tickMs: number; entries: number; badges: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lastExport, setLastExport] = useState<{ kind: string; url: string; bytes: number } | null>(null)
  const avatarRef = useRef<AvatarController | null>(null)
  const statsRef = useRef<() => StageStats>(() => ({ frameMs: 0, intervalMs: 0, frames: 0 }))
  const config = useMemo<AvatarConfig>(() => ({ style, accessory, seed, colors: { outfit } }), [style, accessory, seed, outfit])

  // Simulated token stream → talk meter → mouth, the way chat would feed it.
  useEffect(() => {
    if (!streaming) return
    const meter = createTalkMeter()
    let raf = 0
    const words = setInterval(() => {
      if (Math.random() > 0.15) meter.push(4 + Math.floor(Math.random() * 18))
    }, 90)
    const tick = () => {
      avatarRef.current?.setTalkLevel(meter.level())
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      clearInterval(words)
      cancelAnimationFrame(raf)
      avatarRef.current?.setTalkLevel(0)
    }
  }, [streaming])

  useEffect(() => {
    const id = setInterval(async () => {
      setStats(statsRef.current())
      const { getBadgeHub } = await import('../badge-hub')
      setHub(getBadgeHub().stats())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const runExport = async (kind: 'png' | 'webm' | 'gif') => {
    setBusy(kind)
    try {
      const blob =
        kind === 'png'
          ? await exportPng(config, { state, size: 512 })
          : kind === 'gif'
            ? await exportGif(config, { state, size: 256, seconds: 2, fps: 15 })
            : await exportClip(config, { state, size: 512, seconds: 3, fps: 30 })
      if (lastExport) URL.revokeObjectURL(lastExport.url)
      setLastExport({ kind, url: URL.createObjectURL(blob), bytes: blob.size })
    } finally {
      setBusy(null)
    }
  }

  // Automation hook for CDP-driven verification.
  useEffect(() => {
    const api = {
      setState,
      setStyle,
      setAccessory,
      setSeed,
      setOutfit,
      setBadges,
      react: (kind: (typeof AVATAR_REACTIONS)[number], dir?: number) => avatarRef.current?.react(kind, dir),
      setTalk: (n: number) => avatarRef.current?.setTalkLevel(n),
      lookAt: (x: number, y: number) => avatarRef.current?.lookAt(x, y),
      stageStats: () => statsRef.current(),
      badgeStats: async () => (await import('../badge-hub')).getBadgeHub().stats(),
      resetBadgeStats: async () => (await import('../badge-hub')).getBadgeHub().resetStats(),
      exportPng: async (cfg: AvatarConfig, opts: Parameters<typeof exportPng>[1]) => blobToDataUrl(await exportPng(cfg, opts)),
      exportGif: async (cfg: AvatarConfig, opts: Parameters<typeof exportGif>[1]) => blobToDataUrl(await exportGif(cfg, opts)),
      exportClip: async (cfg: AvatarConfig, opts: Parameters<typeof exportClip>[1]) => {
        const blob = await exportClip(cfg, opts)
        return { type: blob.type, dataUrl: await blobToDataUrl(blob) }
      },
    }
    ;(window as unknown as { __avatarLab?: typeof api }).__avatarLab = api
    return () => {
      delete (window as unknown as { __avatarLab?: typeof api }).__avatarLab
    }
  }, [])

  return (
    <div className="flex h-full w-full gap-6 overflow-auto bg-bg-base p-6 text-content-primary">
      <div className="flex shrink-0 flex-col gap-3">
        <AvatarStage
          config={config}
          state={state}
          talkLevel={streaming ? undefined : talk}
          className="h-[520px] w-[420px] rounded-card border border-line"
          onReady={(avatar, s) => {
            avatarRef.current = avatar
            statsRef.current = s
          }}
        />
        <p className="text-caption text-content-muted" data-testid="stage-stats">
          {stats
            ? `stage: ${stats.frameMs.toFixed(2)} ms/frame CPU · ${stats.intervalMs ? (1000 / stats.intervalMs).toFixed(0) : '–'} fps · ${stats.frames} frames`
            : ''}
          {hub ? ` · badges: ${hub.tickMs.toFixed(2)} ms/tick, ${hub.entries} renders for ${hub.badges} badges` : ''}
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h2 className="text-headline">State</h2>
          <div className="flex flex-wrap gap-2">
            {AVATAR_STATES.map((s) => (
              <button key={s} className={button} data-on={state === s} onClick={() => setState(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {AVATAR_REACTIONS.map((r) => (
              <button key={r} className={button} onClick={() => avatarRef.current?.react(r, 1)}>
                {r}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-footnote">
            talk level
            <input type="range" min={0} max={1} step={0.01} value={talk} onChange={(e) => setTalk(Number(e.target.value))} />
            <button className={button} data-on={streaming} onClick={() => setStreaming((v) => !v)}>
              simulate stream
            </button>
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-headline">Config</h2>
          <div className="flex flex-wrap items-center gap-3 text-footnote">
            <select className="rounded-field border border-line bg-bg-input px-2 py-1" value={style} onChange={(e) => setStyle(e.target.value as AvatarStyle)}>
              {AVATAR_STYLES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select className="rounded-field border border-line bg-bg-input px-2 py-1" value={accessory} onChange={(e) => setAccessory(e.target.value as AvatarAccessory)}>
              {AVATAR_ACCESSORIES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <input type="color" value={outfit} onChange={(e) => setOutfit(e.target.value)} />
            <input className="rounded-field border border-line bg-bg-input px-2 py-1" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-headline">Export</h2>
          <div className="flex flex-wrap items-center gap-2">
            {(['png', 'gif', 'webm'] as const).map((k) => (
              <button key={k} className={button} disabled={!!busy} onClick={() => void runExport(k)}>
                {busy === k ? `${k}…` : k}
              </button>
            ))}
            {lastExport && (
              <span className="text-caption text-content-muted">
                {lastExport.kind} · {(lastExport.bytes / 1024).toFixed(0)} KB
              </span>
            )}
          </div>
          {lastExport &&
            (lastExport.kind === 'webm' ? (
              <video src={lastExport.url} autoPlay loop muted className="h-40 w-40 rounded-card border border-line" />
            ) : (
              <img src={lastExport.url} alt="" className="h-40 w-40 rounded-card border border-line" />
            ))}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-headline">
            Badges{' '}
            <button className={button} data-on={badges} onClick={() => setBadges((v) => !v)}>
              {badges ? 'on' : 'off'}
            </button>
          </h2>
          {badges && (
            <>
              <div className="flex items-end gap-3">
                {BADGE_SIZES.map((size) => (
                  <AvatarBadge key={size} config={config} state={state} size={size} />
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3" data-testid="badge-cast">
                {BADGE_CAST.map((b, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <AvatarBadge config={b.config} state={b.state} size={64} className="rounded-full bg-fill" />
                    <span className="text-caption text-content-muted">{b.state}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
