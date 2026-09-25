import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { BrowserWindow, app, screen } from 'electron'
import log from 'electron-log/main.js'
import type { DroppedFile } from '@shared/ipc'
import { PRELOAD_PATH, resourcePath } from '../env.js'
import { getAppPreferences } from '../services/app-preferences.js'
import { createMainWindow, focusedOrFirstWindow, getMainWindows } from './main-window.js'
import { getQuickChatWindow } from './quick-chat.js'

/**
 * Muse's "floating button" (its ambient pill): a small always-on-top capsule —
 * app avatar + name — shown while no ClawMuse window is on screen. Click opens
 * the app, drag moves it, dropping files starts a chat with them attached, and
 * it reads "Thinking" while a reply is generating.
 */

const HEIGHT = 43
const MAX_DROP_FILES = 10
const MAX_DROP_BYTES = 25 * 1024 * 1024

let pill: BrowserWindow | null = null
// ponytail: position lives for the session only; persist it next to
// app-preferences if users ask for the pill to stay where they left it.
let position: { x: number; y: number } | null = null
let width = 120
const busyRenderers = new Set<number>()
let pendingFiles: DroppedFile[] | null = null
/** The agent's name and avatar image, as Muse's pill shows its agent. */
let identity: { name: string; image: string | null } = { name: 'ClawMuse', image: null }
// `browser-window-created` fires inside the constructor, before `pill` is set.
let constructingPill = false

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html',
}

let appIcon = ''
function appIconDataUrl(): string {
  if (appIcon) return appIcon
  try {
    appIcon = `data:image/png;base64,${readFileSync(resourcePath('icon.png')).toString('base64')}`
  } catch (err) {
    log.warn('[floating-button] icon unavailable:', (err as Error).message)
  }
  return appIcon
}

function pillHtml(): string {
  const avatar = identity.image ?? appIconDataUrl()
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;background:transparent;overflow:hidden;font:500 15px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-user-select:none;user-select:none}
#pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:9px;height:${HEIGHT}px;padding:0 16px 0 3.5px;border-radius:999px;background:rgba(45,45,47,.94);border:1px solid rgba(255,255,255,.12);color:#fff;cursor:default;white-space:nowrap}
#pill.drop{background:rgba(23,147,255,.94)}
img{width:36px;height:36px;border-radius:50%;object-fit:cover;background:#fff;pointer-events:none}
</style></head><body>
<div id="pill" role="button" tabindex="0" aria-label="Open ClawMuse">${avatar ? `<img id="avatar" src="${avatar}" alt="">` : ''}<span id="label"></span></div>
<script>
const pill=document.getElementById('pill'),label=document.getElementById('label'),api=window.clawmuse.floating;
let name=${JSON.stringify(identity.name)},idle=name,start=null,moved=false;label.textContent=idle;
const fit=()=>api.resize(Math.ceil(pill.getBoundingClientRect().width));
api.onIdentity(i=>{name=i.name;const img=document.getElementById('avatar');if(img&&i.image)img.src=i.image;if(idle!=='Thinking'){idle=name;if(!pill.classList.contains('drop')){label.textContent=idle;fit()}}});
api.onBusy(b=>{idle=b?'Thinking':name;if(!pill.classList.contains('drop')){label.textContent=idle;fit()}});
pill.addEventListener('pointerdown',e=>{start={x:e.screenX,y:e.screenY};moved=false;pill.setPointerCapture(e.pointerId)});
pill.addEventListener('pointermove',e=>{if(!start)return;const dx=e.screenX-start.x,dy=e.screenY-start.y;if(!moved&&Math.hypot(dx,dy)<4)return;moved=true;start={x:e.screenX,y:e.screenY};api.moveBy(dx,dy)});
pill.addEventListener('pointerup',()=>{if(start&&!moved)api.open();start=null});
pill.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')api.open()});
const setDrop=on=>{pill.classList.toggle('drop',on);label.textContent=on?'Drop files':idle;fit()};
document.addEventListener('dragover',e=>{e.preventDefault();setDrop(true)});
document.addEventListener('dragleave',()=>setDrop(false));
document.addEventListener('drop',e=>{e.preventDefault();setDrop(false);api.drop([...e.dataTransfer.files])});
fit();
</script></body></html>`
}

function defaultPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  // Bottom-centre, just above the Dock — where Muse parks its pill.
  return { x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + workArea.height - HEIGHT - 19) }
}

function create(): BrowserWindow {
  const pos = position ?? defaultPosition()
  constructingPill = true
  const win = new BrowserWindow({
    ...pos,
    width,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // NSPanel: floats over full-screen apps without making ClawMuse a UIElement.
    type: 'panel',
    skipTaskbar: true,
    focusable: false,
    // The pill mostly shows while another app is active; without this macOS
    // spends the first click activating ClawMuse and the pill never sees it.
    acceptFirstMouse: true,
    alwaysOnTop: true,
    webPreferences: { preload: PRELOAD_PATH, contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  constructingPill = false
  win.setAlwaysOnTop(true, 'floating')
  // `skipTransformProcessType`: otherwise Electron makes the whole app a
  // UIElement to reach full-screen spaces, and ClawMuse vanishes from the Dock.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.on('moved', () => {
    const { x, y } = win.getBounds()
    position = { x, y }
  })
  win.on('closed', () => { pill = null })
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('floating-busy', busyRenderers.size > 0)
    // A window may have appeared while the pill loaded; decide again before showing.
    if (wantsPill()) win.showInactive()
    else win.close()
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pillHtml())}`)
  return win
}

