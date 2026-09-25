import { AnimatePresence, motion } from 'motion/react'
import { springs } from '@/design/tokens'
import { cn } from '@/lib/cn'

interface SlashCommandsProps {
  query: string
  open: boolean
  onSelect: (cmd: string) => void
}

interface SlashCommand {
  command: string
  description: string
}

const COMMANDS: SlashCommand[] = [
  { command: '/status', description: 'Show session status' },
  { command: '/new', description: 'Create new session' },
  { command: '/reset', description: 'Clear conversation' },
  { command: '/compact', description: 'Summarize history' },
  { command: '/think', description: 'Toggle thinking mode' },
  { command: '/verbose', description: 'Toggle verbose mode' },
]

/** Slash-command autocomplete popup, anchored above the composer. */
export function SlashCommands({ query, open, onSelect }: SlashCommandsProps) {
  const filtered = COMMANDS.filter(
    (c) => c.command.startsWith(query) || c.description.toLowerCase().includes(query.replace('/', '').toLowerCase()),
  )
  const visible = open && filtered.length > 0

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={springs.snappy}
          className="material-thick mx-3 mb-1 overflow-hidden rounded-field border border-line"
        >
          {filtered.map((cmd) => (
            <button
              key={cmd.command}
              type="button"
              onClick={() => onSelect(cmd.command)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-fill-raised',
              )}
            >
              <span className="min-w-[84px] font-mono text-body-sm font-semibold text-primary-light">
                {cmd.command}
              </span>
              <span className="text-footnote text-content-tertiary">{cmd.description}</span>
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
