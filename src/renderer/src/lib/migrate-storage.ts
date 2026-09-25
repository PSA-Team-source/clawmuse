/**
 * The app was called LocalFang, and its renderer state (appearance, chat theme,
 * groups, approval history, roster prefs, the storage-service cache) sits in
 * localStorage under `localfang:` / `localfang.` keys. After the ClawMuse rename
 * every store reads `clawmuse:` / `clawmuse.` instead, so copy each old key to
 * its new name once — before any store module reads it. An existing new key is
 * never overwritten, and the old keys are left in place.
 *
 * Imported FIRST in main.tsx: ES modules evaluate in import order, and the
 * stores read localStorage at module evaluation.
 */
export function migrateLegacyStorage(storage: Storage): number {
  let copied = 0
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key || !/^localfang[:.]/.test(key)) continue
    const next = `clawmuse${key.slice('localfang'.length)}`
    if (storage.getItem(next) !== null) continue
    const value = storage.getItem(key)
    if (value !== null) {
      storage.setItem(next, value)
      copied++
    }
  }
  return copied
}

try {
  migrateLegacyStorage(window.localStorage)
} catch {
  // Storage unavailable (private mode, quota): the app starts with defaults.
}
