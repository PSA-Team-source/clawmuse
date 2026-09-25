/**
 * Makes `npm run dev` say "ClawMuse" instead of "Electron".
 *
 * macOS takes the menu-bar title, the Dock tooltip and the Force Quit entry
 * from CFBundleName in the Info.plist of the bundle that is *executing*. AppKit
 * reads it during process launch, before any JavaScript runs, so `app.setName()`
 * cannot reach it — that call only renames `app.name` on the Electron side
 * (userData paths, notifications, the About panel). In dev the executing bundle
 * is node_modules/electron/dist/Electron.app, whose plist ships as "Electron",
 * and `productName` in electron-builder.yml only ever applies at package time.
 * Patching that plist is the sole way to fix the dev name.
 *
 * This is the same shape of problem — and the same class of fix — as
 * src/main/services/dock.ts, which overrides the dev Dock *icon* for exactly
 * the same reason.
 *
 * Runs from `postinstall`, so a fresh `npm ci` (which restores the stock
 * bundle) re-applies it. Never fails the install: a wrong app name is cosmetic,
 * and blocking dependency installation over it would not be a trade worth making.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const PLIST_BUDDY = '/usr/libexec/PlistBuddy'
const NAME_KEYS = ['CFBundleName', 'CFBundleDisplayName']

const projectDir = path.resolve(import.meta.dirname, '..')
const appBundle = path.join(projectDir, 'node_modules', 'electron', 'dist', 'Electron.app')
const plist = path.join(appBundle, 'Contents', 'Info.plist')

/** Single source of truth for the product name is electron-builder.yml. */
function productName() {
  const yml = readFileSync(path.join(projectDir, 'electron-builder.yml'), 'utf8')
  const match = yml.match(/^productName:\s*(.+?)\s*$/m)
  if (!match) throw new Error('electron-builder.yml has no productName')
  return match[1].replace(/^['"]|['"]$/g, '')
}

function plistBuddy(command) {
  return execFileSync(PLIST_BUDDY, ['-c', command, plist], { encoding: 'utf8' }).trim()
}

function readKey(key) {
  // PlistBuddy exits non-zero when the key is absent, which is not an error here.
  try {
    return plistBuddy(`Print :${key}`)
  } catch {
    return null
  }
}

function writeKey(key, value) {
  if (readKey(key) === null) plistBuddy(`Add :${key} string ${value}`)
  else plistBuddy(`Set :${key} ${value}`)
}

/**
 * Whether editing Info.plist would invalidate the bundle's code signature.
 *
 * Today it does not: electron's macOS bundle is `linker-signed` ad-hoc, which
 * reports `Info.plist=not bound` and `Sealed Resources=none` — the plist hash is
 * not in the code directory and there is no resource seal to break. Note that
 * `codesign --verify` already fails on the stock bundle for that same reason, so
 * it is useless as a signal. If a future electron release seals the bundle
 * properly, these markers flip and the patch gets re-signed ad-hoc instead of
 * silently producing a bundle macOS refuses to launch on Apple silicon.
 */
function signatureCoversPlist() {
  // `codesign -dv` prints its description to stderr even on success, so this
  // needs spawnSync — execFileSync only hands back stdout, which is empty here.
  const { stderr, error } = spawnSync('codesign', ['-dv', appBundle], { encoding: 'utf8' })
  const info = error ? '' : String(stderr ?? '')
  if (!info) return true // Could not tell — assume the worst and re-sign.
  return !info.includes('Info.plist=not bound')
}

function main() {
  if (process.platform !== 'darwin') return

  if (!existsSync(plist)) {
    console.warn(`[dev-app-name] no electron bundle at ${appBundle} — skipped`)
    return
  }

  const name = productName()
  if (NAME_KEYS.every((key) => readKey(key) === name)) return // Already patched.

  const mustResign = signatureCoversPlist()
  for (const key of NAME_KEYS) writeKey(key, name)

  if (mustResign) {
    // Only the outer bundle's seal covers the plist we touched, so the nested
    // helpers keep their own signatures — no `--deep`, which would re-sign them
    // too and drop their entitlements (`allow-jit`, `allow-unsigned-executable-
    // memory`) on the floor. `--preserve-metadata` keeps the main binary's.
    const preserve = '--preserve-metadata=entitlements,requirements,flags,runtime'
    execFileSync('codesign', ['--force', '--sign', '-', preserve, appBundle], { stdio: 'inherit' })
  }

  console.log(`[dev-app-name] dev bundle renamed to ${name}`)
}

try {
  main()
} catch (error) {
  console.warn(`[dev-app-name] skipped: ${error.message}`)
}
