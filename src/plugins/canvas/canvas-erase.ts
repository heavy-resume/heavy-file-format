import type { CanvasBrushItem, CanvasCutout, CanvasDrawing, CanvasFillItem, CanvasItem, CanvasPoint } from './canvas-drawing-format';
import { findCanvasLayer, withCanvasLayerItems } from './canvas-drawing-format';
import { distanceToSegment, shapeToBrushStrokes, textBounds } from './canvas-shapes';

// Erasing removes geometry instead of recording an erase layer, and only
// touches one layer. Brush strokes the sweep touches are cut and their
// surviving runs become independent strokes. A touched shape first becomes
// brush strokes with its color, width, and dash, which are then cut. Touched
// text is removed. Fill layers cover the whole canvas, so the eraser path is
// recorded on them as a cutout instead.

const EPSILON = 1e-6;

interface EraserSweep {
  from: CanvasPoint;
  to: CanvasPoint;
  radius: number;
}

// Erases along a polyline eraser path of the given logical width within one
// layer. Returns the same drawing object when nothing changed so callers can
// skip persisting.
export function eraseCanvasDrawing(drawing: CanvasDrawing, layerId: string, eraserPath: CanvasPoint[], eraserWidth: number): CanvasDrawing {
  const layer = findCanvasLayer(drawing, layerId);
  const first = eraserPath[0];
  if (!layer || !first || !(eraserWidth > 0)) return drawing;
  const sweeps: EraserSweep[] = eraserPath.length === 1
    ? [{ from: first, to: first, radius: eraserWidth / 2 }]
    : eraserPath.slice(1).map((to, index) => ({ from: eraserPath[index]!, to, radius: eraserWidth / 2 }));

  let changed = false;
  const items = layer.items.flatMap((item): CanvasItem[] => {
    const next = eraseItem(item, sweeps, eraserPath, eraserWidth);
    if (next.length !== 1 || next[0] !== item) changed = true;
    return next;
  });
  return changed ? withCanvasLayerItems(drawing, layerId, items) : drawing;
}

function eraseItem(item: CanvasItem, sweeps: EraserSweep[], eraserPath: CanvasPoint[], eraserWidth: number): CanvasItem[] {
  if (item.kind === 'fill') return [cutFill(item, eraserPath, eraserWidth)];
  if (item.kind === 'text') {
    const { left, top, right, bottom } = textBounds(item);
    const touched = sweeps.some((sweep) => distanceToRect(sweep, left, top, right, bottom) < sweep.radius);
    return touched ? [] : [item];
  }
  if (item.kind === 'shape') {
    const strokes = shapeToBrushStrokes(item);
    const cut = strokes.flatMap((stroke) => cutAlongSweeps(stroke, sweeps));
    const untouched = cut.length === strokes.length && cut.every((piece, index) => piece === strokes[index]);
    return untouched ? [item] : cut;
  }
  return cutAlongSweeps(item, sweeps);
}

function cutAlongSweeps(stroke: CanvasBrushItem, sweeps: EraserSweep[]): CanvasBrushItem[] {
  let pieces: CanvasBrushItem[] = [stroke];
  for (const sweep of sweeps) {
    pieces = pieces.flatMap((piece) => withPieceIds(piece, cutStroke(piece, sweep)));
  }
  return pieces;
}

// The first piece keeps the stroke's id; later pieces get the id plus their
// first point, which stays unique as pieces are cut again and does not grow
// as a drag cuts the same piece repeatedly.
function withPieceIds(original: CanvasBrushItem, pieces: CanvasBrushItem[]): CanvasBrushItem[] {
  if (!original.id || pieces.length < 2) return pieces;
  const baseId = original.id;
  return pieces.map((piece, index) => {
    if (index === 0) return piece;
    const first = piece.points[0]!;
    return { ...piece, id: `${baseId}@${Math.round(first.x)},${Math.round(first.y)}` };
  });
}

// Closest distance from a sweep segment to an axis-aligned rectangle.
function distanceToRect(sweep: EraserSweep, left: number, top: number, right: number, bottom: number): number {
  const inside = (point: CanvasPoint) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  if (inside(sweep.from) || inside(sweep.to)) return 0;
  const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  const edges = corners.map((corner, index) => [corner, corners[(index + 1) % 4]!] as const);
  if (edges.some(([a, b]) => segmentsIntersect(sweep.from, sweep.to, a, b))) return 0;
  return Math.min(
    ...corners.map((corner) => distanceToSegment(corner, sweep.from, sweep.to)),
    ...edges.flatMap(([a, b]) => [distanceToSegment(sweep.from, a, b), distanceToSegment(sweep.to, a, b)]),
  );
}

