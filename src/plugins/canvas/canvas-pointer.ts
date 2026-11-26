import type { CanvasBrushItem, CanvasDrawing, CanvasItem, CanvasPoint, CanvasShapeItem, CanvasShapeType, CanvasTextItem } from './canvas-drawing-format';
import { cloneDrawing, findCanvasLayer, withCanvasLayerItems } from './canvas-drawing-format';
import { eraseCanvasDrawing } from './canvas-erase';
import {
  collectGuideTargets,
  GUIDE_SNAP_PX,
  NO_GUIDE_LINES,
  snapBoundsToGuides,
  snapPointToGuides,
  type CanvasGuideHold,
  type CanvasGuideLines,
  type CanvasGuideTargets,
} from './canvas-guides';
import { addCanvasLineSample, fitCanvasLine, LINE_SAMPLE_INTERVAL_MS } from './canvas-line-fit';
import {
  boundsFromPoints,
  boxHandles,
  findItemsInBox,
  findTopmostItem,
  hitItem,
  resizeBounds,
  transformItem,
  translateItem,
  unionBounds,
  type CanvasBounds,
  type CanvasSelectableItem,
} from './canvas-selection';
import { constrainShapeEnd, containingBox, hitShapeHandle, resizeShape, shapeBounds, snapToShapeOutline, type CanvasHandle } from './canvas-shapes';
import type { CanvasLineStyle, CanvasTool } from './canvas-toolbar';

// Pointer and keyboard interaction for the drawing surface. The host owns the
// drawing and selection state; this module turns gestures into live updates
// and undo steps.

export interface CanvasOverlayState {
  snapPoint: CanvasPoint | null;
  guides: CanvasGuideLines;
  marquee: CanvasBounds | null;
  hoverId: string | null;
}

export interface CanvasPointerHost {
  canvas: HTMLCanvasElement;
  // Drawing tools add to the draw layer, so it must be visible and unlocked.
  canDrawOnActiveLayer(): boolean;
  canSelect(): boolean;
  tool(): CanvasTool;
  activeLayerId(): string;
  // Layers the Select tool picks from.
  selectionLayerIds(): ReadonlySet<string>;
  getDrawing(): CanvasDrawing;
  // Shows a drawing without saving it; used while a gesture is in progress.
  showDrawing(drawing: CanvasDrawing): void;
  // Saves the current drawing as one undo step that started from `before`.
  commit(label: string, before: CanvasDrawing): void;
  selectedItems(): CanvasSelectableItem[];
  select(itemIds: string[]): void;
  setPreview(item: CanvasItem | null): void;
  setOverlay(patch: Partial<CanvasOverlayState>): void;
  pointFromEvent(event: PointerEvent): CanvasPoint;
  unitsPerPixel(): number;
  color(): string;
  strokeWidth(): number;
  lineStyle(): CanvasLineStyle;
  textSize(): number;
  // Opens the text editor for an existing item, or for new text at `at`.
  editText(existing: CanvasTextItem | null, at: CanvasPoint): void;
  isEditingText(): boolean;
  stopEditingText(): void;
  newItemId(prefix: string): string;
}

interface Snapping {
  targets: CanvasGuideTargets;
  hold: CanvasGuideHold;
}

type Gesture =
  | { kind: 'brush'; stroke: CanvasBrushItem }
  | { kind: 'erase'; before: CanvasDrawing; last: CanvasPoint }
  | { kind: 'pending'; start: CanvasPoint; clientX: number; clientY: number }
  | {
    kind: 'create';
    before: CanvasDrawing;
    shape: CanvasShapeType;
    from: CanvasPoint;
    draft: CanvasShapeItem | null;
    snapping: Snapping;
    // Lines only: freehand samples for the best-fit line, taken at a fixed rate.
    samples: CanvasPoint[];
    lastSampleAt: number;
  }
  | { kind: 'line-handle'; before: CanvasDrawing; original: CanvasShapeItem; handle: CanvasHandle; snapping: Snapping }
  | { kind: 'box'; before: CanvasDrawing; originals: CanvasSelectableItem[]; bounds: CanvasBounds; handle: CanvasHandle; snapping: Snapping }
  | {
    kind: 'move';
    before: CanvasDrawing;
    originals: CanvasSelectableItem[];
    bounds: CanvasBounds;
    start: CanvasPoint;
    moved: boolean;
    snapping: Snapping;
    // What a click without movement does: deselect this item (Shift-click on a
    // selected item), or edit this text (click on already selected text).
    clickRemovesId: string | null;
    clickEditsText: CanvasTextItem | null;
  }
  | { kind: 'marquee'; start: CanvasPoint; baseIds: string[] };

