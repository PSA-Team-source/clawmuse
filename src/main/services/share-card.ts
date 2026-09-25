import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, ShareMenu, app, clipboard, dialog, nativeImage, net, session } from 'electron'
import log from 'electron-log/main.js'
import { parseShareCardInput, shareCardFileName, type ShareCardAction, type ShareCardInput, type ShareCardRender } from '@shared/share-card'
import { CARD_WIDTH, shareCardHtml } from './share-card-html.js'

/**
 * Share cards, drawn here rather than in the renderer so the PNG is the same
 * pixels on every machine: an offscreen window at 2x loads a static page (no
 * script, no network — see share-card-html.ts), and `capturePage` takes it.
 * The picture never leaves this computer unless the user copies, saves or
 * shares it themselves.
 */

const SCALE = 2
const MAX_HEIGHT = 2000
const RENDER_TIMEOUT_MS = 20_000
const IMAGE_TIMEOUT_MS = 8_000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // inlined as base64, under SHARE_CARD_LIMITS.imageDataUri
/** Rendered cards kept for Copy / Save / Share; the oldest go first. */
const KEEP = 6
const PARTITION = 'clawmuse-share-card'
const RASTER = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const rendered = new Map<string, { png: Buffer; fileName: string }>()
let queue: Promise<unknown> = Promise.resolve()
let sessionLocked = false

function workDir(): string {
  return join(app.getPath('temp'), 'ClawMuse share cards')
}

/** The card page may read its own file and inline data, and nothing else. */
function lockSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION, { cache: false })
  if (!sessionLocked) {
    sessionLocked = true
    const allowedDir = pathToFileURL(workDir()).href
    ses.webRequest.onBeforeRequest((details, callback) => {
      const ok = details.url.startsWith('data:') || details.url.startsWith(allowedDir)
      if (!ok) log.warn('[share-card] blocked request from card page:', details.url.slice(0, 200))
      callback({ cancel: !ok })
    })
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  }
  return ses
}

/**
 * The card's picture as an inline `data:` URI, or null when there is none worth
 * showing — a card without a picture shows no picture, never an empty frame.
 */
async function loadImage(source: string | undefined): Promise<string | null> {
  if (!source) return null
  if (source.startsWith('data:')) return source
  try {
    const response = await net.fetch(source, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS), redirect: 'follow', credentials: 'omit' } as RequestInit)
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const declared = Number(response.headers.get('content-length') ?? 0)
    // A redirect must not have downgraded the picture to plain http.
    const final = response.url || source
    if (!response.ok || !RASTER.has(type) || declared > MAX_IMAGE_BYTES || !final.startsWith('https://')) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null
    return `data:${type};base64,${bytes.toString('base64')}`
  } catch (error) {
    log.info('[share-card] picture unavailable, card drawn without it:', (error as Error).message)
    return null
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took too long`)), ms) }),
  ])
}

/**
 * The offscreen window's first whole frame at the final size. Offscreen frames
 * arrive through `paint` (capturePage has no surface to read from there), and
 * the size check skips frames still laid out at the pre-resize height.
 */
function frameAt(win: BrowserWindow, width: number, height: number): Promise<Electron.NativeImage> {
  return new Promise((resolve, reject) => {
    const onPaint = (_event: Electron.Event, _dirty: Electron.Rectangle, image: Electron.NativeImage): void => {
      const size = image.getSize()
      if (size.width !== width || size.height !== height) return
      clearTimeout(timer)
      win.webContents.off('paint', onPaint)
      resolve(image)
    }
    const timer = setTimeout(() => { win.webContents.off('paint', onPaint); reject(new Error('The card did not finish drawing')) }, 5000)
    win.webContents.on('paint', onPaint)
    win.webContents.invalidate()
  })
}

async function draw(card: ShareCardInput): Promise<Buffer> {
  const image = await loadImage(card.image)
  const html = shareCardHtml({ ...card, image: image ?? undefined })
  const dir = workDir()
  await mkdir(dir, { recursive: true })
  const file = join(dir, `card-${randomUUID()}.html`)
  await writeFile(file, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    width: CARD_WIDTH,
    height: 800,
    useContentSize: true,
    frame: false,
    enableLargerThanScreen: true,
    webPreferences: {
      offscreen: { deviceScaleFactor: SCALE },
      session: lockSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      webgl: false,
      // The page has no script of its own (and its CSP allows none); JS stays
      // on only so main can wait for the picture and measure the layout.
      javascript: true,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    await win.loadFile(file)
    // A picture that will not decode is removed, not left as an empty box.
    const height = await win.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready
      for (const img of Array.from(document.images)) { try { await img.decode() } catch { img.remove() } }
      return Math.ceil(document.getElementById('card').getBoundingClientRect().height)
    })()`) as number
    const cssHeight = Math.min(Math.max(Math.ceil(Number(height) || 0), 200), MAX_HEIGHT)
    const frame = frameAt(win, CARD_WIDTH * SCALE, cssHeight * SCALE)
    win.setContentSize(CARD_WIDTH, cssHeight)
    const png = (await frame).toPNG()
    if (!png.length) throw new Error('The card came out empty')
    return png
  } finally {
    win.destroy()
    void rm(file, { force: true })
  }
}

