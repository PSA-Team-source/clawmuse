// Ported from mobile `src/features/room3d/engine/scene-data.ts`. Two changes:
//  1. `CharacterData` comes from the local `./types` module (see that file's doc
//     comment for why it isn't in the shared `@/types`).
//  2. The desktop `GameCharacter.name` field replaces mobile's `skillName` —
//     same value, different key (desktop's domain model was ported earlier
//     and settled on `name`; see `@/types`).
import { hashStr, hexToInt } from './materials'
import { SKIN_PALETTE, HAIR_PALETTE } from './constants'
import type { CharacterData } from './types'
import type { GameCharacter } from '@/types'

export function gameCharToSceneData(
  char: Pick<GameCharacter, 'skillId' | 'name' | 'description' | 'color' | 'bodyStyle'>,
  index: number,
  taskCount?: number,
  isProcessing?: boolean,
  lastMessage?: string,
): CharacterData {
  const h = hashStr(char.skillId)
  return {
    name: char.name,
    cls: char.bodyStyle.charAt(0).toUpperCase() + char.bodyStyle.slice(1),
    accent: char.color,
    accentHex: hexToInt(char.color),
    skin: SKIN_PALETTE[h % SKIN_PALETTE.length]!,
    hair: HAIR_PALETTE[(h + 3) % HAIR_PALETTE.length]!,
    style: char.bodyStyle,
    stats: [40 + (h % 50), 40 + ((h >> 4) % 50), 40 + ((h >> 8) % 50)],
    taskCount: taskCount || 0,
    isProcessing: isProcessing || false,
    lastMessage,
  }
}
