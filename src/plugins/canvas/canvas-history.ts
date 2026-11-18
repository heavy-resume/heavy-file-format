import type { HvyPluginAttachmentsApi, HvyPluginHistoryRestoreContext } from '../types';
import type { CanvasDrawing, CanvasItem, CanvasLayer, CanvasLayerFilter } from './canvas-drawing-format';
import { canvasItemKey, cloneDrawing, normalizeCanvasItem, parseCanvasDrawing, serializeCanvasDrawing } from './canvas-drawing-format';

// One whiteboard action as the smallest set of changes that turns the drawing
// before it into the drawing after it.
export type CanvasHistoryChange =
  // Layers were reordered; the same layer ids exist before and after.
  | { kind: 'layer-order'; before: string[]; after: string[] }
  // Layers were added or removed: at `index`, `removed` became `inserted`.
  | { kind: 'layer-list'; index: number; removed: CanvasLayer[]; inserted: CanvasLayer[] }
  // A layer's name, visibility, or lock changed.
  | { kind: 'layer-settings'; layerId: string; before: CanvasLayerSettings; after: CanvasLayerSettings }
  // Within one layer, at `index`, the `removed` items became the `inserted` items.
  | { kind: 'items'; layerId: string; index: number; removed: CanvasItem[]; inserted: CanvasItem[] };

export interface CanvasLayerSettings {
  name: string;
  visible: boolean;
  locked: boolean;
  filter: CanvasLayerFilter | null;
}

export interface CanvasHistoryData {
  attachmentId: string;
  attachmentMeta: Record<string, string>;
  changes: CanvasHistoryChange[];
}

// Returns null when the drawings are identical, so no undo step is needed.
export function createCanvasHistoryData(
  attachmentId: string,
  attachmentMeta: Record<string, string>,
  beforeDrawing: CanvasDrawing,
  afterDrawing: CanvasDrawing,
): CanvasHistoryData | null {
  const before = cloneDrawing(beforeDrawing);
  const after = cloneDrawing(afterDrawing);
  const changes: CanvasHistoryChange[] = [];
  const beforeIds = before.layers.map((layer) => layer.id);
  const afterIds = after.layers.map((layer) => layer.id);
  const sameLayerSet = beforeIds.length === afterIds.length && beforeIds.every((id) => afterIds.includes(id));

  if (!sameLayerSet) {
    const keys = (layers: CanvasLayer[]) => layers.map((layer) => JSON.stringify(layer));
    const { index, removed, inserted } = spliceDiff(keys(before.layers), keys(after.layers));
    changes.push({ kind: 'layer-list', index, removed: before.layers.slice(index, index + removed), inserted: after.layers.slice(index, index + inserted) });
  } else {
    if (beforeIds.some((id, index) => afterIds[index] !== id)) {
      changes.push({ kind: 'layer-order', before: beforeIds, after: afterIds });
    }
    for (const afterLayer of after.layers) {
      const beforeLayer = before.layers.find((layer) => layer.id === afterLayer.id)!;
      const beforeSettings = layerSettings(beforeLayer);
      const afterSettings = layerSettings(afterLayer);
      if (JSON.stringify(beforeSettings) !== JSON.stringify(afterSettings)) {
        changes.push({ kind: 'layer-settings', layerId: afterLayer.id, before: beforeSettings, after: afterSettings });
      }
      const { index, removed, inserted } = spliceDiff(beforeLayer.items.map(canvasItemKey), afterLayer.items.map(canvasItemKey));
      if (removed > 0 || inserted > 0) {
        changes.push({
          kind: 'items',
          layerId: afterLayer.id,
          index,
          removed: beforeLayer.items.slice(index, index + removed),
          inserted: afterLayer.items.slice(index, index + inserted),
        });
      }
    }
  }
  return changes.length > 0 ? { attachmentId, attachmentMeta, changes } : null;
}

