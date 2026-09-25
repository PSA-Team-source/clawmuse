import { join } from 'node:path'
import { app } from 'electron'

/** `app.isPackaged` is the only signal that survives both `electron-vite dev`
 *  and `electron-vite preview`, unlike NODE_ENV. */
export const isDev = !app.isPackaged

/**
 * Where the renderer lives in each mode. `ELECTRON_RENDERER_URL` is injected by
 * electron-vite in `dev`; in a packaged app we load the built HTML off disk.
 */
export const rendererEntry = {
  devServerUrl: process.env.ELECTRON_RENDERER_URL ?? null,
  file: join(import.meta.dirname, '../renderer/index.html'),
  /** Origin allowed to stay inside the app window (see `will-navigate`). */
  get origin(): string {
    return process.env.ELECTRON_RENDERER_URL ?? 'file://'
  },
}

export const PROTOCOL = 'clawmuse'
/**
 * The scheme before the ClawMuse rename. Still registered and still accepted:
 * the web app's Facebook OAuth bounce targets `localfang://oauth/facebook`,
 * and a link a user saved keeps working.
 */
export const LEGACY_PROTOCOL = 'localfang'

/**
 * Absolute path to the built preload bundle.
 *
 * The extension is `.mjs`, not `.js`: this package is `"type": "module"`, so
 * electron-vite emits the preload as ESM and Electron only treats a preload as
 * ESM when the file ends in `.mjs` (and the window has `sandbox: false`).
 * Pointing at `index.js` silently fails to load the bridge — the window still
 * opens, but `window.clawmuse` is undefined and every screen breaks.
 */
export const PRELOAD_PATH = join(import.meta.dirname, '../preload/index.mjs')

/**
 * Absolute path to a file under `resources/`.
 *
 * In dev the folder sits at the repo root; once packaged, electron-builder
 * copies it next to the asar (it is listed under `asarUnpack`), which is what
 * `process.resourcesPath` points at.
 */
export function resourcePath(...segments: string[]): string {
  // Packaged: electron-builder copies `resources/` verbatim via `extraResources`,
  // so it sits beside app.asar at Contents/Resources/resources. Do NOT rely on
  // it being inside the asar — an asarUnpack'd path resolves to
  // Contents/Resources/app.asar.unpacked/resources instead, which is where this
  // silently broke the tray icon the first time round.
  const base = isDev
    ? join(import.meta.dirname, '../../resources')
    : join(process.resourcesPath, 'resources')
  return join(base, ...segments)
}

/**
 * Absolute path to a file under `build/` — the icon artefacts that
 * `scripts/generate-icons.sh` writes.
 *
 * Dev only. `build/` is electron-builder's `buildResources` directory: it is
 * packaging *input*, consumed at package time and never copied into the app, so
 * every caller must be behind an `isDev` check. Resolution mirrors
 * `resourcePath()` above — main is bundled to `out/main/index.js`, so two levels
 * up from `import.meta.dirname` is the project root.
 */
export function devBuildPath(...segments: string[]): string {
  return join(import.meta.dirname, '../../build', ...segments)
}
