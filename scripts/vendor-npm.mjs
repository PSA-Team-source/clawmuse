/**
 * Puts the pinned npm tarball in vendor/ so electron-builder can ship it
 * (electron-builder.yml extraResources → Contents/Resources/vendor).
 *
 * Why a tarball and not the node_modules/npm directory: electron-builder strips
 * every `node_modules` folder from both the asar and extraResources, and npm's
 * CLI needs its bundled node_modules (graceful-fs, …) — the copied directory
 * died on its first require. The published tarball is one file, carries npm's
 * bundleDependencies, and is checked here against the lockfile's integrity, so
 * what ships is byte-for-byte the npm the lockfile pinned.
 *
 * The app extracts it once on first launch (install-cli.ts ensureBundledNpm).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const entry = lock.packages?.['node_modules/npm']
if (!entry?.version || !entry.integrity) {
  console.error('✗ vendor-npm: npm is not pinned in package-lock.json (devDependencies.npm)')
  process.exit(1)
}
const vendor = join(root, 'vendor')
const file = join(vendor, `npm-${entry.version}.tgz`)

function integrityOf(path) {
  const [algo] = entry.integrity.split('-')
  return `${algo}-${createHash(algo).update(readFileSync(path)).digest('base64')}`
}

if (!existsSync(file) || integrityOf(file) !== entry.integrity) {
  mkdirSync(vendor, { recursive: true })
  execFileSync('npm', ['pack', `npm@${entry.version}`, '--pack-destination', vendor, '--silent'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}
if (integrityOf(file) !== entry.integrity) {
  console.error(`✗ vendor-npm: ${file} does not match the lockfile integrity — refusing to ship it`)
  process.exit(1)
}
console.log(`✓ vendor-npm: npm ${entry.version} (${entry.integrity.slice(0, 20)}…)`)
