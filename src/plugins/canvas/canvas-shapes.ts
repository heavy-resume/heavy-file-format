import type { CanvasBrushItem, CanvasItem, CanvasLineEnd, CanvasPoint, CanvasShapeItem, CanvasShapeType, CanvasTextItem } from './canvas-drawing-format';
import { runsToLines, textItemRuns } from './canvas-text-runs';

// Pure geometry for shapes and text: constraints, outlines, handles, hit
// testing, and snapping. Coordinates are logical canvas units.

export type CanvasHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end' | 'control';

const CURVE_SEGMENTS = 32;
const ELLIPSE_SEGMENTS = 72;
const TEXT_LINE_HEIGHT = 1.25;
// Rough average glyph width as a fraction of font size. Text bounds are only
// used for hit testing, so an estimate keeps this geometry free of the DOM.
const TEXT_GLYPH_WIDTH = 0.56;

// Shift makes rectangles square, ellipses circular, and snaps lines to 45°.
export function constrainShapeEnd(shape: CanvasShapeType, from: CanvasPoint, to: CanvasPoint, constrain: boolean): CanvasPoint {
  if (!constrain) return to;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (shape === 'line') {
    const length = Math.hypot(dx, dy);
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: from.x + Math.sign(dx || 1) * side, y: from.y + Math.sign(dy || 1) * side };
}

export function shapeBounds(shape: CanvasShapeItem): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(shape.from.x, shape.to.x),
    top: Math.min(shape.from.y, shape.to.y),
    right: Math.max(shape.from.x, shape.to.x),
    bottom: Math.max(shape.from.y, shape.to.y),
  };
}