// Applies a recorded step. Every change checks that the drawing still holds
// what the step expects; if any check fails (for example a script changed the
// drawing since), the drawing is returned untouched rather than guessing.
export function applyCanvasHistoryData(drawing: CanvasDrawing, data: CanvasHistoryData, direction: 'undo' | 'redo'): CanvasDrawing {
  const ordered = direction === 'undo' ? [...data.changes].reverse() : data.changes;
  let next: CanvasDrawing | null = cloneDrawing(drawing);
  for (const change of ordered) {
    next = next ? applyChange(next, change, direction) : null;
  }
  return next ?? drawing;
}

function applyChange(drawing: CanvasDrawing, change: CanvasHistoryChange, direction: 'undo' | 'redo'): CanvasDrawing | null {
  const forward = direction === 'redo';
  if (change.kind === 'layer-order') {
    const expected = forward ? change.before : change.after;
    const target = forward ? change.after : change.before;
    const ids = drawing.layers.map((layer) => layer.id);
    if (ids.length !== expected.length || ids.some((id, index) => id !== expected[index])) return null;
    return { version: 2, layers: target.map((id) => drawing.layers.find((layer) => layer.id === id)!) };
  }
  if (change.kind === 'layer-list') {
    const expected = forward ? change.removed : change.inserted;
    const replacement = forward ? change.inserted : change.removed;
    const current = drawing.layers.slice(change.index, change.index + expected.length);
    if (current.length !== expected.length || current.some((layer, offset) => JSON.stringify(layer) !== JSON.stringify(expected[offset]))) return null;
    const layers = [...drawing.layers];
    layers.splice(change.index, expected.length, ...replacement.map((layer) => cloneDrawing({ version: 2, layers: [layer] }).layers[0]!));
    return { version: 2, layers };
  }
  const layer = drawing.layers.find((candidate) => candidate.id === change.layerId);
  if (!layer) return null;
  if (change.kind === 'layer-settings') {
    const expected = forward ? change.before : change.after;
    const target = forward ? change.after : change.before;
    if (JSON.stringify(layerSettings(layer)) !== JSON.stringify(expected)) return null;
    const { filter: _replaced, ...rest } = layer;
    const updated: CanvasLayer = { ...rest, name: target.name, visible: target.visible, locked: target.locked, ...(target.filter ? { filter: target.filter } : {}) };
    return { version: 2, layers: drawing.layers.map((candidate) => (candidate === layer ? updated : candidate)) };
  }
  const expected = forward ? change.removed : change.inserted;
  const replacement = forward ? change.inserted : change.removed;
  const current = layer.items.slice(change.index, change.index + expected.length);
  if (current.length !== expected.length || current.some((item, offset) => canvasItemKey(item) !== canvasItemKey(expected[offset]!))) return null;
  const items = [...layer.items];
  items.splice(change.index, expected.length, ...replacement.flatMap((item) => normalizeCanvasItem(item) ?? []));
  return { version: 2, layers: drawing.layers.map((candidate) => (candidate === layer ? { ...layer, items } : candidate)) };
}

export function restoreCanvasHistory(ctx: HvyPluginHistoryRestoreContext, direction: 'undo' | 'redo'): void {
  const data = ctx.data as CanvasHistoryData;
  const drawing = readStoredDrawing(ctx.attachments, data.attachmentId);
  const next = applyCanvasHistoryData(drawing, data, direction);
  if (next === drawing) return;
  ctx.attachments.set(data.attachmentId, data.attachmentMeta, new TextEncoder().encode(serializeCanvasDrawing(next)));
}

function readStoredDrawing(attachments: HvyPluginAttachmentsApi, attachmentId: string): CanvasDrawing {
  return parseCanvasDrawing(new TextDecoder().decode(attachments.get(attachmentId)?.bytes ?? new Uint8Array()));
}

function layerSettings(layer: CanvasLayer): CanvasLayerSettings {
  return { name: layer.name, visible: layer.visible, locked: layer.locked, filter: layer.filter ?? null };
}

// Common prefix/suffix diff: the middle run of `before` was replaced by the
// middle run of `after`.
function spliceDiff(before: string[], after: string[]): { index: number; removed: number; inserted: number } {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  return { index: prefix, removed: before.length - prefix - suffix, inserted: after.length - prefix - suffix };
}