function segmentsIntersect(p1: CanvasPoint, p2: CanvasPoint, p3: CanvasPoint, p4: CanvasPoint): boolean {
  const cross = (a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// A drag erases one short segment at a time; a segment that continues the
// fill's last cutout extends it, so one drag stays one cutout path.
function cutFill(fill: CanvasFillItem, eraserPath: CanvasPoint[], eraserWidth: number): CanvasFillItem {
  const cutouts: CanvasCutout[] = [...(fill.cutouts ?? [])];
  const last = cutouts[cutouts.length - 1];
  const lastPoint = last?.points[last.points.length - 1];
  const start = eraserPath[0]!;
  if (last && lastPoint && last.width === eraserWidth && lastPoint.x === start.x && lastPoint.y === start.y) {
    cutouts[cutouts.length - 1] = { width: last.width, points: [...last.points, ...eraserPath.slice(1).map((point) => ({ ...point }))] };
  } else {
    cutouts.push({ width: eraserWidth, points: eraserPath.map((point) => ({ ...point })) });
  }
  return { ...fill, cutouts };
}

// Cuts the centerline wherever it comes within eraser radius + stroke radius of
// the sweep, so the round caps of the surviving pieces end at the eraser edge.
function cutStroke(stroke: CanvasBrushItem, sweep: EraserSweep): CanvasBrushItem[] {
  const reach = sweep.radius + stroke.width / 2;
  const points = stroke.points;
  if (points.length === 1) {
    return distanceToSegment(points[0]!, sweep.from, sweep.to) < reach ? [] : [stroke];
  }

  const runs: CanvasPoint[][] = [];
  let current: CanvasPoint[] | null = null;
  let touched = false;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const erased = capsuleInterval(start, end, sweep.from, sweep.to, reach);
    if (erased) touched = true;
    const kept: Array<[number, number]> = erased
      ? [[0, erased[0]], [erased[1], 1]].filter(([a, b]) => b - a > EPSILON) as Array<[number, number]>
      : [[0, 1]];
    for (const [a, b] of kept) {
      if (a > EPSILON || !current) {
        if (current) runs.push(current);
        current = [lerp(start, end, a)];
      }
      current.push(lerp(start, end, b));
      if (b < 1 - EPSILON) {
        runs.push(current);
        current = null;
      }
    }
    if (kept.length === 0 && current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  if (!touched) return [stroke];
  return runs
    .filter((run) => polylineLength(run) > EPSILON)
    .map((run) => ({ ...stroke, points: run }));
}

// Parameter interval [t0, t1] of segment p0->p1 that lies inside the capsule
// around a->b with the given radius, or null. The capsule is convex, so the
// intersection with a segment is a single interval: the hull of the intervals
// for its two end disks and its center band.
function capsuleInterval(p0: CanvasPoint, p1: CanvasPoint, a: CanvasPoint, b: CanvasPoint, radius: number): [number, number] | null {
  const parts = [diskInterval(p0, p1, a, radius), diskInterval(p0, p1, b, radius), bandInterval(p0, p1, a, b, radius)]
    .filter((part): part is [number, number] => part !== null);
  if (parts.length === 0) return null;
  const t0 = Math.max(0, Math.min(...parts.map((part) => part[0])));
  const t1 = Math.min(1, Math.max(...parts.map((part) => part[1])));
  return t1 - t0 > EPSILON ? [t0, t1] : null;
}

function diskInterval(p0: CanvasPoint, p1: CanvasPoint, center: CanvasPoint, radius: number): [number, number] | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const fx = p0.x - center.x;
  const fy = p0.y - center.y;
  const qa = dx * dx + dy * dy;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - radius * radius;
  if (qa < EPSILON) return qc < 0 ? [0, 1] : null;
  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant <= 0) return null;
  const root = Math.sqrt(discriminant);
  const t0 = (-qb - root) / (2 * qa);
  const t1 = (-qb + root) / (2 * qa);
  return t1 < 0 || t0 > 1 ? null : [t0, t1];
}

// The rectangle swept along a->b, expressed as two slabs in the a->b frame.
function bandInterval(p0: CanvasPoint, p1: CanvasPoint, a: CanvasPoint, b: CanvasPoint, radius: number): [number, number] | null {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const length = Math.hypot(ax, ay);
  if (length < EPSILON) return null;
  const ux = ax / length;
  const uy = ay / length;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const ox = p0.x - a.x;
  const oy = p0.y - a.y;
  // along(t) = along0 + alongRate * t must lie in [0, length];
  // across(t) = across0 + acrossRate * t must lie in [-radius, radius].
  const along = slab(ox * ux + oy * uy, dx * ux + dy * uy, 0, length);
  const across = slab(ox * -uy + oy * ux, dx * -uy + dy * ux, -radius, radius);
  if (!along || !across) return null;
  const t0 = Math.max(along[0], across[0]);
  const t1 = Math.min(along[1], across[1]);
  return t0 < t1 ? [t0, t1] : null;
}

function slab(origin: number, rate: number, min: number, max: number): [number, number] | null {
  if (Math.abs(rate) < EPSILON) return origin > min && origin < max ? [-Infinity, Infinity] : null;
  const t0 = (min - origin) / rate;
  const t1 = (max - origin) / rate;
  return t0 < t1 ? [t0, t1] : [t1, t0];
}


function lerp(start: CanvasPoint, end: CanvasPoint, t: number): CanvasPoint {
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

function polylineLength(points: CanvasPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  }
  return total;
}
