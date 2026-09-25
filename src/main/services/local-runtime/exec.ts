import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import log from 'electron-log/main.js'

/**
 * Thin `spawn` wrapper for the CLI calls this app orchestrates.
 *
 * Deliberately not `exec`: every command here takes user-influenced values
 * (paths, ports, provider ids), and `exec` would hand them to a shell.
 * `spawn` with an argv array cannot be argument-injected.
 */

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunOptions {
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
  /** Streamed line by line — used to surface real install progress in the UI. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  /**
   * Written to the child's stdin, then closed.
   *
   * Exists for `models auth paste-api-key`, which reads the credential from
   * stdin. Passing a key as an argv element would expose it to every process
   * on the machine through `ps`.
   */
  stdin?: string
  /** Terminates the child when aborted — Stop on a background run. */
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT = 120_000

/**
 * Windows cannot spawn a `.cmd`/`.bat` without a shell (Node refuses since the
 * 2024 BatBadBut fix), and a shell would re-open argument injection. Every
 * `.cmd` this app runs is one of two known shims, so it is resolved to what
 * it wraps and run directly on ClawMuse's own Electron in Node mode:
 *  - our `node.cmd` (the Windows twin of the macOS `node` shim), and
 *  - npm's cmd-shims (`openclaw.cmd`, `claude.cmd`), whose target script is
 *    the `"%dp0%\…js"` path npm writes into them.
 * Anything else is spawned as-is.
 */
export function resolveWindowsCommand(command: string, args: string[], read: (path: string) => string = (path) => readFileSync(path, 'utf8')): { command: string; args: string[]; node: boolean } {
  if (!/\.(cmd|bat)$/i.test(command)) return { command, args, node: false }
  if (/[\\/]node\.cmd$/i.test(command)) return { command: process.execPath, args, node: true }
  let body: string
  try {
    body = read(command)
  } catch {
    return { command, args, node: false }
  }
  const target = /"%(?:~)?dp0%\\?([^"]+\.(?:m?js|cjs))"/i.exec(body)?.[1]
  if (!target) return { command, args, node: false }
  return { command: process.execPath, args: [join(dirname(command), target), ...args], node: true }
}

export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const target = process.platform === 'win32' ? resolveWindowsCommand(command, args) : { command, args, node: false }

  return new Promise((resolve) => {
    const child = spawn(target.command, target.args, {
      env: target.node ? { ...(options.env ?? (process.env as Record<string, string>)), ELECTRON_RUN_AS_NODE: '1' } : options.env,
      windowsHide: true,
      cwd: options.cwd,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })

    if (options.stdin !== undefined) {
      // A closed stdin is the signal the CLI waits for; without the `end()` the
      // prompt hangs until the timeout kills it.
      child.stdin?.on('error', () => {
        // The child can exit before the write lands (bad args, for one). That is
        // reported through the exit code, not as an unhandled EPIPE.
      })
      child.stdin?.end(`${options.stdin}\n`)
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    // SIGTERM first: the `openclaw` launcher may respawn itself under another
    // Node and forwards SIGTERM to that child — a SIGKILL cannot be forwarded,
    // so it orphaned the real worker, which ran on after every timeout/Stop.
    // SIGKILL follows as a backstop for anything that ignores SIGTERM.
    let forceKill: NodeJS.Timeout | null = null
    const terminate = () => {
      if (forceKill) return
      child.kill('SIGTERM')
      forceKill = setTimeout(() => child.kill('SIGKILL'), 3_000)
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeoutMs)

    // Buffer partial lines so `onLine` never emits half a message.
    const pump = (stream: 'stdout' | 'stderr') => {
      let carry = ''
      return (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        if (stream === 'stdout') stdout += text
        else stderr += text
        if (!options.onLine) return
        carry += text
        const lines = carry.split('\n')
        carry = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) options.onLine(line.trimEnd(), stream)
        }
      }
    }

    const abort = () => terminate()
    if (options.signal?.aborted) abort()
    options.signal?.addEventListener('abort', abort, { once: true })

    child.stdout?.on('data', pump('stdout'))
    child.stderr?.on('data', pump('stderr'))

    const finish = (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forceKill) clearTimeout(forceKill)
      options.signal?.removeEventListener('abort', abort)
      resolve({ code, stdout, stderr, timedOut })
    }

    child.on('error', (error) => {
      // ENOENT (binary missing) is an expected outcome while probing candidates,
      // so it resolves as a failed result rather than rejecting.
      stderr += `\n${error.message}`
      finish(-1)
    })
    child.on('close', (code) => finish(code ?? -1))
  })
}

/** Runs a command that is expected to print JSON on stdout with `--json`. */
export async function runJson<T>(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string; result: RunResult }> {
  const result = await run(command, args, options)
  if (result.code !== 0) {
    return {
      ok: false,
      error: firstMeaningfulLine(result.stderr) || firstMeaningfulLine(result.stdout) || `exit ${result.code}`,
      result,
    }
  }
  // The CLI prefixes some commands with human log lines even under `--json`,
  // so parse from the first `{`/`[` rather than assuming the whole of stdout.
  const start = result.stdout.search(/[{[]/)
  if (start < 0) return { ok: false, error: 'no JSON in output', result }
  try {
    return { ok: true, data: JSON.parse(result.stdout.slice(start)) as T }
  } catch (error) {
    log.warn('[local-runtime] JSON parse failed:', (error as Error).message)
    return { ok: false, error: 'malformed JSON output', result }
  }
}

export function firstMeaningfulLine(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line && !line.startsWith('npm warn') && !line.startsWith('npm notice')) return line
  }
  return ''
}
