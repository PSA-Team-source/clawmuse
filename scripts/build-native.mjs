// Builds native/keymonitor.swift into resources/native/clawmuse-keymonitor as a
// universal (arm64 + x86_64) binary. macOS only; elsewhere it is a no-op and
// the key-monitor features report themselves unavailable.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native', 'keymonitor.swift')
const out = join(root, 'resources', 'native', 'clawmuse-keymonitor')

if (process.platform !== 'darwin') process.exit(0)
if (existsSync(out) && statSync(out).mtimeMs >= statSync(source).mtimeMs) process.exit(0)

mkdirSync(dirname(out), { recursive: true })
const slices = ['arm64', 'x86_64'].map((arch) => {
  const slice = `${out}-${arch}`
  execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos14`, '-o', slice, source], { stdio: 'inherit' })
  return slice
})
execFileSync('lipo', ['-create', '-output', out, ...slices], { stdio: 'inherit' })
for (const slice of slices) rmSync(slice)
console.log(`[build-native] ${out}`)
