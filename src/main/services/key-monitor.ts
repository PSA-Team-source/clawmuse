import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import log from 'electron-log/main.js'
import type { KeyMonitorStatus } from '@shared/ipc'
import { resourcePath } from '../env.js'
import { getAppPreferences } from './app-preferences.js'
import { transcribeDictation } from './local-runtime/dictation.js'
import { toggleQuickChat } from '../windows/quick-chat.js'

/**
 * Muse's modifier-key gestures, run by the native helper
 * (native/keymonitor.swift): hold-to-dictate into the frontmost app, and
 * "Tap Option twice" for Quick Chat. The helper runs only while one of them is
 * configured, and is restarted with backoff if it dies.
 */

const helper = () => resourcePath('native', 'clawmuse-keymonitor')

let child: ChildProcessWithoutNullStreams | null = null
let trusted: boolean | null = null
let doubleOption = false
let restartDelay = 1000
let restartTimer: NodeJS.Timeout | null = null
let wantedArgs: string[] | null = null
const listeners = new Set<(status: KeyMonitorStatus) => void>()

export function getKeyMonitorStatus(): KeyMonitorStatus {
  return { available: process.platform === 'darwin' && existsSync(helper()), running: child !== null, trusted }
}

export function onKeyMonitorStatus(listener: (status: KeyMonitorStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  const status = getKeyMonitorStatus()
  for (const listener of listeners) listener(status)
}

/** Quick Chat's "Tap Option twice" choice; set by the shortcut service. */
export function setDoubleOptionShortcut(enabled: boolean): void {
  doubleOption = enabled
  syncKeyMonitor()
}

async function dictate(path: string): Promise<void> {
  // Only the recordings the helper names are read (and then deleted).
  if (!/\/clawmuse-ptt-[0-9A-F-]{36}\.wav$/i.test(path) || path.includes('..')) return
  try {
    const result = await transcribeDictation(new Uint8Array(await readFile(path)), undefined)
    if (!result.ok) { log.warn('[key-monitor] transcription failed:', result.error); return }
    if (result.text && child) child.stdin.write(`type ${Buffer.from(result.text, 'utf8').toString('base64')}\n`)
  } finally {
    await rm(path, { force: true })
  }
}

function start(args: string[]): void {
  const proc = spawn(helper(), args, { stdio: ['pipe', 'pipe', 'pipe'] })
  child = proc
  createInterface({ input: proc.stdout }).on('line', (line) => {
    if (line === 'trusted' || line === 'untrusted') { trusted = line === 'trusted'; restartDelay = 1000; notify(); return }
    if (line === 'double-option') { toggleQuickChat(); return }
    if (line.startsWith('ptt-stop ')) { void dictate(line.slice('ptt-stop '.length)); return }
    if (line.startsWith('error ')) log.warn('[key-monitor]', line.slice(6))
  })
  proc.stderr.on('data', (chunk: Buffer) => log.warn('[key-monitor] stderr:', chunk.toString().trim()))
  proc.on('error', (error) => log.warn('[key-monitor] could not start:', error.message))
  proc.on('exit', (code) => {
    // stop() clears `child` first, so only an exit we did not ask for is still current here.
    const unexpected = child === proc
    if (unexpected) child = null
    notify()
    // Auto-heal: bring it back if it is still wanted.
    if (unexpected && wantedArgs && code !== 0) {
      restartTimer = setTimeout(() => { restartTimer = null; syncKeyMonitor(true) }, restartDelay)
      restartDelay = Math.min(restartDelay * 2, 60_000)
    }
  })
  notify()
}

function stop(): void {
  if (!child) return
  const proc = child
  child = null
  proc.stdin.end()
  setTimeout(() => proc.kill(), 1500).unref()
}

/** Starts, restarts or stops the helper to match preferences. */
export function syncKeyMonitor(force = false): void {
  if (!getKeyMonitorStatus().available) return
  const ptt = getAppPreferences().pushToTalk
  const args = ptt === 'off' && !doubleOption ? null : [ptt, ...(doubleOption ? ['--double-option'] : [])]
  const same = JSON.stringify(args) === JSON.stringify(wantedArgs)
  wantedArgs = args
  if (same && !force && (child || !args)) return
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null }
  stop()
  if (args) start(args)
}

export function stopKeyMonitor(): void {
  wantedArgs = null
  stop()
}
