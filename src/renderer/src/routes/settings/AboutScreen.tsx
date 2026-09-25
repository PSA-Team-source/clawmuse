import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { SettingsGroup, SettingsRow } from '@/components/settings'
import { Icon } from '@/components/primitives'
import { REPOSITORY_URL } from '@/lib/star-prompt'

/**
 * Muse's Help & support, holding only destinations that exist. Version and
 * updates live on General; legal text on Legal info. ClawMuse has no service
 * of its own to receive feedback, so "Report an issue" is the public issue
 * tracker's form picker (.github/ISSUE_TEMPLATE), opened in the browser.
 */
const HELP_LINKS: { label: string; url: string }[] = [
  { label: 'ClawMuse on GitHub', url: REPOSITORY_URL },
  { label: 'Report an issue', url: `${REPOSITORY_URL}/issues/new/choose` },
  { label: 'OpenClaw documentation', url: 'https://docs.openclaw.ai' },
]

export default function AboutScreen() {
  return (
    <div className="h-full w-full overflow-y-auto bg-bg-base">
      <div className="drag h-11 w-full shrink-0" />
      <div className="no-drag mx-auto flex w-full max-w-content flex-col gap-6 px-8 pb-16">
        <h1 className="text-title-1 font-bold text-content-primary">Help &amp; support</h1>
        <SettingsGroup>
          {HELP_LINKS.map((link) => (
            <SettingsRow
              key={link.url}
              label={link.label}
              onClick={() => void window.clawmuse.shell.openExternal(link.url)}
              right={<Icon icon={ArrowUpRight01Icon} size={18} className="text-content-tertiary" />}
            />
          ))}
        </SettingsGroup>
      </div>
    </div>
  )
}
