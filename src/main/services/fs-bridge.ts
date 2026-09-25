import { constants } from 'node:fs'
import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { shell } from 'electron'
import type { FsEntry, FsReadResult, FsRoot } from '@shared/ipc'
import { paths } from './local-runtime/paths.js'

/**
 * Filesystem access for the file browser.
 *
 * This is the most dangerous surface in the app: a renderer bug — or a
 * prompt-injected agent that finds a way to drive the UI — must not be able to
 * read `~/.ssh` or write to `/etc`. Two rules make that structural rather than
 * a matter of care:
 *
 *   1. **The renderer never sends absolute paths.** It sends a `rootId` plus a
 *      path relative to that root. There is no channel that accepts a bare
 *      path, so there is nothing to traverse out of.
 *   2. **Every resolved path is realpath'd and re-checked** against its root
 *      before any I/O. `..` is handled by `resolve`, but a symlink inside the
 *      workspace pointing at `/` is not — realpath is what closes that.
 *
 * Roots are opened deliberately: the agent workspace by default, and whatever
 * the user picks in a native folder dialog.
 */

const MAX_READ_BYTES = 5 * 1024 * 1024

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

/** Names never worth listing, and in `.git`'s case actively harmful to edit. */
const HIDDEN_ALWAYS = new Set(['.DS_Store', '.git', 'node_modules'])

interface Root {
  id: string
  label: string
  /** Already realpath'd at registration time. */
  path: string
}

const roots = new Map<string, Root>()

export async function registerRoot(id: string, label: string, path: string): Promise<FsRoot> {
  const real = await realpath(resolve(path))
  const root: Root = { id, label, path: real }
  roots.set(id, root)
  return { id, label, path: real }
}

export async function ensureDefaultRoots(): Promise<FsRoot[]> {
  if (!roots.has('workspace')) {
    await mkdir(paths.workspace, { recursive: true })
    await registerRoot('workspace', 'Workspace', paths.workspace)
  }
  return listRoots()
}

export function listRoots(): FsRoot[] {
  return [...roots.values()].map(({ id, label, path }) => ({ id, label, path }))
}

/**
 * Resolves `rootId` + relative path to an absolute path that is provably
 * inside the root.
 *
 * `realpath` is applied to the deepest existing ancestor rather than the target
 * itself, so this also works for a file about to be created.
 */
async function resolveInRoot(rootId: string, relativePath: string): Promise<string> {
  const root = roots.get(rootId)
  if (!root) throw new Error(`Unknown root: ${rootId}`)

  const candidate = resolve(root.path, relativePath)

  // Walk up to the first path that exists; everything below it does not exist
  // yet and therefore cannot be a symlink.
  let existing = candidate
  for (;;) {
    try {
      await access(existing, constants.F_OK)
      break
    } catch {
      const parent = dirname(existing)
      if (parent === existing) throw new Error('Path is outside the workspace')
      existing = parent
    }
  }

  const realExisting = await realpath(existing)
  const suffix = candidate.slice(existing.length)
  const real = realExisting + suffix

  if (real !== root.path && !real.startsWith(root.path + sep)) {
    throw new Error('Path is outside the workspace')
  }
  return real
}

export async function list(rootId: string, relativePath: string): Promise<FsEntry[]> {
  const dir = await resolveInRoot(rootId, relativePath)

  // A directory the workspace has not created yet — `workspace/skills` before
  // the first locally authored skill — is empty, not broken. Letting ENOENT
  // through surfaced it as a red error in the main-process log on every fresh
  // profile, for a state that is simply the starting one.
  let items
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') return []
    throw cause
  }

  const entries = await Promise.all(
    items
      .filter((item) => !HIDDEN_ALWAYS.has(item.name))
      .map(async (item) => {
        const full = join(dir, item.name)
        let size: number | undefined
        let modifiedMs: number | undefined
        try {
          const info = await stat(full)
          size = info.isFile() ? info.size : undefined
          modifiedMs = info.mtimeMs
        } catch {
          // A dangling symlink still belongs in the listing, just without stats.
        }
        return {
          name: item.name,
          path: join(relativePath, item.name),
          isDirectory: item.isDirectory(),
          size,
          modifiedMs,
        } satisfies FsEntry
      }),
  )

  // Directories first, then case-insensitive by name — how every file browser
  // the user has ever used behaves.
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export async function read(rootId: string, relativePath: string): Promise<FsReadResult> {
  const file = await resolveInRoot(rootId, relativePath)
  const info = await stat(file)
  if (!info.isFile()) throw new Error('Not a file')
  if (info.size > MAX_READ_BYTES) {
    return { path: relativePath, tooLarge: true, size: info.size, content: '' }
  }

  const buffer = await readFile(file)
  const extension = basename(file).split('.').pop()?.toLowerCase() ?? ''
  const mimeType = IMAGE_MIME_TYPES[extension]
  if (mimeType) {
    return {
      path: relativePath,
      binary: true,
      size: info.size,
      content: '',
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    }
  }
  // Cheap binary sniff: a NUL byte in the first 8 KB. Rendering a binary as
  // text produces megabytes of garbage in the DOM and can hang the renderer.
  const probe = buffer.subarray(0, 8192)
  if (probe.includes(0)) {
    return { path: relativePath, binary: true, size: info.size, content: '' }
  }
  return { path: relativePath, size: info.size, content: buffer.toString('utf8') }
}

export async function write(rootId: string, relativePath: string, content: string): Promise<void> {
  const file = await resolveInRoot(rootId, relativePath)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

export async function createDirectory(rootId: string, relativePath: string): Promise<void> {
  await mkdir(await resolveInRoot(rootId, relativePath), { recursive: true })
}

export async function remove(rootId: string, relativePath: string): Promise<void> {
  const target = await resolveInRoot(rootId, relativePath)
  const root = roots.get(rootId)
  // Deleting the root itself is never what the user meant.
  if (root && target === root.path) throw new Error('Refusing to delete the root folder')
  await rm(target, { recursive: true, force: true })
}

export async function move(rootId: string, from: string, to: string): Promise<void> {
  await rename(await resolveInRoot(rootId, from), await resolveInRoot(rootId, to))
}

export async function reveal(rootId: string, relativePath: string): Promise<void> {
  shell.showItemInFolder(await resolveInRoot(rootId, relativePath))
}

/** Exported for tests: the traversal guard is the part that must never regress. */
export const __testing = { resolveInRoot, roots, basename }