export function isFloatingButtonWindow(win: BrowserWindow | null): boolean {
  return !!win && !!pill && !pill.isDestroyed() && win.id === pill.id
}

/** Show the pill exactly when the setting is on and no ClawMuse window is on screen. */
function wantsPill(): boolean {
  const quick = getQuickChatWindow()
  const anyVisible = getMainWindows().some((w) => w.isVisible() && !w.isMinimized()) || !!quick?.isVisible()
  return getAppPreferences().showFloatingButton && !anyVisible
}

export function syncFloatingButton(): void {
  if (wantsPill()) {
    if (!pill || pill.isDestroyed()) pill = create()
    else if (!pill.isVisible()) pill.showInactive()
  } else if (pill && !pill.isDestroyed()) {
    pill.close()
  }
}

/** Re-evaluate whenever any window appears, hides, minimises or closes. */
export function watchWindowsForFloatingButton(): void {
  const resync = () => setImmediate(syncFloatingButton)
  app.on('browser-window-created', (_event, win) => {
    if (constructingPill) return
    // 'show' is not reliably emitted when a window created hidden is revealed on
    // ready-to-show, so those events are watched too.
    for (const event of ['show', 'ready-to-show', 'focus', 'hide', 'minimize', 'restore', 'closed'] as const) win.on(event as 'show', resync)
    const id = win.webContents.id
    win.webContents.once('destroyed', () => setRendererBusy(id, false))
  })
  resync()
}

export function openFromFloatingButton(): void {
  const win = focusedOrFirstWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  app.focus({ steal: true })
}

export function moveFloatingButton(dx: number, dy: number): void {
  if (!pill || pill.isDestroyed() || !Number.isFinite(dx) || !Number.isFinite(dy)) return
  const { x, y } = pill.getBounds()
  const next = { x: Math.round(x + dx), y: Math.round(y + dy) }
  const { workArea } = screen.getDisplayNearestPoint(next)
  // Keep it reachable: never let a drag push the pill off every display.
  next.x = Math.min(Math.max(next.x, workArea.x), workArea.x + workArea.width - width)
  next.y = Math.min(Math.max(next.y, workArea.y), workArea.y + workArea.height - HEIGHT)
  pill.setPosition(next.x, next.y)
  position = next
}

export function resizeFloatingButton(next: number): void {
  if (!Number.isFinite(next)) return
  width = Math.min(Math.max(Math.round(next), HEIGHT), 320)
  if (pill && !pill.isDestroyed()) pill.setSize(width, HEIGHT)
}

/** Each renderer reports whether a reply is generating; the pill says "Thinking" while any is. */
export function setRendererBusy(id: number, busy: boolean): void {
  const before = busyRenderers.size > 0
  if (busy) busyRenderers.add(id)
  else busyRenderers.delete(id)
  const after = busyRenderers.size > 0
  if (before !== after && pill && !pill.isDestroyed()) pill.webContents.send('floating-busy', after)
}

/** Reads dropped files at the trust boundary: regular files only, capped in count and size. */
export function readDroppedFiles(paths: unknown): DroppedFile[] {
  if (!Array.isArray(paths)) return []
  const files: DroppedFile[] = []
  for (const path of paths.slice(0, MAX_DROP_FILES)) {
    if (typeof path !== 'string' || !path) continue
    try {
      const stat = statSync(path)
      if (!stat.isFile() || stat.size > MAX_DROP_BYTES) continue
      files.push({ name: basename(path), type: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', data: new Uint8Array(readFileSync(path)) })
    } catch (err) {
      log.warn('[floating-button] skipped dropped file:', (err as Error).message)
    }
  }
  return files
}

export function deliverDroppedFiles(files: DroppedFile[]): void {
  if (files.length === 0) return
  const existing = focusedOrFirstWindow()
  if (!existing) {
    // A fresh window has no listener yet — its chat screen collects these on mount.
    pendingFiles = files
    openFromFloatingButton()
    return
  }
  openFromFloatingButton()
  existing.webContents.send('attach-files', files)
}

/** A new window's chat screen pulls a drop that arrived before it could listen. */
export function takePendingDroppedFiles(): DroppedFile[] {
  const files = pendingFiles ?? []
  pendingFiles = null
  return files
}

/** Name + avatar image from the renderer (agent.identity.get); validated at the boundary. */
export function setFloatingIdentity(name: unknown, image: unknown): void {
  const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : 'ClawMuse'
  const cleanImage = typeof image === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image) && image.length < 1_500_000 ? image : null
  identity = { name: cleanName, image: cleanImage }
  if (pill && !pill.isDestroyed()) pill.webContents.send('floating-identity', { name: cleanName, image: cleanImage ?? appIconDataUrl() })
}
