// Ported from mobile `src/features/room3d/engine/labels.ts`. Only change:
// `c.name` replaces mobile's `c.skillName` (desktop `GameCharacter` field rename).
import type { GameCharacter } from '@/types'

export interface Anchor {
  skillIndex: number
  xPx: number
  yPx: number
  visible: boolean
}

export interface LabelVM {
  skillId: string
  name: string
  emoji?: string
  accent: string
  taskCount: number
  xPx: number
  yPx: number
}

export function pickVisibleLabels(
  anchors: Anchor[],
  characters: GameCharacter[],
  taskCounts: Record<string, number>,
): LabelVM[] {
  const out: LabelVM[] = []
  for (const a of anchors) {
    if (!a.visible) continue
    const c = characters[a.skillIndex]
    if (!c) continue
    out.push({
      skillId: c.skillId,
      name: c.name,
      accent: c.color,
      taskCount: taskCounts[c.skillId] || 0,
      xPx: a.xPx,
      yPx: a.yPx,
    })
  }
  return out
}
