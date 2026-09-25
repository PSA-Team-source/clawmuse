import { existsSync, watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import log from 'electron-log/main.js'
import { paths } from './local-runtime/paths.js'

/**
 * ClawMuse's look — the avatar config (style, accessory, colours) — lives in
 * the agent's own workspace as `avatar.json`, so the assistant can change it
 * with the file tools it already has when the user asks ("change your avatar"),
 * and Settings writes the same file. The renderer validates every read
 * (`resolveAvatarConfig` never throws), so this side only guards size and shape.
 *
 * The skill below is what tells the agent the file exists; without it the agent
 * only knew IDENTITY.md's image avatar and answered "change your avatar" with
 * questions.
 */

const MAX_BYTES = 4096
const lookPath = () => join(paths.workspace, 'avatar.json')

export type AvatarLook = Record<string, unknown>

function asLook(value: unknown): AvatarLook | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AvatarLook) : null
}

export async function getAvatarLook(): Promise<AvatarLook | null> {
  try {
    const text = await readFile(lookPath(), 'utf8')
    return text.length <= MAX_BYTES ? asLook(JSON.parse(text)) : null
  } catch {
    return null
  }
}

export async function setAvatarLook(input: unknown): Promise<AvatarLook | null> {
  const look = asLook(input)
  if (!look) throw new Error('avatar look must be an object')
  const text = JSON.stringify(look, null, 2) + '\n'
  if (text.length > MAX_BYTES) throw new Error('avatar look is too large')
  await mkdir(paths.workspace, { recursive: true })
  const tmp = `${lookPath()}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, lookPath())
  broadcast(look)
  return look
}

function broadcast(look: AvatarLook | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('avatar-look', look)
  }
}

const SKILL = `---
name: clawmuse-avatar
description: Change how you (ClawMuse) look — your 3D avatar's style, accessory and colours. Use whenever the user asks to change, restyle, improve or customise your avatar, look, outfit, hair or colours.
---

# Your avatar

You appear in the app as a 3D voxel character. Your look is the JSON file
\`avatar.json\` at the root of your workspace. Edit it with your file tools; the
app redraws you within a second of the file changing. Keep existing fields you
are not changing.

Fields (all optional; anything invalid falls back to the default):

- \`style\`: one of \`muse\` (default — bob haircut, claw mitts, spark), \`mage\`, \`striker\`, \`sentinel\`, \`healer\`
- \`accessory\`: one of \`none\`, \`cap\`, \`glasses\`, \`crown\`, \`headphones\`
- \`colors.outfit\`, \`colors.hair\`, \`colors.skin\`: \`#RRGGBB\`
- \`seed\`: any short string — changes small random details (idle rhythm, blinks)

Example (the format only — choose your own values, and something different from the current look):

\`\`\`json
{ "style": "muse", "accessory": "headphones", "colors": { "outfit": "#2F6BFF", "hair": "#1B1B1F" } }
\`\`\`

How to act:

- Just do it. If the request is vague ("make it better", "surprise me"), choose a
  tasteful new combination yourself, write it, and say in one sentence what you
  changed and that they can ask for something else. Do not ask clarifying
  questions first.
- To go back to the original look, write \`{}\`.
- A photo avatar set in IDENTITY.md (\`Avatar:\`) replaces the 3D character
  entirely; only use that when the user gives you an image.
`

/** Keeps the avatar skill in the agent's workspace current. */
export async function ensureAvatarSkill(): Promise<void> {
  const dir = join(paths.workspace, 'skills', 'clawmuse-avatar')
  const file = join(dir, 'SKILL.md')
  try {
    if (existsSync(file) && (await readFile(file, 'utf8')) === SKILL) return
    await mkdir(dir, { recursive: true })
    await writeFile(file, SKILL)
  } catch (error) {
    log.warn('[avatar] could not write the avatar skill', error)
  }
}

let watcher: FSWatcher | null = null
let debounce: NodeJS.Timeout | null = null

/** Pushes `avatar-look` to every window whenever the file changes, whoever wrote it. */
export function watchAvatarLook(): void {
  if (watcher) return
  try {
    watcher = watch(paths.workspace, (_event, name) => {
      if (name !== 'avatar.json') return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        void getAvatarLook().then(broadcast)
      }, 150)
    })
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
    })
  } catch {
    // No workspace yet: called again once the runtime is ready.
    watcher = null
  }
}