/** Draws a card and keeps it for Copy / Save / Share. One at a time: each is a whole offscreen page. */
export function renderShareCard(raw: unknown): Promise<ShareCardRender> {
  const run = async (): Promise<ShareCardRender> => {
    try {
      const card = parseShareCardInput(raw)
      const png = await withTimeout(draw(card), RENDER_TIMEOUT_MS, 'Drawing the card')
      const id = randomUUID()
      rendered.set(id, { png, fileName: shareCardFileName(card) })
      while (rendered.size > KEEP) rendered.delete(rendered.keys().next().value!)
      const size = nativeImage.createFromBuffer(png).getSize()
      return { ok: true, id, dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: size.width, height: size.height }
    } catch (error) {
      log.warn('[share-card] render failed:', (error as Error).message)
      return { ok: false, error: (error as Error).message }
    }
  }
  const next = queue.then(run, run)
  queue = next
  return next
}

function take(id: unknown): { png: Buffer; fileName: string } | null {
  return typeof id === 'string' ? rendered.get(id) ?? null : null
}

const GONE: ShareCardAction = { ok: false, error: 'That card is no longer available. Make it again.' }

export function copyShareCard(id: unknown): ShareCardAction {
  const card = take(id)
  if (!card) return GONE
  clipboard.writeImage(nativeImage.createFromBuffer(card.png))
  return { ok: true }
}

export async function saveShareCard(win: BrowserWindow | null, id: unknown): Promise<ShareCardAction> {
  const card = take(id)
  if (!card) return GONE
  const options: Electron.SaveDialogOptions = {
    title: 'Save image',
    defaultPath: join(app.getPath('downloads'), card.fileName),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: false, error: 'Canceled', canceled: true }
  const path = /\.png$/i.test(result.filePath) ? result.filePath : `${result.filePath}.png`
  try {
    await writeFile(path, card.png)
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
  return { ok: true, path }
}

/** macOS share sheet (AirDrop, Messages, Mail, …) with the PNG as a file. */
export async function shareCardViaSystem(win: BrowserWindow | null, id: unknown): Promise<ShareCardAction> {
  if (process.platform !== 'darwin') return { ok: false, error: 'Sharing is not available on this computer' }
  const card = take(id)
  if (!card) return GONE
  // ponytail: shared files stay in the temp folder until the OS clears it; the
  // share sheet reads them after popup() returns, so they cannot be deleted here.
  const dir = join(workDir(), String(id))
  await mkdir(dir, { recursive: true })
  const path = join(dir, card.fileName)
  await writeFile(path, card.png)
  new ShareMenu({ filePaths: [path] }).popup(win ? { window: win } : {})
  return { ok: true }
}
