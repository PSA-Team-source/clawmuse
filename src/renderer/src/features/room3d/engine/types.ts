/**
 * Internal scene-data shape consumed by the room3d engine (character.ts,
 * scene-data.ts, engine.ts). This is deliberately NOT part of the domain
 * model in `@/types` — `GameCharacter` is what the store hands to the UI,
 * `CharacterData` is what the three.js builders need (resolved palette
 * colors, body style, per-frame dynamic flags). `gameCharToSceneData`
 * bridges the two. Ported from mobile `src/types/room.types.ts`.
 */
export interface CharacterData {
  name: string
  cls: string
  accent: string
  accentHex: number
  skin: number
  hair: number
  style: string
  stats: number[]
  taskCount?: number
  isProcessing?: boolean
  lastMessage?: string
}
