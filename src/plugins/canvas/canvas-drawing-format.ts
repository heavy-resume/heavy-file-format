// Versioned vector drawing data stored in the canvas:<block id> attachment.
// A drawing is an ordered list of layers (bottom first); each layer holds an
// ordered list of items replayed bottom to top.

export interface CanvasPoint {
  x: number;
  y: number;
}

export type CanvasDash = 'solid' | 'dashed' | 'dotted';

// A path removed from a fill layer: everything within width / 2 of the
// polyline, with round caps and joins.
export interface CanvasCutout {
  width: number;
  points: CanvasPoint[];
}

export interface CanvasBrushItem {
  kind: 'brush';
  // Optional; strokes without an id cannot be selected.
  id?: string;
  points: CanvasPoint[];
  color: string;
  width: number;
  dash?: CanvasDash;
}

export interface CanvasFillItem {
  kind: 'fill';
  color: string;
  cutouts?: CanvasCutout[];
}

export type CanvasShapeType = 'rect' | 'ellipse' | 'line';

export interface CanvasShapeItem {
  kind: 'shape';
  id: string;
  shape: CanvasShapeType;
  from: CanvasPoint;
  to: CanvasPoint;
  // Lines only: quadratic curve control point. Absent means straight.
  control?: CanvasPoint;
  color: string;
  width: number;
  dash?: CanvasDash;
  // Lines only: arrowheads at either end.
  startHead?: boolean;
  endHead?: boolean;
}

// Characters [start, end) of a text item drawn at `size` instead of the item's size.
export interface CanvasTextSizeRange {
  start: number;
  end: number;
  size: number;
}

export interface CanvasTextItem {
  kind: 'text';
  id: string;
  text: string;
  // Center of the text block.
  at: CanvasPoint;
  size: number;
  // Optional per-character font sizes, sorted and non-overlapping.
  sizes?: CanvasTextSizeRange[];
  color: string;
  font: string;
}

export type CanvasItem = CanvasBrushItem | CanvasFillItem | CanvasShapeItem | CanvasTextItem;

// A color filter over one layer's pixels: `invert` flips colors, then
// `multiply` scales red, green, and blue by r/255, g/255, b/255 and alpha by a.
export interface CanvasLayerFilter {
  invert?: boolean;
  multiply?: { r: number; g: number; b: number; a: number };
}

export interface CanvasLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  filter?: CanvasLayerFilter;
  items: CanvasItem[];
}

export interface CanvasDrawing {
  version: 2;
  layers: CanvasLayer[];
}

// A canvas names its drawing attachment in pluginConfig.drawing, so the
// drawing stays attached across save/reload and component id renames.
export function createCanvasDrawingName(): string {
  return `canvas-${crypto.randomUUID().slice(0, 8)}`;
}

export function getCanvasDrawingAttachmentId(drawingName: string): string {
  return `canvas:${drawingName}`;
}

export const CANVAS_MAX_ERASER_WIDTH = 512;
export const CANVAS_MAX_STROKE_WIDTH = 64;
export const CANVAS_DEFAULT_FONT = 'sans-serif';
const DEFAULT_COLOR = '#1f2937';

export function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function normalizePoint(value: unknown): CanvasPoint | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: Number(point.x), y: Number(point.y) };
}

export function createCanvasLayer(id: string, name: string): CanvasLayer {
  return { id, name, visible: true, locked: false, items: [] };
}

export function createEmptyCanvasDrawing(): CanvasDrawing {
  return { version: 2, layers: [createCanvasLayer('layer-1', 'Layer 1')] };
}

