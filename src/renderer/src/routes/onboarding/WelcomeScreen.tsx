import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase01Icon, Dollar01Icon, FavouriteIcon, LaptopIcon, PaintBoardIcon, UserGroupIcon, Book02Icon, Rocket01Icon } from '@hugeicons/core-free-icons'
import { GhostButton, GradientButton } from '@/components/brand'
import { AvatarCompanion } from '@/features/avatar'
import { Icon } from '@/components/primitives'
import { cn } from '@/lib/cn'
import { GOALS_KEY, WELCOMED_KEY, readGoals, type Goal } from '@/lib/goals'
import { GOAL_PACKS, goalsFromPack, type GoalPack } from '@/lib/goal-packs'

/** Areas of life; picking one without writing anything still gives the assistant a real goal to work around. */
const AREAS = [
  { label: 'Health', icon: FavouriteIcon, goal: 'Get healthier and build better daily habits' },
  { label: 'Career', icon: Briefcase01Icon, goal: 'Grow my career' },
  { label: 'Business', icon: Rocket01Icon, goal: 'Grow my business' },
  { label: 'Money', icon: Dollar01Icon, goal: 'Get my finances in order' },
  { label: 'Relationships', icon: UserGroupIcon, goal: 'Spend more time with the people who matter to me' },
  { label: 'Learning', icon: Book02Icon, goal: 'Learn something new' },
  { label: 'Creative', icon: PaintBoardIcon, goal: 'Make more time for creative work' },
  { label: 'Productivity', icon: LaptopIcon, goal: 'Get more done with less stress' },
] as const

/** Two jumps of the celebration (0.9 s each) before the chat opens. */
const CELEBRATE_MS = 1800

/**
 * The first thing ClawMuse asks a new user, once, right after a model is set
 * up: what they are working toward. Feed, Ideas and check-ins are all built
 * around open goals, so without this a new install has nothing to be
 * proactive about. Answers become real goals (editable in Goals); skipping is
 * always one click.
 */
export default function WelcomeScreen() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [areas, setAreas] = useState<Set<string>>(new Set())
  const [celebrating, setCelebrating] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }, [])

  function toggle(label: string): void {
    const next = new Set(areas)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    setAreas(next)
  }

  /** `pack`: a starter pack picked with one click — its goals, instead of the form's. */
  function finish(save: boolean, pack?: GoalPack): void {
    if (celebrating) return
    const now = new Date().toISOString()
    const written = text.split('\n').map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim()).filter((line) => line.length > 2).slice(0, 5)
    const picked = AREAS.filter((area) => areas.has(area.label)).map((area) => area.goal)
    const titles = save && !pack ? [...written, ...(written.length ? [] : picked)] : []
    const goals: Goal[] = pack
      ? goalsFromPack(pack, readGoals())
      : titles.map((title, index) => ({ id: `goal-welcome-${Date.now().toString(36)}-${index}`, title: title.slice(0, 200), completed: false, createdAt: now }))
    try {
      if (goals.length) localStorage.setItem(GOALS_KEY, JSON.stringify([...goals, ...readGoals()]))
      localStorage.setItem(WELCOMED_KEY, now)
    } catch { /* storage unavailable: nothing to remember, the chat still opens */ }
    if (goals.length) {
      window.dispatchEvent(new Event('clawmuse-goals-changed'))
      // Hand the goals to the assistant now (the usual sync is debounced), then
      // build the first Feed edition and Ideas around them straight away.
      window.clawmuse.assistant.syncContext({ goals: readGoals(), recentAsks: [], lastUserMessageAt: null, notificationsEnabled: true })
      void window.clawmuse.assistant.run('ideas')
      void window.clawmuse.assistant.run('feed')
      // Committing to goals earns a celebration before the chat opens —
      // skipped under reduced motion, where the jump would be the point.
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setCelebrating(true)
        leaveTimer.current = setTimeout(() => navigate('/chat', { replace: true }), CELEBRATE_MS)
        return
      }
    }
    navigate('/chat', { replace: true })
  }

  const ready = text.trim().length > 2 || areas.size > 0

  return (
    <div className="relative flex h-full w-full flex-col overflow-y-auto bg-bg-base">
      <div className="drag absolute inset-x-0 top-0 h-10" />
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-form flex-col items-center gap-6">
          <AvatarCompanion celebrate={celebrating} className="-mb-2" />
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="text-title-2 font-bold text-content-primary">What are you working toward?</h1>
            <p className="text-body-sm text-content-tertiary">Tell me what matters to you right now. I'll build your Feed, ideas and check-ins around it. You can change it any time in Goals.</p>
          </div>

          <section aria-labelledby="welcome-packs" className="w-full">
            <h2 id="welcome-packs" className="mb-1.5 text-footnote font-semibold uppercase text-content-tertiary">Start with a pack</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {GOAL_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  data-goal-pack={pack.id}
                  onClick={() => finish(true, pack)}
                  title={pack.goals.join('\n')}
                  className="flex min-h-[76px] flex-col items-start justify-between gap-2 rounded-2xl border border-line-hairline bg-bg-panel p-3 text-left transition-colors hover:bg-fill-raised focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-muse-blue"
                >
                  <Icon icon={pack.icon} size={20} className="text-content-secondary" />
                  <span className="flex w-full flex-col">
                    <span className="text-body-sm font-semibold leading-tight text-content-primary">{pack.label}</span>
                    <span className="text-caption text-content-tertiary">{pack.goals.length} goals</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="flex w-full items-center gap-3 text-footnote font-semibold uppercase text-content-tertiary">
            <span className="h-px flex-1 bg-line-hairline" />or pick areas<span className="h-px flex-1 bg-line-hairline" />
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {AREAS.map((area) => (
              <button
                key={area.label}
                type="button"
                aria-pressed={areas.has(area.label)}
                onClick={() => toggle(area.label)}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-body-sm font-medium transition-colors',
                  areas.has(area.label) ? 'border-transparent bg-content-primary text-bg-base' : 'border-line-hairline bg-bg-panel text-content-primary hover:bg-fill-raised',
                )}
              >
                <Icon icon={area.icon} size={16} className="text-current" />
                {area.label}
              </button>
            ))}
          </div>

          <div className="w-full">
            <label htmlFor="welcome-goal" className="mb-1.5 block text-footnote font-semibold uppercase text-content-tertiary">In your own words (optional)</label>
            <textarea
              id="welcome-goal"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              placeholder="e.g. Launch my online store before the holidays"
              className="block w-full resize-none rounded-2xl border border-line-hairline bg-bg-panel p-3 text-body text-content-primary outline-none focus-visible:ring-1 focus-visible:ring-muse-blue"
            />
            <p className="mt-1.5 text-footnote text-content-tertiary">One goal per line. Written goals are used as they are; otherwise the areas you picked become your goals.</p>
          </div>

          <div className="flex w-full items-center justify-between">
            <GhostButton size="sm" onClick={() => finish(false)}>Skip for now</GhostButton>
            <GradientButton disabled={!ready} onClick={() => finish(true)}>Continue</GradientButton>
          </div>
        </div>
      </div>
    </div>
  )
}
