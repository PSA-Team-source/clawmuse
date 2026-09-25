import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { SettingsGroup, SettingsRow } from '@/components/settings'
import { Icon } from '@/components/primitives'

/**
 * Muse's Help & support, holding only destinations that exist. Version and
 * updates live on General; legal text on Legal info. Muse's "Submit feedback"
 * and "Report an issue" post to Meta — ClawMuse has no service to receive them,
 * so they are not offered rather than offered and dropped.
 */
const HELP_LINKS: { label: string; url: string }[] = [
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
