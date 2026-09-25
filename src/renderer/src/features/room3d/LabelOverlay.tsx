import type { LabelVM } from './engine/labels'

/**
 * Absolutely-positioned name plates over the 3D canvas, placed at each
 * character's projected screen coordinate (`engine.projectAnchors`). Ported
 * from mobile `LabelOverlay.tsx` (RN `View`/`Text`) as plain DOM + inline
 * style — the position math is per-frame and per-pixel, so it stays inline
 * rather than moving to Tailwind classes.
 */
export function LabelOverlay({ labels }: { labels: LabelVM[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {labels.map((l) => (
        <div
          key={l.skillId}
          className="absolute flex w-[100px] flex-col items-center"
          style={{ left: l.xPx - 50, top: l.yPx - 28 }}
        >
          <div
            className="rounded-box border bg-room-void/70 px-2 py-0.5"
            style={{ borderColor: l.accent }}
          >
            <span
              className="block max-w-[84px] truncate text-micro font-bold"
              style={{ color: l.accent }}
            >
              {l.name}
            </span>
          </div>
          {l.taskCount > 0 && (
            <span
              className="mt-0.5 rounded-full px-1.5 py-0.5 text-micro font-extrabold text-room-void"
              style={{ backgroundColor: l.accent }}
            >
              {l.taskCount}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
