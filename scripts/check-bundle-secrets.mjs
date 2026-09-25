/**
 * Fails the build when a credential is baked into shippable output.
 *
 * `app-provider.ts` lets a build carry a model-provider key so a fresh install
 * can chat without onboarding. That key is inlined by electron-vite at build
 * time, which means it lands in `out/main/index.js` — and from there into
 * `app.asar`, where `npx asar extract` hands it to anyone with the `.app`.
 *
 * That is exactly the risk local mode was designed to avoid: BYOK exists so
 * ClawMuse ships no shared credential to leak. A convenience default is fine for
 * an internal build; shipping one is not, and the difference is one forgotten
 * `.env.local`. So this check makes the failure loud and mechanical instead of
 * relying on anyone remembering.
 *
 * Usage:
 *   node scripts/check-bundle-secrets.mjs            # scan out/
 *   node scripts/check-bundle-secrets.mjs --app dist/mac-arm64/ClawMuse.app
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appFlag = process.argv.indexOf('--app')
const appBundle = appFlag !== -1 ? process.argv[appFlag + 1] : null
const allowBundled = process.argv.includes('--allow-bundled-provider')

/** Values that must never appear in shippable output, read from local env files. */
function collectSecrets() {
  const secrets = new Map()
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const name = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      // Short values produce false positives ("true", a port number).
      if (value.length < 16) continue
      // A base URL is not a credential.
      if (/^https?:\/\//.test(value) && !/key|token|secret/i.test(name)) continue
      if (!/key|token|secret|password/i.test(name)) continue
      secrets.set(name, value)
    }
  }
  return secrets
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) walk(full, out)
    else if (info.size < 50 * 1024 * 1024) out.push(full)
  }
  return out
}

function scan(root, secrets) {
  const hits = []
  for (const file of walk(root)) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const [name, value] of secrets) {
      if (content.includes(value)) hits.push({ file, name })
    }
  }
  return hits
}

const secrets = collectSecrets()
if (secrets.size === 0) {
  console.log('✓ no local credentials to check for')
  process.exit(0)
}

const roots = []
let extracted = null
if (appBundle) {
  const asar = join(appBundle, 'Contents/Resources/app.asar')
  if (existsSync(asar)) {
    extracted = mkdtempSync(join(tmpdir(), 'clawmuse-asar-'))
    execFileSync('npx', ['asar', 'extract', asar, extracted], { stdio: 'ignore' })
    roots.push(extracted)
  }
  const unpacked = join(appBundle, 'Contents/Resources/app.asar.unpacked')
  if (existsSync(unpacked)) roots.push(unpacked)
} else if (existsSync('out')) {
  roots.push('out')
}

const hits = roots.flatMap((root) => scan(root, secrets))
if (extracted) rmSync(extracted, { recursive: true, force: true })

if (hits.length === 0) {
  console.log(`✓ no credentials found in ${appBundle ?? 'out/'} (checked ${secrets.size})`)
  process.exit(0)
}

const names = [...new Set(hits.map((hit) => hit.name))]
console.error(`✗ credentials baked into ${appBundle ?? 'out/'}:`)
for (const name of names) console.error(`  · ${name}`)
console.error(`\nAnyone with this build can extract them: npx asar extract …/app.asar`)
console.error(`Remove the value from .env.local and rebuild, or pass`)
console.error(`--allow-bundled-provider if this is an internal build that never leaves the team.`)

process.exit(allowBundled ? 0 : 1)
