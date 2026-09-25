// Ported verbatim from mobile `src/features/room3d/engine/constants.ts` — pure
// data, no RN dependency. Every value here is load-bearing for room geometry
// parity: changing a color or a desk/idle position moves furniture/agents.
export const BODY_STYLES = ["mage", "striker", "sentinel", "healer"];
export const ACCENT_COLORS = ["#00f0ff", "#ff2d78", "#a855f7", "#34d399", "#ffaa44", "#ff9500", "#00c2ff", "#e040fb"];
export const SKIN_PALETTE = [0xf0c8a0, 0xd4a574, 0xe8c8b8, 0xc8a882, 0xf5d6c0, 0xdbb89e, 0xe0c4a8, 0xccaa88];
export const HAIR_PALETTE = [0x2244ff, 0xff4444, 0x6622cc, 0x225533, 0x884422, 0x222244, 0xcc8844, 0x993366];

export const ROOM_COLORS = {
  floor: 0x1a1a2e, floorAlt: 0x16162a, base: 0x0d0d18,
  wallZ: 0x1e1e35, wallX: 0x1a1a30, trim: 0x2a2a45,
  desk: 0x2d2d4a, deskLeg: 0x3a3a55, monitor: 0x111122,
  rug: 0x1a1040, rugRing: 0x3a2080, pedestal: 0x2a2a45, crate: 0x3d3520,
  holoTable: 0x222240,
};
export const C = ROOM_COLORS;

export const DESK_POSITIONS: [number, number, number][] = [
  [0, 0, -5],
  [-3, 0, -3], [1.5, 0, -3],
  [-0.5, 0, -1], [3.5, 0, -1],
  [-3.5, 0, -1], [4.5, 0, -3],
];

export const IDLE_POSITIONS: [number, number, number][] = [
  [-3.5, 0, 2.5], [-1.5, 0, 2.0], [0.5, 0, 3.0], [2.0, 0, 2.0],
  [-1.0, 0, 4.0], [1.5, 0, 4.5], [-4.0, 0, 3.5], [3.5, 0, 1.0],
];

export const DEFAULT_CHAR_DATA = [
  { name: "Kira", cls: "Cyber Mage", accent: "#00f0ff", accentHex: 0x00f0ff, skin: 0xf0c8a0, hair: 0x2244ff, style: "mage", stats: [85, 60, 92] },
  { name: "Blaze", cls: "Striker", accent: "#ff2d78", accentHex: 0xff2d78, skin: 0xd4a574, hair: 0xff4444, style: "striker", stats: [95, 72, 55] },
  { name: "Nova", cls: "Sentinel", accent: "#a855f7", accentHex: 0xa855f7, skin: 0xe8c8b8, hair: 0x6622cc, style: "sentinel", stats: [70, 90, 80] },
  { name: "Sage", cls: "Healer", accent: "#34d399", accentHex: 0x34d399, skin: 0xc8a882, hair: 0x225533, style: "healer", stats: [50, 88, 96] },
];
