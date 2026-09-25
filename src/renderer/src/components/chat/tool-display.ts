import {
  ArrowRight02Icon,
  CheckListIcon,
  FileEditIcon,
  File01Icon,
  FolderOpenIcon,
  GlobeIcon,
  PlusSignIcon,
  Search01Icon,
  TerminalIcon,
  WrenchIcon,
} from '@hugeicons/core-free-icons'

interface ToolMeta {
  icon: unknown
  /** What the tool *did*, in the reader's language — "Run", not "Bash". */
  verb: string
}

/**
 * Raw tool names are implementation detail. A thread that says
 * "Read · src/App.tsx" tells you what happened; one that says
 * `{"tool":"Read","input":{"file_path":"…"}}` makes you decode it.
 */
const TOOL_META: Record<string, ToolMeta> = {
  Read: { icon: File01Icon, verb: 'Read' },
  Write: { icon: PlusSignIcon, verb: 'Write' },
  Edit: { icon: FileEditIcon, verb: 'Edit' },
  Glob: { icon: FolderOpenIcon, verb: 'Scan' },
  Grep: { icon: Search01Icon, verb: 'Search' },
  Bash: { icon: TerminalIcon, verb: 'Run' },
  exec: { icon: TerminalIcon, verb: 'Run' },
  WebFetch: { icon: GlobeIcon, verb: 'Fetch' },
  WebSearch: { icon: Search01Icon, verb: 'Search' },
  web_search: { icon: Search01Icon, verb: 'Search' },
  browser: { icon: GlobeIcon, verb: 'Browse' },
  'browser.request': { icon: GlobeIcon, verb: 'Browse' },
  TodoWrite: { icon: CheckListIcon, verb: 'Plan' },
  Skill: { icon: WrenchIcon, verb: 'Skill' },
  // A handoff is the most consequential thing a bot does in a roster: it moves
  // work to someone else. Reading it as "sessions_send" hides that; "Handed to"
  // is what actually happened.
  sessions_send: { icon: ArrowRight02Icon, verb: 'Handed to' },
  sessions_spawn: { icon: ArrowRight02Icon, verb: 'Delegated to' },
}

/** Unknown tools keep their own name as the verb rather than being hidden. */
export function toolMeta(name: string): ToolMeta {
  return TOOL_META[name] ?? { icon: WrenchIcon, verb: name }
}

const MAX_DETAIL = 55

function truncate(value: string): string {
  return value.length > MAX_DETAIL ? `${value.slice(0, MAX_DETAIL)}…` : value
}

function str(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * The one argument worth reading at a glance for a given tool.
 *
 * File paths keep their last two segments — enough to identify the file
 * without the noise of an absolute path; commands and URLs are truncated.
 */
export function toolDetail(name: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const args = input as Record<string, unknown>

  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit': {
      const path = str(args, 'file_path', 'path')
      return path ? path.split('/').slice(-2).join('/') : ''
    }
    case 'Bash':
    case 'exec': {
      const command = str(args, 'command', 'cmd')
      return command ? truncate(command) : ''
    }
    case 'Grep': {
      return str(args, 'query', 'pattern') ?? ''
    }
    case 'WebFetch':
    case 'WebSearch':
    case 'web_search': {
      const target = str(args, 'url', 'query')
      return target ? truncate(target) : ''
    }
    case 'Skill': {
      return [str(args, 'skill'), str(args, 'args')].filter(Boolean).join(' ')
    }
    case 'sessions_send':
    case 'sessions_spawn': {
      // The target is a session key — `agent:talent-scout:webchat:main`. The
      // reader wants the bot, not the routing.
      const target = str(args, 'agentId', 'sessionKey', 'sessionId', 'target')
      if (!target) return ''
      const agent = /^agent:([^:]+):/.exec(target)?.[1]
      return truncate(agent ?? target)
    }
    default:
      return ''
  }
}