// Every drawing has at least one layer, and layer ids are unique.
export function normalizeCanvasDrawing(value: unknown): CanvasDrawing {
  const rawLayers = value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).layers)
    ? (value as Record<string, unknown>).layers as unknown[]
    : [];
  const seenIds = new Set<string>();
  const layers = rawLayers.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const raw = candidate as Record<string, unknown>;
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `layer-${index + 1}`;
    while (seenIds.has(id)) id = `${id}-copy`;
    seenIds.add(id);
    const items = Array.isArray(raw.items) ? raw.items.flatMap((item) => normalizeCanvasItem(item) ?? []) : [];
    const filter = normalizeLayerFilter(raw.filter);
    return [{
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Layer ${index + 1}`,
      visible: raw.visible !== false,
      locked: raw.locked === true,
      ...(filter ? { filter } : {}),
      items,
    }];
  });
  return layers.length > 0 ? { version: 2, layers } : createEmptyCanvasDrawing();
}

export function normalizeCanvasItem(value: unknown): CanvasItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const color = typeof raw.color === 'string' && raw.color.trim() ? raw.color : DEFAULT_COLOR;
  const dash = normalizeDash(raw.dash);
  if (raw.kind === 'brush') {
    const points = normalizePoints(raw.points);
    if (points.length === 0) return null;
    return {
      kind: 'brush',
      ...(typeof raw.id === 'string' && raw.id ? { id: raw.id } : {}),
      points,
      color,
      width: finiteNumber(raw.width, 4, 1, CANVAS_MAX_STROKE_WIDTH),
      ...(dash ? { dash } : {}),
    };
  }
  if (raw.kind === 'fill') {
    const cutouts = normalizeCutouts(raw.cutouts);
    return { kind: 'fill', color, ...(cutouts.length > 0 ? { cutouts } : {}) };
  }
  if (raw.kind === 'shape') {
    const from = normalizePoint(raw.from);
    const to = normalizePoint(raw.to);
    const shape = raw.shape === 'rect' || raw.shape === 'ellipse' || raw.shape === 'line' ? raw.shape : null;
    if (!from || !to || !shape || typeof raw.id !== 'string' || !raw.id) return null;
    const control = shape === 'line' ? normalizePoint(raw.control) : null;
    return {
      kind: 'shape',
      id: raw.id,
      shape,
      from,
      to,
      ...(control ? { control } : {}),
      color,
      width: finiteNumber(raw.width, 4, 1, CANVAS_MAX_STROKE_WIDTH),
      ...(dash ? { dash } : {}),
      ...(shape === 'line' && raw.startHead === true ? { startHead: true } : {}),
      ...(shape === 'line' && raw.endHead === true ? { endHead: true } : {}),
    };
  }
  if (raw.kind === 'text') {
    const at = normalizePoint(raw.at);
    if (!at || typeof raw.id !== 'string' || !raw.id || typeof raw.text !== 'string' || !raw.text.trim()) return null;
    const sizes = normalizeTextSizes(raw.sizes, raw.text.length);
    return {
      kind: 'text',
      id: raw.id,
      text: raw.text,
      at,
      size: finiteNumber(raw.size, 24, 1, 512),
      ...(sizes.length > 0 ? { sizes } : {}),
      color,
      font: typeof raw.font === 'string' && raw.font.trim() ? raw.font.trim() : CANVAS_DEFAULT_FONT,
    };
  }
  return null;
}

// Null when the filter would change nothing.
export function normalizeLayerFilter(value: unknown): CanvasLayerFilter | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const invert = raw.invert === true;
  const rawMultiply = raw.multiply && typeof raw.multiply === 'object' ? raw.multiply as Record<string, unknown> : null;
  const channel = (key: string) => Math.round(finiteNumber(rawMultiply?.[key], 255, 0, 255));
  const multiply = rawMultiply
    ? { r: channel('r'), g: channel('g'), b: channel('b'), a: finiteNumber(rawMultiply.a, 1, 0, 1) }
    : null;
  const identity = !multiply || (multiply.r === 255 && multiply.g === 255 && multiply.b === 255 && multiply.a === 1);
  if (!invert && identity) return null;
  return { ...(invert ? { invert: true } : {}), ...(!identity ? { multiply: multiply! } : {}) };
}

function normalizeTextSizes(value: unknown, length: number): CanvasTextSizeRange[] {
  if (!Array.isArray(value)) return [];
  const ranges = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const raw = candidate as Record<string, unknown>;
    const start = Math.max(0, Math.floor(Number(raw.start)));
    const end = Math.min(length, Math.floor(Number(raw.end)));
    const size = Number(raw.size);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start) || !(size > 0)) return [];
    return [{ start, end, size: Math.min(512, Math.max(1, size)) }];
  }).sort((a, b) => a.start - b.start);
  // Later ranges that overlap an earlier one are dropped.
  const kept: CanvasTextSizeRange[] = [];
  for (const range of ranges) {
    if (kept.length === 0 || range.start >= kept[kept.length - 1]!.end) kept.push(range);
  }
  return kept;
}

function normalizeDash(value: unknown): CanvasDash | null {
  return value === 'dashed' || value === 'dotted' ? value : null;
}

function normalizePoints(value: unknown): CanvasPoint[] {
  return Array.isArray(value)
    ? value.map(normalizePoint).filter((point): point is CanvasPoint => point !== null)
    : [];
}

function normalizeCutouts(value: unknown): CanvasCutout[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const raw = candidate as Record<string, unknown>;
    const points = normalizePoints(raw.points);
    const width = Number(raw.width);
    if (points.length === 0 || !(width > 0)) return [];
    return [{ width: Math.min(CANVAS_MAX_ERASER_WIDTH, width), points }];
  });
}

export function parseCanvasDrawing(text: string): CanvasDrawing {
  if (!text.trim()) return createEmptyCanvasDrawing();
  try {
    return normalizeCanvasDrawing(JSON.parse(text));
  } catch {
    return createEmptyCanvasDrawing();
  }
}

export function serializeCanvasDrawing(drawing: CanvasDrawing): string {
  return JSON.stringify(normalizeCanvasDrawing(drawing));
}

// Normalization rebuilds every object, so it doubles as a deep copy.
export function cloneDrawing(drawing: CanvasDrawing): CanvasDrawing {
  return normalizeCanvasDrawing(drawing);
}

export function canvasItemKey(item: CanvasItem): string {
  return JSON.stringify(normalizeCanvasItem(item));
}

export function findCanvasLayer(drawing: CanvasDrawing, layerId: string): CanvasLayer | null {
  return drawing.layers.find((layer) => layer.id === layerId) ?? null;
}

// Returns a drawing whose given layer has the new items; other layers are shared.
export function withCanvasLayerItems(drawing: CanvasDrawing, layerId: string, items: CanvasItem[]): CanvasDrawing {
  return {
    version: 2,
    layers: drawing.layers.map((layer) => (layer.id === layerId ? { ...layer, items } : layer)),
  };
}