// Pointer travel, in CSS pixels, that turns a click into a drag.
const DRAG_THRESHOLD_PX = 4;
const HANDLE_RADIUS_PX = 9;
const BODY_TOLERANCE_PX = 6;
// Reach for attaching a line end to a box or ellipse outline.
const OUTLINE_SNAP_PX = 14;
// A drawn line stays straight while its samples are within this many screen
// pixels of the straight line (or within this fraction of its length).
const LINE_STRAIGHT_TOLERANCE_PX = 4;
const LINE_STRAIGHT_TOLERANCE_RATIO = 0.035;
const NUDGE_PX = 1;
const NUDGE_SHIFT_PX = 10;
const SHAPE_TOOLS: Partial<Record<CanvasTool, CanvasShapeType>> = { rect: 'rect', ellipse: 'ellipse', arrow: 'line' };

// Holding Cmd or Alt places points freely.
function snappingDisabled(event: PointerEvent): boolean {
  return event.altKey || event.metaKey;
}

export function attachCanvasPointer(host: CanvasPointerHost): { isInteracting(): boolean; cancel(): void } {
  const { canvas } = host;
  let gesture: Gesture | null = null;
  let hoverId: string | null = null;

  // Replaces items by id anywhere in the drawing; null removes the item.
  const replaceItems = (drawing: CanvasDrawing, replacements: Map<string, CanvasItem | null>): CanvasDrawing => ({
    version: 2,
    layers: drawing.layers.map((layer) => {
      if (!layer.items.some((item) => item.kind !== 'fill' && item.id && replacements.has(item.id))) return layer;
      return {
        ...layer,
        items: layer.items.flatMap((item) => {
          if (item.kind === 'fill' || !item.id || !replacements.has(item.id)) return [item];
          const next = replacements.get(item.id);
          return next ? [next] : [];
        }),
      };
    }),
  });

  const appendItem = (drawing: CanvasDrawing, item: CanvasItem): CanvasDrawing => {
    const layer = findCanvasLayer(drawing, host.activeLayerId());
    return layer ? withCanvasLayerItems(drawing, layer.id, [...layer.items, item]) : drawing;
  };

  const startSnapping = (excludeIds: Iterable<string>): Snapping => ({
    targets: collectGuideTargets(host.getDrawing(), new Set(excludeIds)),
    hold: { x: null, y: null },
  });

  // Line ends attach to a box or ellipse outline first; on a straight box edge
  // they can still slide along it to line up with other items.
  const snapLineEnd = (point: CanvasPoint, snapping: Snapping, excludeId: string | null): { point: CanvasPoint; attached: boolean } => {
    const unit = host.unitsPerPixel();
    const layer = findCanvasLayer(host.getDrawing(), host.activeLayerId());
    const outline = layer ? snapToShapeOutline(layer.items, point, OUTLINE_SNAP_PX * unit, excludeId) : null;
    if (!outline) {
      const aligned = snapPointToGuides(point, snapping.targets, GUIDE_SNAP_PX * unit, snapping.hold);
      snapping.hold = aligned.hold;
      host.setOverlay({ guides: aligned.lines, snapPoint: null });
      return { point: aligned.point, attached: false };
    }
    let snapped = outline.point;
    let lines: CanvasGuideLines = NO_GUIDE_LINES;
    if (outline.shape.shape === 'rect') {
      const { left, top, right, bottom } = shapeBounds(outline.shape);
      const onVerticalEdge = snapped.x === left || snapped.x === right;
      const aligned = snapPointToGuides(snapped, snapping.targets, GUIDE_SNAP_PX * unit, snapping.hold, { x: !onVerticalEdge, y: onVerticalEdge });
      const withinEdge = onVerticalEdge ? aligned.point.y >= top && aligned.point.y <= bottom : aligned.point.x >= left && aligned.point.x <= right;
      if (withinEdge) {
        snapped = aligned.point;
        snapping.hold = aligned.hold;
        lines = aligned.lines;
      }
    }
    host.setOverlay({ guides: lines, snapPoint: snapped });
    return { point: snapped, attached: true };
  };

  const snapPoint = (point: CanvasPoint, snapping: Snapping): CanvasPoint => {
    const aligned = snapPointToGuides(point, snapping.targets, GUIDE_SNAP_PX * host.unitsPerPixel(), snapping.hold);
    snapping.hold = aligned.hold;
    host.setOverlay({ guides: aligned.lines });
    return aligned.point;
  };

  const draftShape = (shape: CanvasShapeType, from: CanvasPoint, to: CanvasPoint, id: string): CanvasShapeItem => {
    const style = host.lineStyle();
    return {
      kind: 'shape',
      id,
      shape,
      from,
      to,
      color: host.color(),
      width: host.strokeWidth(),
      ...(style.dash !== 'solid' ? { dash: style.dash } : {}),
      ...(shape === 'line' && style.startHead ? { startHead: style.startHead } : {}),
      ...(shape === 'line' && style.endHead ? { endHead: style.endHead } : {}),
    };
  };

  const startMove = (point: CanvasPoint, selection: CanvasSelectableItem[], clickRemovesId: string | null, clickEditsText: CanvasTextItem | null): Gesture => ({
    kind: 'move',
    before: cloneDrawing(host.getDrawing()),
    originals: selection,
    bounds: unionBounds(selection)!,
    start: point,
    moved: false,
    snapping: startSnapping(selection.map((item) => item.id)),
    clickRemovesId,
    clickEditsText,
  });

  // Handles and bodies of the current selection, shared by every tool that
  // can adjust a selection (Select and the shape and text tools).
  const gestureOnSelection = (point: CanvasPoint, event: PointerEvent): Gesture | null => {
    const selection = host.selectedItems();
    if (selection.length === 0) return null;
    const unit = host.unitsPerPixel();
    const single = selection.length === 1 ? selection[0]! : null;
    if (single?.kind === 'shape' && single.shape === 'line') {
      const handle = hitShapeHandle(single, point, HANDLE_RADIUS_PX * unit);
      if (handle) return { kind: 'line-handle', before: cloneDrawing(host.getDrawing()), original: single, handle, snapping: startSnapping([single.id]) };
    } else {
      const bounds = unionBounds(selection)!;
      const handle = boxHandles(bounds).find((entry) => Math.hypot(entry.point.x - point.x, entry.point.y - point.y) <= HANDLE_RADIUS_PX * unit)?.handle;
      if (handle) return { kind: 'box', before: cloneDrawing(host.getDrawing()), originals: selection, bounds, handle, snapping: startSnapping(selection.map((item) => item.id)) };
    }
    const clicked = selection.find((item) => hitItem(item, point, BODY_TOLERANCE_PX * unit));
    if (!clicked) return null;
    const removes = event.shiftKey && host.tool() === 'select' ? clicked.id : null;
    const edits = !event.shiftKey && single?.kind === 'text' ? single : null;
    return startMove(point, selection, removes, edits);
  };

  const finishCapture = (event: PointerEvent) => {
    canvas.classList.remove('is-drawing');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  const onPointerDown = (event: PointerEvent) => {
    const tool = host.tool();
    const allowed = tool === 'select' ? host.canSelect() : host.canDrawOnActiveLayer();
    if (!allowed || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    event.preventDefault();
    event.stopPropagation();
    if (host.isEditingText()) {
      // The click that leaves the text editor only closes it.
      host.stopEditingText();
      return;
    }
    const point = host.pointFromEvent(event);
    if (tool === 'fill') {
      const before = cloneDrawing(host.getDrawing());
      host.showDrawing(appendItem(host.getDrawing(), { kind: 'fill', color: host.color() }));
      host.commit('Fill canvas', before);
      return;
    }
    if (tool === 'brush') {
      gesture = { kind: 'brush', stroke: { kind: 'brush', id: host.newItemId('brush'), points: [point], color: host.color(), width: host.strokeWidth() } };
      host.setPreview(gesture.stroke);
    } else if (tool === 'eraser') {
      gesture = { kind: 'erase', before: cloneDrawing(host.getDrawing()), last: point };
      host.showDrawing(eraseCanvasDrawing(host.getDrawing(), host.activeLayerId(), [point], host.strokeWidth()));
    } else {
      gesture = gestureOnSelection(point, event);
      if (!gesture && tool === 'select') {
        const hit = findTopmostItem(host.getDrawing(), host.selectionLayerIds(), point, BODY_TOLERANCE_PX * host.unitsPerPixel());
        const currentIds = host.selectedItems().map((item) => item.id);
        if (hit) {
          host.select(event.shiftKey ? [...currentIds, hit.item.id] : [hit.item.id]);
          gesture = startMove(point, host.selectedItems(), null, null);
        } else {
          if (!event.shiftKey) host.select([]);
          gesture = { kind: 'marquee', start: point, baseIds: event.shiftKey ? currentIds : [] };
        }
      } else if (!gesture) {
        gesture = { kind: 'pending', start: point, clientX: event.clientX, clientY: event.clientY };
      }
    }
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-drawing');
  };

  const updateHover = (event: PointerEvent) => {
    const hit = host.tool() === 'select' && host.canSelect()
      ? findTopmostItem(host.getDrawing(), host.selectionLayerIds(), host.pointFromEvent(event), BODY_TOLERANCE_PX * host.unitsPerPixel())
      : null;
    const next = hit?.item.id ?? null;
    canvas.classList.toggle('is-over-item', next !== null);
    if (next === hoverId) return;
    hoverId = next;
    host.setOverlay({ hoverId });
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!gesture) {
      updateHover(event);
      return;
    }
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    const point = host.pointFromEvent(event);
    const free = snappingDisabled(event);
    if (gesture.kind === 'brush') {
      gesture.stroke.points.push(point);
      host.setPreview(gesture.stroke);
      return;
    }
    if (gesture.kind === 'erase') {
      host.showDrawing(eraseCanvasDrawing(host.getDrawing(), host.activeLayerId(), [gesture.last, point], host.strokeWidth()));
      gesture.last = point;
      return;
    }
    if (gesture.kind === 'marquee') {
      const box = boundsFromPoints(gesture.start, point);
      host.setOverlay({ marquee: box });
      host.select([...new Set([...gesture.baseIds, ...findItemsInBox(host.getDrawing(), host.selectionLayerIds(), box)])]);
      return;
    }
    if (gesture.kind === 'pending') {
      const shape = SHAPE_TOOLS[host.tool()];
      if (!shape || Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < DRAG_THRESHOLD_PX) return;
      host.select([]);
      const snapping = startSnapping([]);
      const from = free ? gesture.start : shape === 'line' ? snapLineEnd(gesture.start, snapping, null).point : snapPoint(gesture.start, snapping);
      snapping.hold = { x: null, y: null };
      gesture = { kind: 'create', before: cloneDrawing(host.getDrawing()), shape, from, draft: null, snapping, samples: [], lastSampleAt: event.timeStamp };
    }
    if (gesture.kind === 'create') {
      let to: CanvasPoint;
      if (event.shiftKey) {
        to = constrainShapeEnd(gesture.shape, gesture.from, point, true);
        host.setOverlay({ guides: NO_GUIDE_LINES, snapPoint: null });
      } else if (free) {
        to = point;
        host.setOverlay({ guides: NO_GUIDE_LINES, snapPoint: null });
      } else {
        to = gesture.shape === 'line' ? snapLineEnd(point, gesture.snapping, null).point : snapPoint(point, gesture.snapping);
      }
      const draft = draftShape(gesture.shape, gesture.from, to, gesture.draft?.id ?? host.newItemId('shape'));
      if (gesture.shape === 'line' && !event.shiftKey) {
        const tolerance = Math.max(
          LINE_STRAIGHT_TOLERANCE_PX * host.unitsPerPixel(),
          LINE_STRAIGHT_TOLERANCE_RATIO * Math.hypot(to.x - gesture.from.x, to.y - gesture.from.y),
        );
        if (event.timeStamp - gesture.lastSampleAt >= LINE_SAMPLE_INTERVAL_MS) {
          gesture.samples = addCanvasLineSample(gesture.from, to, gesture.samples, point);
          gesture.lastSampleAt = event.timeStamp;
        }
        const { control } = fitCanvasLine(gesture.from, to, gesture.samples, tolerance);
        if (control) draft.control = control;
      }
      gesture.draft = draft;
      host.setPreview(draft);
      return;
    }
    if (gesture.kind === 'line-handle') {
      const isEnd = gesture.handle === 'start' || gesture.handle === 'end';
      let target = point;
      if (isEnd && !event.shiftKey && !free) target = snapLineEnd(point, gesture.snapping, gesture.original.id).point;
      else host.setOverlay({ guides: NO_GUIDE_LINES, snapPoint: null });
      const next = resizeShape(gesture.original, gesture.handle, target, isEnd && event.shiftKey);
      host.showDrawing(replaceItems(gesture.before, new Map([[next.id, next]])));
      return;
    }
    if (gesture.kind === 'box') {
      const target = free ? point : snapPoint(point, gesture.snapping);
      if (free) host.setOverlay({ guides: NO_GUIDE_LINES });
      const bounds = resizeBounds(gesture.bounds, gesture.handle, target, event.shiftKey, 2 * host.unitsPerPixel());
      const from = gesture.bounds;
      host.showDrawing(replaceItems(gesture.before, new Map(gesture.originals.map((item) => [item.id, transformItem(item, from, bounds)]))));
      return;
    }
    if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < DRAG_THRESHOLD_PX * host.unitsPerPixel() && !gesture.moved) return;
    gesture.moved = true;
    let dx = point.x - gesture.start.x;
    let dy = point.y - gesture.start.y;
    if (free) {
      host.setOverlay({ guides: NO_GUIDE_LINES });
    } else {
      const shifted = { left: gesture.bounds.left + dx, top: gesture.bounds.top + dy, right: gesture.bounds.right + dx, bottom: gesture.bounds.bottom + dy };
      const snapped = snapBoundsToGuides(shifted, gesture.snapping.targets, GUIDE_SNAP_PX * host.unitsPerPixel(), gesture.snapping.hold);
      gesture.snapping.hold = snapped.hold;
      dx += snapped.dx;
      dy += snapped.dy;
      host.setOverlay({ guides: snapped.lines });
    }
    host.showDrawing(replaceItems(gesture.before, new Map(gesture.originals.map((item) => [item.id, translateItem(item, dx, dy)]))));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!gesture) return;
    event.stopPropagation();
    const finished = gesture;
    gesture = null;
    finishCapture(event);
    host.setOverlay({ snapPoint: null, guides: NO_GUIDE_LINES, marquee: null });
    if (finished.kind === 'brush') {
      const before = cloneDrawing(host.getDrawing());
      host.setPreview(null);
      host.showDrawing(appendItem(host.getDrawing(), finished.stroke));
      host.commit('Draw', before);
      return;
    }
    if (finished.kind === 'erase') {
      host.commit('Erase', finished.before);
      return;
    }
    if (finished.kind === 'marquee') return;
    if (finished.kind === 'pending') {
      // A quick click away from a selection only deselects it.
      if (host.selectedItems().length > 0) {
        host.select([]);
      } else if (host.tool() === 'text') {
        const layer = findCanvasLayer(host.getDrawing(), host.activeLayerId());
        const box = layer ? containingBox(layer.items, finished.start) : null;
        const bounds = box ? shapeBounds(box) : null;
        host.editText(null, bounds ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 } : finished.start);
      }
      return;
    }
    if (finished.kind === 'create') {
      host.setPreview(null);
      const draft = finished.draft;
      if (!draft || isDegenerate(draft, host.unitsPerPixel())) return;
      host.showDrawing(appendItem(finished.before, draft));
      host.commit('Add shape', finished.before);
      host.select([draft.id]);
      return;
    }
    if (finished.kind === 'line-handle' || finished.kind === 'box') {
      host.commit(finished.kind === 'box' ? 'Resize' : 'Adjust shape', finished.before);
      return;
    }
    if (finished.moved) {
      host.commit('Move', finished.before);
    } else if (finished.clickRemovesId) {
      host.select(host.selectedItems().map((item) => item.id).filter((id) => id !== finished.clickRemovesId));
    } else if (finished.clickEditsText) {
      host.editText(finished.clickEditsText, finished.clickEditsText.at);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const selection = host.selectedItems();
    if (selection.length === 0) return;
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (event.key === 'Escape') {
      host.select([]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      const before = cloneDrawing(host.getDrawing());
      host.showDrawing(replaceItems(host.getDrawing(), new Map(selection.map((item) => [item.id, null]))));
      host.commit('Delete', before);
      host.select([]);
    } else if (nudge) {
      const step = (event.shiftKey ? NUDGE_SHIFT_PX : NUDGE_PX) * host.unitsPerPixel();
      const before = cloneDrawing(host.getDrawing());
      host.showDrawing(replaceItems(host.getDrawing(), new Map(selection.map((item) => [item.id, translateItem(item, nudge[0]! * step, nudge[1]! * step)]))));
      host.commit('Nudge', before);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    if (gesture || hoverId === null) return;
    hoverId = null;
    canvas.classList.remove('is-over-item');
    host.setOverlay({ hoverId: null });
  });
  canvas.addEventListener('keydown', onKeyDown);

  // Abandons the gesture in progress and undoes its live preview, for example
  // when a second finger turns the touch into a pinch.
  const cancel = () => {
    const abandoned = gesture;
    gesture = null;
    if (!abandoned) return;
    canvas.classList.remove('is-drawing');
    host.setPreview(null);
    host.setOverlay({ snapPoint: null, guides: NO_GUIDE_LINES, marquee: null });
    if ('before' in abandoned) host.showDrawing(abandoned.before);
  };
  return { isInteracting: () => gesture !== null, cancel };
}

// Shapes smaller than a few screen pixels are accidental clicks, not shapes.
function isDegenerate(shape: CanvasShapeItem, unitsPerPixel: number): boolean {
  const minimum = 3 * unitsPerPixel;
  const { left, top, right, bottom } = shapeBounds(shape);
  return shape.shape === 'line'
    ? Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) < minimum
    : right - left < minimum || bottom - top < minimum;
}
