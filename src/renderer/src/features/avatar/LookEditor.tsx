import { SettingsButton } from '@/components/settings'
import { cn } from '@/lib/cn'
import { AVATAR_ACCESSORIES, AVATAR_STYLES, type AvatarConfig } from './config'
import { useLook } from './look'

const STYLE_LABEL: Record<(typeof AVATAR_STYLES)[number], string> = { muse: 'ClawMuse', mage: 'Mage', striker: 'Striker', sentinel: 'Sentinel', healer: 'Healer' }
const ACCESSORY_LABEL: Record<(typeof AVATAR_ACCESSORIES)[number], string> = { none: 'None', cap: 'Cap', glasses: 'Glasses', crown: 'Crown', headphones: 'Headphones' }
const OUTFITS = ['#FF5A4E', '#FF0000', '#2F6BFF', '#1FA971', '#8E5CF6', '#F5A524', '#1B1B1F', '#F2F2F7']
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!

/**
 * The 3D look (workspace avatar.json). Each choice is written at once, so the
 * preview and every avatar in the app follow it live — the same file the
 * assistant edits when asked to change its look.
 */
export function LookEditor() {
  const look = useLook() ?? {}
  const set = (next: AvatarConfig) => void window.clawmuse.avatar.set(next as Record<string, unknown>)
  const chip = (active: boolean) => cn('h-7 rounded-full px-3 text-caption font-medium', active ? 'bg-content-primary text-bg-base' : 'bg-fill-strong text-content-primary hover:bg-fill-stronger')
  const style = look.style ?? 'muse'
  const accessory = look.accessory ?? 'none'
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 text-caption text-content-secondary">Look</p>
        <div className="flex flex-wrap gap-1.5">{AVATAR_STYLES.map((s) => <button key={s} type="button" className={chip(style === s)} onClick={() => set({ ...look, style: s })}>{STYLE_LABEL[s]}</button>)}</div>
      </div>
      <div>
        <p className="mb-1.5 text-caption text-content-secondary">Accessory</p>
        <div className="flex flex-wrap gap-1.5">{AVATAR_ACCESSORIES.map((a) => <button key={a} type="button" className={chip(accessory === a)} onClick={() => set({ ...look, accessory: a })}>{ACCESSORY_LABEL[a]}</button>)}</div>
      </div>
      <div>
        <p className="mb-1.5 text-caption text-content-secondary">Outfit</p>
        <div className="flex flex-wrap gap-2">
          {OUTFITS.map((c) => (
            <button key={c} type="button" aria-label={`Outfit ${c}`} onClick={() => set({ ...look, colors: { ...look.colors, outfit: c } })}
              className={cn('size-7 rounded-full ring-offset-2 ring-offset-bg-panel', (look.colors?.outfit ?? '#FF5A4E').toUpperCase() === c ? 'ring-2 ring-content-primary' : 'ring-1 ring-fill-stronger')}
              style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <SettingsButton onClick={() => set({ style: pick(AVATAR_STYLES), accessory: pick(AVATAR_ACCESSORIES), colors: { outfit: pick(OUTFITS) }, seed: Math.random().toString(36).slice(2, 8) })}>Surprise me</SettingsButton>
        <SettingsButton onClick={() => set({})}>Reset</SettingsButton>
      </div>
    </div>
  )
}
