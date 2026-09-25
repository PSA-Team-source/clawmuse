import { Cancel01Icon, GithubIcon } from '@hugeicons/core-free-icons'
import { IconButton } from '@/components/brand'
import { Icon } from '@/components/primitives'
import { recordStarPrompt, REPOSITORY_URL } from '@/lib/star-prompt'

/**
 * The one-time GitHub star note, shown under the story the user just Loved.
 * Static (no motion to reduce), announced politely, and either button closes
 * it for good. The caller records it as shown when it appears.
 */
export function StarPrompt({ onClose }: { onClose: () => void }) {
  function star(): void {
    recordStarPrompt('starred')
    void window.clawmuse.shell.openExternal(REPOSITORY_URL)
    onClose()
  }

  function dismiss(): void {
    recordStarPrompt('dismissed')
    onClose()
  }

  return (
    <div role="status" aria-label="Star ClawMuse on GitHub" className="mt-4 flex items-center gap-3 rounded-2xl border border-line-hairline bg-bg-panel px-4 py-3">
      <p className="min-w-0 flex-1 text-body-sm text-content-secondary">
        Glad that one was useful. ClawMuse is free and open source, and a star on GitHub helps other people find it.
      </p>
      <button type="button" onClick={star} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-fill-strong px-3 text-body-sm font-medium text-content-primary hover:bg-fill-stronger">
        <Icon icon={GithubIcon} size={16} className="text-current" />
        Star on GitHub
      </button>
      <IconButton icon={Cancel01Icon} label="Dismiss" size="sm" shape="circle" onClick={dismiss} className="shrink-0 text-content-secondary" />
    </div>
  )
}
