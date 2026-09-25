// Runs once per platform/arch before electron-builder copies anything, so the
// OpenClaw runtime for exactly this target exists at
// vendor/openclaw/${os}-${arch}/ when electron-builder.yml's extraResources
// picks it up. A multi-arch build (`--mac --arm64 --x64`) gets one per arch.
import { Arch } from 'electron-builder'
import { vendorOpenclaw } from './vendor-openclaw.mjs'

export default async function beforePack(context) {
  const os = context.packager.platform.buildConfigurationKey // 'mac' | 'win' | 'linux'
  await vendorOpenclaw(`${os}-${Arch[context.arch]}`)
}
