import type { CanvasBrushItem, CanvasDrawing, CanvasItem, CanvasPoint, CanvasShapeItem, CanvasTextItem } from './canvas-drawing-format';
import { distanceToSegment, hitShapeBody, hitTextBody, linePath, shapeBounds, textBounds, type CanvasHandle } from './canvas-shapes';

// Pure geometry for selecting existing items: hit testing, bounds, box
// handles, and scaling a selection by dragging its box. Coordinates are
// logical canvas units.

export interface CanvasBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Items that can be selected carry an id: brush strokes, shapes, and text.
export type CanvasSelectableItem = (CanvasBrushItem & { id: string }) | CanvasShapeItem | CanvasTextItem;

export function isSelectableItem(item: CanvasItem): item is CanvasSelectableItem {
  return item.kind !== 'fill' && typeof item.id === 'string' && item.id.length > 0;
}

export function itemBounds(item: CanvasItem): CanvasBounds | null {
  if (item.kind === 'fill') return null;
  if (item.kind === 'text') return textBounds(item);
  const points = item.kind === 'brush' ? item.points : item.shape === 'line' ? linePath(item) : null;
  if (!points) return shapeBounds(item as CanvasShapeItem);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    if (point.x < left) left = point.x;
    if (point.x > right) right = point.x;
    if (point.y < top) top = point.y;
    if (point.y > bottom) bottom = point.y;
  }
  return { left, top, right, bottom };
}

export function unionBounds(items: CanvasItem[]): CanvasBounds | null {
  let union: CanvasBounds | null = null;
  for (const item of items) {
    const bounds = itemBounds(item);
    if (!bounds) continue;
    union = union
      ? { left: Math.min(union.left, bounds.left), top: Math.min(union.top, bounds.top), right: Math.max(union.right, bounds.right), bottom: Math.max(union.bottom, bounds.bottom) }
      : bounds;
  }
  return union;
}

export function hitItem(item: CanvasItem, point: CanvasPoint, tolerance: number): boolean {
  if (item.kind === 'fill') return false;
  if (item.kind === 'text') return hitTextBody(item, point, tolerance);
  if (item.kind === 'shape') return hitShapeBody(item, point, tolerance);
  const reach = tolerance + item.width / 2;
  if (item.points.length === 1) return Math.hypot(point.x - item.points[0]!.x, point.y - item.points[0]!.y) <= reach;
  for (let index = 1; index < item.points.length; index += 1) {
    if (distanceToSegment(point, item.points[index - 1]!, item.points[index]!) <= reach) return true;
  }
  return false;
}

// The topmost selectable item under the point, searching the given layers from
// the top of the stack down, and each layer's items newest first.
export function findTopmostItem(
  drawing: CanvasDrawing,
  layerIds: ReadonlySet<string>,
  point: CanvasPoint,
  tolerance: number,
): { layerId: string; item: CanvasSelectableItem } | null {
  for (let layerIndex = drawing.layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    const layer = drawing.layers[layerIndex]!;
    if (!layerIds.has(layer.id) || !layer.visible || layer.locked) continue;
    for (let index = layer.items.length - 1; index >= 0; index -= 1) {
      const item = layer.items[index]!;
      if (isSelectableItem(item) && hitItem(item, point, tolerance)) return { layerId: layer.id, item };
    }
  }
  return null;
}

// Selectable items entirely inside the box, from the given layers.
export function findItemsInBox(drawing: CanvasDrawing, layerIds: ReadonlySet<string>, box: CanvasBounds): string[] {
  const ids: string[] = [];
  for (const layer of drawing.layers) {
    if (!layerIds.has(layer.id) || !layer.visible || layer.locked) continue;
    for (const item of layer.items) {
      if (!isSelectableItem(item)) continue;
      const bounds = itemBounds(item);
      if (bounds && bounds.left >= box.left && bounds.right <= box.right && bounds.top >= box.top && bounds.bottom <= box.bottom) ids.push(item.id);
    }
  }
  return ids;
}

export function boundsFromPoints(a: CanvasPoint, b: CanvasPoint): CanvasBounds {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

export function boxHandles(bounds: CanvasBounds): Array<{ handle: CanvasHandle; point: CanvasPoint }> {
  const { left, top, right, bottom } = bounds;
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

// Dragging a box handle to `point` gives the new box. The opposite side stays
// put; Shift (`uniform`) keeps proportions for corner handles. The box never
// shrinks below `minimum` or flips.
export function resizeBounds(bounds: CanvasBounds, handle: CanvasHandle, point: CanvasPoint, uniform: boolean, minimum: number): CanvasBounds {
  let { left, top, right, bottom } = bounds;
  if (handle.includes('w')) left = Math.min(point.x, right - minimum);
  if (handle.includes('e')) right = Math.max(point.x, left + minimum);
  if (handle.includes('n')) top = Math.min(point.y, bottom - minimum);
  if (handle.includes('s')) bottom = Math.max(point.y, top + minimum);
  if (uniform && handle.length === 2) {
    const width = bounds.right - bounds.left || 1;
    const height = bounds.bottom - bounds.top || 1;
    const scale = Math.max((right - left) / width, (bottom - top) / height);
    if (handle.includes('w')) left = right - width * scale;
    else right = left + width * scale;
    if (handle.includes('n')) top = bottom - height * scale;
    else bottom = top + height * scale;
  }
  return { left, top, right, bottom };
}

// Maps an item from one box to another. Stroke widths stay the same; text
// scales its font size by the average of the two scale factors.
export function transformItem<T extends CanvasItem>(item: T, from: CanvasBounds, to: CanvasBounds): T {
  const scaleX = (to.right - to.left) / Math.max(1e-9, from.right - from.left);
  const scaleY = (to.bottom - to.top) / Math.max(1e-9, from.bottom - from.top);
  const map = (point: CanvasPoint): CanvasPoint => ({ x: to.left + (point.x - from.left) * scaleX, y: to.top + (point.y - from.top) * scaleY });
  if (item.kind === 'brush') return { ...item, points: item.points.map(map) };
  if (item.kind === 'text') {
    const factor = (scaleX + scaleY) / 2;
    const scale = (size: number) => Math.min(512, Math.max(1, size * factor));
    return { ...item, at: map(item.at), size: scale(item.size), ...(item.sizes ? { sizes: item.sizes.map((range) => ({ ...range, size: scale(range.size) })) } : {}) };
  }
  if (item.kind === 'shape') return { ...item, from: map(item.from), to: map(item.to), ...(item.control ? { control: map(item.control) } : {}) };
  return item;
}

export function translateItem<T extends CanvasItem>(item: T, dx: number, dy: number): T {
  const shift = (point: CanvasPoint): CanvasPoint => ({ x: point.x + dx, y: point.y + dy });
  if (item.kind === 'brush') return { ...item, points: item.points.map(shift) };
  if (item.kind === 'text') return { ...item, at: shift(item.at) };
  if (item.kind === 'shape') return { ...item, from: shift(item.from), to: shift(item.to), ...(item.control ? { control: shift(item.control) } : {}) };
  return item;
}
