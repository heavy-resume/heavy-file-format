import type { CanvasDrawing, CanvasPoint } from './canvas-drawing-format';
import { shapeBounds } from './canvas-shapes';
import type { CanvasBounds } from './canvas-selection';

// Alignment guides: while drawing, moving, or dragging a handle, a point (or a
// selection's edges and center) snaps its x and/or y to key points of other
// items. Targets are collected and sorted once per gesture, so each pointer
// move is a binary search per axis.

// Screen-pixel reach for alignment; converted to logical units by callers.
export const GUIDE_SNAP_PX = 6;
// Once snapped, an axis holds until the pointer moves this much further away,
// so points near the edge of the range do not flicker.
const GUIDE_RELEASE_FACTOR = 1.5;

export interface CanvasGuideTargets {
  xs: number[];
  ys: number[];
}

// Snapped guide positions to draw; null where an axis is free.
export interface CanvasGuideLines {
  x: number | null;
  y: number | null;
}

// Per-gesture memory of which target each axis is held to.
export interface CanvasGuideHold {
  x: number | null;
  y: number | null;
}

export const NO_GUIDE_LINES: CanvasGuideLines = { x: null, y: null };

// Key points of every item on visible layers, except the excluded ids (the
// items being moved or the line being adjusted): box edges and centers, line
// ends, and text centers.
export function collectGuideTargets(drawing: CanvasDrawing, excludeIds: ReadonlySet<string>): CanvasGuideTargets {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const layer of drawing.layers) {
    if (!layer.visible) continue;
    for (const item of layer.items) {
      if (item.kind === 'fill' || item.kind === 'brush' || excludeIds.has(item.id)) continue;
      if (item.kind === 'text') {
        xs.push(item.at.x);
        ys.push(item.at.y);
      } else if (item.shape === 'line') {
        xs.push(item.from.x, item.to.x);
        ys.push(item.from.y, item.to.y);
      } else {
        const { left, top, right, bottom } = shapeBounds(item);
        xs.push(left, (left + right) / 2, right);
        ys.push(top, (top + bottom) / 2, bottom);
      }
    }
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  return { xs, ys };
}

function nearest(sorted: number[], value: number): number | null {
  if (sorted.length === 0) return null;
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  const after = sorted[low]!;
  const before = low > 0 ? sorted[low - 1]! : after;
  return Math.abs(before - value) <= Math.abs(after - value) ? before : after;
}

// Snaps one coordinate: keeps a held target while within the release reach,
// otherwise takes the nearest target within range.
function snapAxis(value: number, sorted: number[], range: number, held: number | null): number | null {
  if (held !== null && Math.abs(value - held) <= range * GUIDE_RELEASE_FACTOR) return held;
  const candidate = nearest(sorted, value);
  return candidate !== null && Math.abs(candidate - value) <= range ? candidate : null;
}

export function snapPointToGuides(
  point: CanvasPoint,
  targets: CanvasGuideTargets,
  range: number,
  hold: CanvasGuideHold,
  axes: { x: boolean; y: boolean } = { x: true, y: true },
): { point: CanvasPoint; hold: CanvasGuideHold; lines: CanvasGuideLines } {
  const x = axes.x ? snapAxis(point.x, targets.xs, range, hold.x) : null;
  const y = axes.y ? snapAxis(point.y, targets.ys, range, hold.y) : null;
  return { point: { x: x ?? point.x, y: y ?? point.y }, hold: { x, y }, lines: { x, y } };
}

// Snaps a moving box by whichever of its edges or center lands closest to a
// target, per axis. Returns the offset to add to the move.
export function snapBoundsToGuides(
  bounds: CanvasBounds,
  targets: CanvasGuideTargets,
  range: number,
  hold: CanvasGuideHold,
): { dx: number; dy: number; hold: CanvasGuideHold; lines: CanvasGuideLines } {
  const axis = (anchors: number[], sorted: number[], held: number | null) => {
    let best: { target: number; offset: number } | null = null;
    for (const anchor of anchors) {
      const target = snapAxis(anchor, sorted, range, held);
      if (target === null) continue;
      const offset = target - anchor;
      if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { target, offset };
    }
    return best;
  };
  const x = axis([bounds.left, (bounds.left + bounds.right) / 2, bounds.right], targets.xs, hold.x);
  const y = axis([bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom], targets.ys, hold.y);
  return {
    dx: x?.offset ?? 0,
    dy: y?.offset ?? 0,
    hold: { x: x?.target ?? null, y: y?.target ?? null },
    lines: { x: x?.target ?? null, y: y?.target ?? null },
  };
}
