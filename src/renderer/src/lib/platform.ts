/**
 * Platform-aware copy for the desktop app. Electron's user agent names the OS,
 * so this works in the renderer without asking main.
 */
const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent

export const IS_WINDOWS = /Windows/i.test(ua)

/** macOS: the only platform with a native share sheet (AirDrop, Messages, Mail…). */
export const IS_MAC = /Macintosh|Mac OS X/i.test(ua)

/** What to call the user's computer in copy: "this Mac" / "this PC". */
export const DEVICE = IS_WINDOWS ? 'PC' : 'Mac'

/** A macOS shortcut hint in the platform's own notation: ⌘K → Ctrl+K, ⌥Space → Alt+Space. */
export function keys(mac: string): string {
  if (!IS_WINDOWS) return mac
  return mac.replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+').replace(/⌘/g, 'Ctrl+')
}
