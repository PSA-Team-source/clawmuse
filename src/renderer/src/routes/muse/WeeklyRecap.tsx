import { useState } from 'react'
import { MoreHorizontalIcon, Share08Icon, Target02Icon } from '@hugeicons/core-free-icons'
import { IconButton } from '@/components/brand'
import { Icon, Menu } from '@/components/primitives'
import { useAssistantStore } from '@/stores/assistant.store'
import { shareCard } from '@/stores/share-card.store'
import { failureNotice } from '@/lib/failure-notice'
import { recapStats, weekLabel, type WeeklyRecap } from '@shared/recap'

/** How long a recap stays on the Feed: until the week after the one it covers is over. */
const SHOWN_FOR_MS = 7 * 24 * 3600_000

function shareRecap(recap: WeeklyRecap): void {
  shareCard({
    kind: 'recap',
    title: 'My week with ClawMuse',
    body: `${recap.text}\n\n**Focus for the week ahead:** ${recap.focus}`,
    source: weekLabel(recap.facts),
    stats: recapStats(recap.facts),
  })
}

/** The Feed header's "Generate now" for the Weekly Recap. */
export function RecapButton() {
  const assistant = useAssistantStore((store) => store.state)
  const job = assistant?.jobs.recap
  return (
    <button type="button" onClick={() => void window.clawmuse.assistant.run('recap')} disabled={Boolean(job?.running) || !assistant?.available} className="h-9 rounded-full bg-fill-strong px-3.5 text-body-sm font-medium text-content-primary hover:bg-fill-stronger disabled:opacity-50">
      {job?.running ? 'Recapping…' : 'Recap my week'}
    </button>
  )
}

/**
 * The latest Weekly Recap at the top of the Feed: the week's real numbers, the
 * assistant's look back and one focus for the week ahead. Nothing shows until
 * a recap exists; a recap is never written for an empty week.
 */
export function WeeklyRecapSection({ progress }: { progress: (label: string, onStop: () => void) => React.ReactNode }) {
  const assistant = useAssistantStore((store) => store.state)
  const job = assistant?.jobs.recap
  const recap = assistant?.recaps?.[0]
  // Read once per visit to the Feed; a recap does not expire while it is on screen.
  const [now] = useState(() => Date.now())
  const current = recap && now - Date.parse(recap.facts.weekEnd) < SHOWN_FOR_MS ? recap : null
  const stats = current ? recapStats(current.facts) : []

  return (
    <>
      {job?.running && progress(job.running.phase, () => void window.clawmuse.assistant.stop('recap'))}
      {!job?.running && (job?.lastError || job?.note) && <p role={job.lastError ? 'alert' : 'status'} className="mb-6 text-body-sm text-content-secondary">{job.lastError ? failureNotice(job.lastError) : job.note}</p>}
      {current && <section aria-labelledby="weekly-recap" className="group relative mb-8 rounded-2xl border border-line-hairline bg-bg-panel p-5">
        <div className="flex items-baseline justify-between gap-3 pr-8">
          <h2 id="weekly-recap" className="muse-section-title text-content-primary">Your week</h2>
          <span className="text-footnote text-content-tertiary">{weekLabel(current.facts)}</span>
        </div>
        <Menu align="end" trigger={<IconButton icon={MoreHorizontalIcon} label="Weekly recap options" size="sm" className="absolute right-3 top-3" />}>
          <Menu.Item onClick={() => void navigator.clipboard.writeText(`${current.text}\n\nFocus for the week ahead: ${current.focus}`)}>Copy</Menu.Item>
          <Menu.Item onClick={() => shareRecap(current)}>Share</Menu.Item>
          <Menu.Item disabled={Boolean(job?.running) || !assistant?.available} onClick={() => void window.clawmuse.assistant.run('recap')}>Write it again</Menu.Item>
        </Menu>
        {stats.length > 0 && <ul aria-label="This week in numbers" className="mt-4 grid grid-cols-3 gap-2">
          {stats.map((stat) => <li key={stat.label} className="flex flex-col rounded-xl bg-fill-raised px-3 py-2.5">
            <span className="text-title-3 font-semibold tabular-nums text-content-primary">{stat.value.toLocaleString()}</span>
            <span className="text-footnote text-content-secondary">{stat.label}</span>
          </li>)}
        </ul>}
        <p className="mt-4 text-body text-content-primary">{current.text}</p>
        <p className="mt-3 flex items-start gap-2 text-body-sm text-content-primary"><Icon icon={Target02Icon} size={18} className="mt-0.5 shrink-0 text-muse-blue" /><span><span className="font-semibold">Focus for the week ahead: </span>{current.focus}</span></p>
        <div className="mt-4 flex items-center gap-4 text-body-sm font-medium text-content-secondary">
          <button type="button" onClick={() => shareRecap(current)} className="flex items-center gap-2 hover:text-content-primary"><Icon icon={Share08Icon} size={20} className="text-current" />Share</button>
        </div>
      </section>}
    </>
  )
}
