/**
 * electron-builder, with an icon this machine can actually compile.
 *
 * `mac.icon` points at `build/icon.icon` — the Icon Composer package macOS 26
 * needs for a layered `Assets.car` — and electron-builder compiles it by running
 * **actool**, which ships with full Xcode and not with the Command Line Tools.
 * On a CLT-only Mac the whole build dies at
 *
 *     ⨯ Failed to check actool version. Is Xcode 26 or higher installed?
 *
 * before it has packaged anything. That turns "the app cannot be built here"
 * into "the app cannot be built", which is wrong: the classic `.icns` path
 * produces a complete, installable, correctly-iconed app on every macOS that
 * exists — it only misses the depth and the dark/tinted/clear variants macOS 26
 * draws from the layered asset.
 *
 * So the icon is chosen at build time and the choice is announced. A machine
 * with Xcode gets the layered icon; a machine without still gets a DMG.
 *
 * Usage: `node scripts/pack.mjs [--dir] [--mac] [--arm64] …` — every argument is
 * passed straight through to electron-builder.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Whether `actool` can actually run.
 *
 * `xcode-select -p` pointing at CommandLineTools is the common case, and then
 * every `xcrun actool` is an error message on stderr with a non-zero exit —
 * which is exactly what this has to detect *before* electron-builder does.
 */
function hasActool() {
  const probe = spawnSync('actool', ['--version'], { encoding: 'utf8' })
  return probe.status === 0
}

const layered = path.join(projectDir, 'build', 'icon.icon')
const classic = path.join(projectDir, 'build', 'icon.icns')

// CLAWMUSE_MAC_ICON=icns forces the classic icon where actool exists but cannot
// run a compile (GitHub's macOS runner: ibtoold crashes on a MediaToolbox symbol).
const useLayered = process.env.CLAWMUSE_MAC_ICON !== 'icns' && hasActool() && existsSync(layered)
const icon = useLayered ? 'build/icon.icon' : 'build/icon.icns'

if (!useLayered && !existsSync(classic)) {
  console.error(
    `✗ neither build/icon.icon (needs Xcode's actool) nor build/icon.icns is usable.\n` +
      `  Run ./scripts/generate-icons.sh to produce them.`,
  )
  process.exit(1)
}

console.log(
  useLayered
    ? '› icon: build/icon.icon — layered, so macOS 26 gets depth and the tinted variants'
    : '› icon: build/icon.icns — actool is unavailable (Command Line Tools only), so the\n' +
      '        layered macOS 26 variant is skipped. The app, the DMG and the icon on every\n' +
      '        macOS are otherwise complete; install full Xcode to get the layered one.',
)

const child = spawn(
  'npx',
  ['electron-builder', `-c.mac.icon=${icon}`, ...process.argv.slice(2)],
  { cwd: projectDir, stdio: 'inherit' },
)
child.on('exit', (code) => process.exit(code ?? 1))