function quadraticPoint(from: CanvasPoint, control: CanvasPoint, to: CanvasPoint, t: number): CanvasPoint {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

// The point on the line the curve handle sits at: the curve's midpoint.
export function lineMidpoint(shape: CanvasShapeItem): CanvasPoint {
  return shape.control
    ? quadraticPoint(shape.from, shape.control, shape.to, 0.5)
    : { x: (shape.from.x + shape.to.x) / 2, y: (shape.from.y + shape.to.y) / 2 };
}

// Inverse of lineMidpoint: the control point whose curve passes through `mid`.
export function controlForMidpoint(shape: CanvasShapeItem, mid: CanvasPoint): CanvasPoint {
  return { x: 2 * mid.x - (shape.from.x + shape.to.x) / 2, y: 2 * mid.y - (shape.from.y + shape.to.y) / 2 };
}

export function linePath(shape: CanvasShapeItem): CanvasPoint[] {
  if (!shape.control) return [shape.from, shape.to];
  return Array.from({ length: CURVE_SEGMENTS + 1 }, (_, index) => quadraticPoint(shape.from, shape.control!, shape.to, index / CURVE_SEGMENTS));
}

// A line's end markers as solid brush-style strokes, so painting and erasing
// treat them like any other stroke: an arrow is an open chevron at the line's
// width; a round end is a single-point dot wider than the line.
export function lineEndStrokes(shape: CanvasShapeItem): Array<{ points: CanvasPoint[]; width: number }> {
  if (shape.shape !== 'line') return [];
  const length = Math.max(10, shape.width * 3.2);
  const spread = Math.PI / 7;
  const marker = (end: CanvasLineEnd, tip: CanvasPoint, toward: CanvasPoint) => {
    if (end === 'round') return { points: [tip], width: Math.max(8, shape.width * 2.5) };
    const angle = Math.atan2(tip.y - toward.y, tip.x - toward.x);
    return {
      points: [
        { x: tip.x - Math.cos(angle - spread) * length, y: tip.y - Math.sin(angle - spread) * length },
        tip,
        { x: tip.x - Math.cos(angle + spread) * length, y: tip.y - Math.sin(angle + spread) * length },
      ],
      width: shape.width,
    };
  };
  const strokes: Array<{ points: CanvasPoint[]; width: number }> = [];
  if (shape.startHead) strokes.push(marker(shape.startHead, shape.from, shape.control ?? shape.to));
  if (shape.endHead) strokes.push(marker(shape.endHead, shape.to, shape.control ?? shape.from));
  return strokes;
}

export function shapeOutline(shape: CanvasShapeItem): CanvasPoint[] {
  const { left, top, right, bottom } = shapeBounds(shape);
  if (shape.shape === 'rect') {
    return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top }];
  }
  if (shape.shape === 'ellipse') {
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = (right - left) / 2;
    const ry = (bottom - top) / 2;
    return Array.from({ length: ELLIPSE_SEGMENTS + 1 }, (_, index) => {
      const angle = (index / ELLIPSE_SEGMENTS) * Math.PI * 2;
      return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
  }
  return linePath(shape);
}

// The shape as brush strokes: its outline (or line path) with its dash, then
// solid end markers. The first stroke keeps the shape's id.
export function shapeToBrushStrokes(shape: CanvasShapeItem): CanvasBrushItem[] {
  return [
    { kind: 'brush', id: shape.id, points: shapeOutline(shape), color: shape.color, width: shape.width, ...(shape.dash ? { dash: shape.dash } : {}) },
    ...lineEndStrokes(shape).map((stroke, index): CanvasBrushItem => ({ kind: 'brush', id: `${shape.id}-head-${index + 1}`, ...stroke, color: shape.color })),
  ];
}

export function shapeHandles(shape: CanvasShapeItem): Array<{ handle: CanvasHandle; point: CanvasPoint }> {
  if (shape.shape === 'line') {
    return [
      { handle: 'start', point: shape.from },
      { handle: 'end', point: shape.to },
      { handle: 'control', point: lineMidpoint(shape) },
    ];
  }
  const { left, top, right, bottom } = shapeBounds(shape);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  return [
    { handle: 'nw', point: { x: left, y: top } },
    { handle: 'n', point: { x: cx, y: top } },
    { handle: 'ne', point: { x: right, y: top } },
    { handle: 'e', point: { x: right, y: cy } },
    { handle: 'se', point: { x: right, y: bottom } },
    { handle: 's', point: { x: cx, y: bottom } },
    { handle: 'sw', point: { x: left, y: bottom } },
    { handle: 'w', point: { x: left, y: cy } },
  ];
}

export function hitShapeHandle(shape: CanvasShapeItem, point: CanvasPoint, radius: number): CanvasHandle | null {
  const hit = shapeHandles(shape).find((entry) => Math.hypot(entry.point.x - point.x, entry.point.y - point.y) <= radius);
  return hit?.handle ?? null;
}

export function hitShapeBody(shape: CanvasShapeItem, point: CanvasPoint, tolerance: number): boolean {
  if (shape.shape === 'line') {
    const path = linePath(shape);
    return path.slice(1).some((end, index) => distanceToSegment(point, path[index]!, end) <= tolerance + shape.width / 2);
  }
  const { left, top, right, bottom } = shapeBounds(shape);
  return point.x >= left - tolerance && point.x <= right + tolerance && point.y >= top - tolerance && point.y <= bottom + tolerance;
}

// Moves the dragged handle; Shift keeps rectangles square and ellipses
// circular, measured from the opposite corner.
export function resizeShape(shape: CanvasShapeItem, handle: CanvasHandle, point: CanvasPoint, constrain: boolean): CanvasShapeItem {
  if (shape.shape === 'line') {
    if (handle === 'start') return { ...shape, from: constrainShapeEnd('line', shape.to, point, constrain) };
    if (handle === 'end') return { ...shape, to: constrainShapeEnd('line', shape.from, point, constrain) };
    if (handle === 'control') return { ...shape, control: controlForMidpoint(shape, point) };
    return shape;
  }
  let { left, top, right, bottom } = shapeBounds(shape);
  if (handle.includes('w')) left = point.x;
  if (handle.includes('e')) right = point.x;
  if (handle.includes('n')) top = point.y;
  if (handle.includes('s')) bottom = point.y;
  if (constrain && handle.length === 2) {
    const anchor = { x: handle.includes('w') ? right : left, y: handle.includes('n') ? bottom : top };
    const corner = constrainShapeEnd(shape.shape, anchor, { x: handle.includes('w') ? left : right, y: handle.includes('n') ? top : bottom }, true);
    return { ...shape, from: anchor, to: corner };
  }
  return { ...shape, from: { x: left, y: top }, to: { x: right, y: bottom } };
}

export function moveCanvasItem<T extends CanvasShapeItem | CanvasTextItem>(item: T, dx: number, dy: number): T {
  const shift = (point: CanvasPoint) => ({ x: point.x + dx, y: point.y + dy });
  if (item.kind === 'text') return { ...item, at: shift(item.at) };
  return {
    ...item,
    from: shift(item.from),
    to: shift(item.to),
    ...(item.control ? { control: shift(item.control) } : {}),
  };
}

export function textBounds(item: CanvasTextItem): { left: number; top: number; right: number; bottom: number } {
  let width = 0;
  let height = 0;
  for (const segments of runsToLines(textItemRuns(item))) {
    const lineWidth = segments.reduce((total, segment) => total + segment.text.length * segment.size * TEXT_GLYPH_WIDTH, 0);
    width = Math.max(width, lineWidth);
    height += (segments.length > 0 ? Math.max(...segments.map((segment) => segment.size)) : item.size) * TEXT_LINE_HEIGHT;
  }
  return { left: item.at.x - width / 2, top: item.at.y - height / 2, right: item.at.x + width / 2, bottom: item.at.y + height / 2 };
}

export const CANVAS_TEXT_LINE_HEIGHT = TEXT_LINE_HEIGHT;

export function hitTextBody(item: CanvasTextItem, point: CanvasPoint, tolerance: number): boolean {
  const { left, top, right, bottom } = textBounds(item);
  return point.x >= left - tolerance && point.x <= right + tolerance && point.y >= top - tolerance && point.y <= bottom + tolerance;
}

// Nearest point on a rectangle or ellipse outline. Ellipses project along the
// ray from their center, which lands arrows where a reader expects.
export function nearestOutlinePoint(shape: CanvasShapeItem, point: CanvasPoint): CanvasPoint | null {
  const { left, top, right, bottom } = shapeBounds(shape);
  if (shape.shape === 'ellipse') {
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = (right - left) / 2;
    const ry = (bottom - top) / 2;
    if (rx <= 0 || ry <= 0) return null;
    const angle = Math.atan2((point.y - cy) / ry, (point.x - cx) / rx);
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  }
  if (shape.shape !== 'rect') return null;
  const clampedX = Math.min(right, Math.max(left, point.x));
  const clampedY = Math.min(bottom, Math.max(top, point.y));
  const inside = point.x > left && point.x < right && point.y > top && point.y < bottom;
  if (!inside) return { x: clampedX, y: clampedY };
  const edges = [
    { distance: point.x - left, snapped: { x: left, y: point.y } },
    { distance: right - point.x, snapped: { x: right, y: point.y } },
    { distance: point.y - top, snapped: { x: point.x, y: top } },
    { distance: bottom - point.y, snapped: { x: point.x, y: bottom } },
  ];
  return edges.reduce((best, edge) => (edge.distance < best.distance ? edge : best)).snapped;
}

// Snaps a line endpoint to the closest box or ellipse outline within reach,
// returning the snapped point and the shape it attached to.
export function snapToShapeOutline(
  items: CanvasItem[],
  point: CanvasPoint,
  reach: number,
  excludeId: string | null,
): { point: CanvasPoint; shape: CanvasShapeItem } | null {
  let best: { point: CanvasPoint; shape: CanvasShapeItem; distance: number } | null = null;
  for (const item of items) {
    if (item.kind !== 'shape' || item.shape === 'line' || item.id === excludeId) continue;
    const candidate = nearestOutlinePoint(item, point);
    if (!candidate) continue;
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= reach && (!best || distance < best.distance)) best = { point: candidate, shape: item, distance };
  }
  return best ? { point: best.point, shape: best.shape } : null;
}

// The rectangle or ellipse containing the point, topmost first, for centering text in boxes.
export function containingBox(items: CanvasItem[], point: CanvasPoint): CanvasShapeItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.kind !== 'shape' || item.shape === 'line') continue;
    const { left, top, right, bottom } = shapeBounds(item);
    if (point.x > left && point.x < right && point.y > top && point.y < bottom) return item;
  }
  return null;
}

export function distanceToSegment(point: CanvasPoint, a: CanvasPoint, b: CanvasPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}
