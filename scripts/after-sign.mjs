// Runs after electron-builder's signing step, before the DMG/zip are made.
//
// Without a Developer ID certificate electron-builder skips signing, and the
// bundle keeps Electron's own linker ad-hoc signature over files that
// electron-builder has since changed — `codesign --verify` fails with "code has
// no resources but signature indicates they must be present". A quarantined
// download in that state is reported by macOS as "damaged and can't be
// opened", with no way past it. A fresh ad-hoc signature over the finished
// bundle turns that into the normal unidentified-developer prompt ("Open
// Anyway" in Privacy & Security), which is what the download page explains.
// A bundle that already verifies (a real Developer ID signature) is left alone.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const verify = () => spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' })
  if (verify().status === 0) return
  const sign = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], { encoding: 'utf8' })
  const check = verify()
  if (sign.status !== 0 || check.status !== 0) {
    throw new Error(`ad-hoc signing ${app} failed: ${sign.stderr || check.stderr}`)
  }
  console.log(`  • afterSign        ad-hoc signed ${path.basename(app)} (no Developer ID) — opens via "Open Anyway", not "damaged"`)
}
