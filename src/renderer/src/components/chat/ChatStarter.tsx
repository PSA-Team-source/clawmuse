import { useNavigate } from 'react-router-dom'
import { DEVICE } from '@/lib/platform'
import { Calendar03Icon, Clock01Icon, File01Icon, Target02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/primitives'
import { AvatarCompanion, type AvatarConfig } from '@/features/avatar'
import { prefillComposer } from '@/lib/composer-prefill'
import { readGoals } from '@/lib/goals'
import { useAgentIdentity } from '@/lib/identity'

/**
 * What an empty chat says to someone who has never used ClawMuse: who is
 * here, and four things that work on a fresh install — no connector, no
 * setup. A card fills the composer (never sends), so the user edits before
 * anything runs.
 */
const STARTERS = [
  { icon: Calendar03Icon, title: 'Plan my week', prompt: 'Help me plan my week. Ask me what is on my plate, then lay it out day by day.' },
  { icon: File01Icon, title: 'Summarize something', prompt: 'Summarize this for me in five bullet points:\n\n' },
  { icon: Clock01Icon, title: 'Remind me later', prompt: 'Remind me tomorrow at 9am to ' },
  { icon: Target02Icon, title: 'Help me with a goal', prompt: 'Help me set a clear goal. Ask me a few questions first, then suggest the first three steps.' },
] as const

export function ChatStarter({ avatar }: { avatar?: AvatarConfig }) {
  const identity = useAgentIdentity().data
  const navigate = useNavigate()
  const name = identity?.name?.trim()
  const hasGoal = readGoals().some((goal) => !goal.completed)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-6 text-center">
      <AvatarCompanion config={avatar} className="-mb-3" />
      <div className="flex flex-col gap-1.5">
        <h2 className="text-title-2 font-semibold text-content-primary">{name ? `Hi, I'm ${name}.` : 'Hi there.'}</h2>
        <p className="text-body text-content-secondary">I work on your {DEVICE}. Ask me anything, or hand me something to do.</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2.5">
        {STARTERS.map((starter) => (
          <button
            key={starter.title}
            type="button"
            onClick={() => prefillComposer(starter.prompt)}
            className="flex items-center gap-3 rounded-2xl border border-line-hairline bg-bg-panel px-4 py-3 text-left text-body font-medium text-content-primary transition-colors hover:bg-fill-raised"
          >
            <Icon icon={starter.icon} size={20} className="shrink-0 text-content-secondary" />
            {starter.title}
          </button>
        ))}
      </div>
      {!hasGoal && (
        <p className="text-body-sm text-content-tertiary">
          Your Feed, Ideas and check-ins are built around your goals.{' '}
          <button type="button" onClick={() => navigate('/goals')} className="font-medium text-muse-blue hover:underline">Add a goal</button>
        </p>
      )}
    </div>
  )
}
