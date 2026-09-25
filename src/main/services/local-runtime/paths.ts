import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * Layout of the ClawMuse profile on disk.
 *
 * This is an OpenClaw state directory in every respect — same shape a plain
 * `openclaw` install uses — so the CLI can operate on it directly:
 *
 *     openclaw --profile clawmuse gateway status
 *     openclaw --profile clawmuse sessions list
 *
 * `OPENCLAW_STATE_DIR` points at the profile default `~/.openclaw-clawmuse`. Verified that `gateway install`
 * persists that override into the launchd service environment
 * (`<profile>/service-env/ai.openclaw.clawmuse.env`), so the daemon reads the
 * same profile the app writes.
 */

const IS_WINDOWS = process.platform === 'win32'

export const PROFILE = 'clawmuse'
export const LAUNCHD_LABEL = `ai.openclaw.${PROFILE}`
/**
 * Deliberately NOT 18789, which is OpenClaw's own default gateway port.
 *
 * 18790 is skipped too: it is what other apps built on this codebase use, and a
 * machine that runs one of them is exactly the machine most likely to try this
 * one as well.
 *
 * This app targets machines that already run `openclaw` — that is the whole
 * point of adopting an existing profile — so sharing the default guarantees a
 * collision with the very users it is meant to serve. Both LaunchAgents bind
 * the same port, launchd starts whichever it likes, and the loser is SIGTERMed
 * seconds after reporting "ready": a gateway that looks healthy in its own log
 * and is simply gone.
 *
 * `pickPort` still moves off this if it is taken; this only decides where to
 * look first, and an existing profile keeps whatever port it was built with.
 */
export const DEFAULT_PORT = 18791

/** OpenClaw 2026.9+ only installs services from its canonical profile path. */
export const CLAWMUSE_HOME = join(homedir(), '.openclaw-clawmuse')

/**
 * Where earlier releases kept the profile, newest first. Read-only migration
 * sources: the app was called LocalFang, first at `~/.localfang` (before
 * OpenClaw 2026.9 required the canonical path), then `~/.openclaw-localfang`.
 */
export const LEGACY_HOMES = [
  join(homedir(), '.openclaw-localfang'),
  join(homedir(), '.localfang'),
] as const
/** The pre-rename profile and its LaunchAgent, retired on migration. */
export const LEGACY_PROFILE = 'localfang'
export const LEGACY_LAUNCHD_LABEL = `ai.openclaw.${LEGACY_PROFILE}`
export const LEGACY_LAUNCH_AGENT = join(homedir(), 'Library', 'LaunchAgents', `${LEGACY_LAUNCHD_LABEL}.plist`)

export const paths = {
  home: CLAWMUSE_HOME,
  config: join(CLAWMUSE_HOME, 'openclaw.json'),
  configBackup: join(CLAWMUSE_HOME, 'openclaw.json.bak'),
  env: join(CLAWMUSE_HOME, '.env'),
  /**
   * The shared computer's files — what the Files screen shows, and what every
   * bot is told to use for anything another bot or the user must see.
   */
  workspace: join(CLAWMUSE_HOME, 'workspace'),
  /** Parent of the per-bot workspaces; see `botWorkspace`. */
  bots: join(CLAWMUSE_HOME, 'bots'),
  identity: join(CLAWMUSE_HOME, 'identity', 'device.json'),
  /** npm prefix for the app-managed CLI — deliberately not a global install. */
  runtime: join(CLAWMUSE_HOME, 'runtime'),
  /** Private Node shim backed by Electron's embedded, supported Node runtime. */
  nodeBin: join(CLAWMUSE_HOME, 'runtime', 'node-bin'),
  // Windows runs `.cmd` shims (npm's own, and ours) — see `exec.ts` for how they are spawned.
  nodeShim: join(CLAWMUSE_HOME, 'runtime', 'node-bin', IS_WINDOWS ? 'node.cmd' : 'node'),
  runtimeBin: join(CLAWMUSE_HOME, 'runtime', 'node_modules', '.bin', IS_WINDOWS ? 'openclaw.cmd' : 'openclaw'),
  stateDatabase: join(CLAWMUSE_HOME, 'state', 'openclaw.sqlite'),
  /** launchd stdout; stderr is suppressed by the generated plist. */
  gatewayLog: IS_WINDOWS ? join(CLAWMUSE_HOME, 'logs', 'gateway.log') : join(homedir(), 'Library', 'Logs', 'openclaw', `gateway-${PROFILE}.log`),
  launchAgent: join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
} as const

/**
 * Environment every `openclaw` invocation must carry.
 *
 * `OPENCLAW_STATE_DIR` is what redirects the whole profile; `OPENCLAW_CONFIG_PATH`
 * is set explicitly because the config lives at the state-dir root and we never
 * want a stray `./openclaw.json` in the app's cwd to win.
 */
export function openclawEnv(extra?: Record<string, string>): Record<string, string> {
  // Windows names it `Path`: copying the env and then setting `PATH` would hand
  // the child two variables and it may read the stale one — so every casing is
  // dropped before the one PATH is written, with the platform's own separator.
  const inherited = Object.fromEntries(Object.entries(process.env as Record<string, string>).filter(([key]) => key.toUpperCase() !== 'PATH'))
  return {
    ...inherited,
    PATH: `${paths.nodeBin}${delimiter}${process.env.PATH ?? ''}`,
    OPENCLAW_STATE_DIR: paths.home,
    OPENCLAW_CONFIG_PATH: paths.config,
    OPENCLAW_WORKSPACE_DIR: paths.workspace,
    ...extra,
  }
}

/**
 * A bot's private workspace — its `AGENTS.md`, `SOUL.md` and scratch files.
 *
 * Deliberately NOT the shared `paths.workspace`: persona is read from workspace
 * files, so pointing the whole roster at one directory would give every bot the
 * same instructions. Deliberately not under `agents/<id>/` either — that is the
 * CLI's own state directory, and putting user-editable files inside it invites
 * a future `agents delete` to take them along.
 */
export function botWorkspace(botId: string): string {
  return join(paths.bots, botId)
}

export function wsUrlFor(port: number): string {
  return `ws://127.0.0.1:${port}/`
}
