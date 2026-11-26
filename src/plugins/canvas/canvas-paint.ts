import type { CanvasBrushItem, CanvasDash, CanvasDrawing, CanvasFillItem, CanvasItem, CanvasLayerFilter, CanvasPoint, CanvasShapeItem, CanvasTextItem } from './canvas-drawing-format';
import { boxHandles, itemBounds, type CanvasBounds } from './canvas-selection';
import { CANVAS_TEXT_LINE_HEIGHT, lineEndStrokes, linePath, shapeBounds, shapeHandles } from './canvas-shapes';
import { runsToLines, textItemRuns } from './canvas-text-runs';

// Painting shared by the live surface and static image export. Callers set
// the context transform so drawing happens in logical canvas units.

export interface CanvasOverlay {
  // Selected items; each gets an outline.
  selected: CanvasItem[];
  // A single selected line shows its end and curve handles instead of a box.
  selectedLine: CanvasShapeItem | null;
  // The selection box with resize handles, when the selection is not a single line.
  selectionBox: CanvasBounds | null;
  hovered: CanvasItem | null;
  marquee: CanvasBounds | null;
  guides: { x: number | null; y: number | null };
  snapPoint: CanvasPoint | null;
  accentColor: string;
  surfaceColor: string;
  // Logical units per CSS pixel, so handles keep a constant on-screen size.
  unitsPerPixel: number;
  canvasWidth: number;
  canvasHeight: number;
}

// Hidden layers are skipped. `hiddenItemId` hides one item while it is edited
// elsewhere (the text editor overlay). `clear` is false when the caller has
// already painted a background (the editor's artboard and grid).
export function paintCanvasDrawing(
  context: CanvasRenderingContext2D,
  drawing: CanvasDrawing,
  canvasWidth: number,
  canvasHeight: number,
  hiddenItemId: string | null = null,
  clear = true,
): void {
  if (clear) context.clearRect(0, 0, canvasWidth, canvasHeight);
  for (const layer of drawing.layers) {
    if (!layer.visible) continue;
    const items = hiddenItemId ? layer.items.filter((item) => !('id' in item) || item.id !== hiddenItemId) : layer.items;
    paintCanvasLayerItems(context, items, layer.filter, canvasWidth, canvasHeight);
  }
}

// Paints items as part of a layer, through the layer's filter if it has one.
// Also used for an item still being drawn, so it looks as it will once added.
export function paintCanvasLayerItems(
  context: CanvasRenderingContext2D,
  items: readonly CanvasItem[],
  filter: CanvasLayerFilter | undefined,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const paintItems = (target: CanvasRenderingContext2D) => {
    for (const item of items) paintCanvasItem(target, item, canvasWidth, canvasHeight);
  };
  if (filter) paintFilteredLayer(context, filter, paintItems);
  else paintItems(context);
}

// Scratch canvases for filtered layers, reused across paints.
let filterLayerCanvas: HTMLCanvasElement | null = null;
let filterMaskCanvas: HTMLCanvasElement | null = null;

// Paints a layer on its own canvas, applies the filter there with blend modes
// (restoring the layer's own transparency after each), and composites it with
// the filter's alpha.
function paintFilteredLayer(context: CanvasRenderingContext2D, filter: CanvasLayerFilter, paintItems: (target: CanvasRenderingContext2D) => void): void {
  const { width, height } = context.canvas;
  filterLayerCanvas ??= document.createElement('canvas');
  filterMaskCanvas ??= document.createElement('canvas');
  for (const scratch of [filterLayerCanvas, filterMaskCanvas]) {
    if (scratch.width !== width || scratch.height !== height) {
      scratch.width = width;
      scratch.height = height;
    }
  }
  const layer = filterLayerCanvas.getContext('2d');
  const mask = filterMaskCanvas.getContext('2d');
  if (!layer || !mask) return;
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.globalCompositeOperation = 'source-over';
  layer.clearRect(0, 0, width, height);
  layer.setTransform(context.getTransform());
  paintItems(layer);
  layer.setTransform(1, 0, 0, 1, 0, 0);
  mask.setTransform(1, 0, 0, 1, 0, 0);
  mask.globalCompositeOperation = 'copy';
  mask.drawImage(filterLayerCanvas, 0, 0);
  const blendAndRestoreAlpha = (operation: GlobalCompositeOperation, color: string) => {
    layer.globalCompositeOperation = operation;
    layer.fillStyle = color;
    layer.fillRect(0, 0, width, height);
    layer.globalCompositeOperation = 'destination-in';
    layer.drawImage(filterMaskCanvas!, 0, 0);
  };
  if (filter.invert) blendAndRestoreAlpha('difference', '#ffffff');
  const multiply = filter.multiply;
  if (multiply && (multiply.r !== 255 || multiply.g !== 255 || multiply.b !== 255)) {
    blendAndRestoreAlpha('multiply', `rgb(${multiply.r}, ${multiply.g}, ${multiply.b})`);
  }
  layer.globalCompositeOperation = 'source-over';
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha *= multiply?.a ?? 1;
  context.drawImage(filterLayerCanvas, 0, 0);
  context.restore();
}

export function paintCanvasItem(context: CanvasRenderingContext2D, item: CanvasItem, canvasWidth: number, canvasHeight: number): void {
  if (item.kind === 'fill') drawFill(context, item, canvasWidth, canvasHeight);
  else if (item.kind === 'brush') drawBrush(context, item);
  else if (item.kind === 'shape') drawShape(context, item);
  else drawText(context, item);
}

function applyStrokeStyle(context: CanvasRenderingContext2D, color: string, width: number, dash: CanvasDash | undefined): void {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash(dash === 'dashed' ? [width * 3, width * 2.4] : dash === 'dotted' ? [0.01, width * 2] : []);
}

function strokePolyline(context: CanvasRenderingContext2D, points: CanvasPoint[]): void {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
}

function drawBrush(context: CanvasRenderingContext2D, stroke: CanvasBrushItem): void {
  const first = stroke.points[0]!;
  context.save();
  applyStrokeStyle(context, stroke.color, stroke.width, stroke.dash);
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    strokePolyline(context, stroke.points);
  }
  context.restore();
}

function drawShape(context: CanvasRenderingContext2D, shape: CanvasShapeItem): void {
  context.save();
  applyStrokeStyle(context, shape.color, shape.width, shape.dash);
  const { left, top, right, bottom } = shapeBounds(shape);
  context.beginPath();
  if (shape.shape === 'rect') {
    context.rect(left, top, right - left, bottom - top);
  } else if (shape.shape === 'ellipse') {
    context.ellipse((left + right) / 2, (top + bottom) / 2, (right - left) / 2, (bottom - top) / 2, 0, 0, Math.PI * 2);
  } else {
    context.moveTo(shape.from.x, shape.from.y);
    if (shape.control) context.quadraticCurveTo(shape.control.x, shape.control.y, shape.to.x, shape.to.y);
    else context.lineTo(shape.to.x, shape.to.y);
  }
  context.stroke();
  context.restore();
  for (const end of lineEndStrokes(shape)) drawBrush(context, { kind: 'brush', ...end, color: shape.color });
}

// Lines are laid out from their sized runs and centered on `at`; each line is
// as tall as its largest size, and runs on a line share one baseline.
function drawText(context: CanvasRenderingContext2D, item: CanvasTextItem): void {
  const lines = runsToLines(textItemRuns(item)).map((segments) => {
    const maxSize = segments.length > 0 ? Math.max(...segments.map((segment) => segment.size)) : item.size;
    const measured = segments.map((segment) => {
      context.font = `${segment.size}px ${item.font}`;
      return { ...segment, width: context.measureText(segment.text).width };
    });
    return { segments: measured, maxSize, width: measured.reduce((total, segment) => total + segment.width, 0) };
  });
  const totalHeight = lines.reduce((total, line) => total + line.maxSize * CANVAS_TEXT_LINE_HEIGHT, 0);
  context.save();
  context.fillStyle = item.color;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  let top = item.at.y - totalHeight / 2;
  for (const line of lines) {
    const lineHeight = line.maxSize * CANVAS_TEXT_LINE_HEIGHT;
    // Baseline sits so the line's largest glyphs are vertically centered in the line box.
    const baseline = top + (lineHeight - line.maxSize) / 2 + line.maxSize * 0.8;
    let x = item.at.x - line.width / 2;
    for (const segment of line.segments) {
      context.font = `${segment.size}px ${item.font}`;
      context.fillText(segment.text, x, baseline);
      x += segment.width;
    }
    top += lineHeight;
  }
  context.restore();
}

// Reused across paints; fills with cutouts need a layer matching the target
// canvas's pixel size.
let fillLayerCanvas: HTMLCanvasElement | null = null;

// Cutouts only remove this fill's paint, so the fill is painted on its own
// layer, the cutout paths are cut from that layer, and the layer is composited.
function drawFill(context: CanvasRenderingContext2D, fill: CanvasFillItem, canvasWidth: number, canvasHeight: number): void {
  const cutouts = fill.cutouts ?? [];
  if (cutouts.length === 0) {
    context.save();
    context.fillStyle = fill.color;
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.restore();
    return;
  }
  fillLayerCanvas ??= document.createElement('canvas');
  if (fillLayerCanvas.width !== context.canvas.width || fillLayerCanvas.height !== context.canvas.height) {
    fillLayerCanvas.width = context.canvas.width;
    fillLayerCanvas.height = context.canvas.height;
  }
  const layer = fillLayerCanvas.getContext('2d');
  if (!layer) return;
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(0, 0, fillLayerCanvas.width, fillLayerCanvas.height);
  layer.setTransform(context.getTransform());
  layer.fillStyle = fill.color;
  layer.fillRect(0, 0, canvasWidth, canvasHeight);
  layer.globalCompositeOperation = 'destination-out';
  layer.strokeStyle = '#000000';
  layer.fillStyle = '#000000';
  layer.lineCap = 'round';
  layer.lineJoin = 'round';
  for (const cutout of cutouts) {
    const first = cutout.points[0]!;
    layer.beginPath();
    if (cutout.points.length === 1) {
      layer.arc(first.x, first.y, cutout.width / 2, 0, Math.PI * 2);
      layer.fill();
      continue;
    }
    layer.lineWidth = cutout.width;
    layer.moveTo(first.x, first.y);
    for (const point of cutout.points.slice(1)) layer.lineTo(point.x, point.y);
    layer.stroke();
  }
  layer.globalCompositeOperation = 'source-over';
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(fillLayerCanvas, 0, 0);
  context.restore();
}

export function paintCanvasOverlay(context: CanvasRenderingContext2D, overlay: CanvasOverlay): void {
  const unit = overlay.unitsPerPixel;
  context.save();
  context.strokeStyle = overlay.accentColor;
  context.lineWidth = 1.5 * unit;
  if (overlay.hovered && !overlay.selected.includes(overlay.hovered)) {
    context.globalAlpha = 0.45;
    outlineItem(context, overlay.hovered, unit);
    context.globalAlpha = 1;
  }
  context.setLineDash([5 * unit, 4 * unit]);
  for (const item of overlay.selected) outlineItem(context, item, unit);
  const box = overlay.selectionBox;
  if (box && overlay.selected.length > 1) {
    context.strokeRect(box.left - 6 * unit, box.top - 6 * unit, box.right - box.left + 12 * unit, box.bottom - box.top + 12 * unit);
  }
  context.setLineDash([]);
  const handles = overlay.selectedLine ? shapeHandles(overlay.selectedLine) : box ? boxHandles(box) : [];
  for (const { handle, point } of handles) {
    context.beginPath();
    context.arc(point.x, point.y, (handle === 'control' ? 5 : 4.5) * unit, 0, Math.PI * 2);
    context.fillStyle = handle === 'control' ? overlay.accentColor : overlay.surfaceColor;
    context.fill();
    context.stroke();
  }
  if (overlay.marquee) {
    const { left, top, right, bottom } = overlay.marquee;
    context.fillStyle = overlay.accentColor;
    context.globalAlpha = 0.08;
    context.fillRect(left, top, right - left, bottom - top);
    context.globalAlpha = 1;
    context.setLineDash([4 * unit, 3 * unit]);
    context.strokeRect(left, top, right - left, bottom - top);
    context.setLineDash([]);
  }
  context.setLineDash([3 * unit, 3 * unit]);
  context.lineWidth = unit;
  if (overlay.guides.x !== null) strokePolyline(context, [{ x: overlay.guides.x, y: 0 }, { x: overlay.guides.x, y: overlay.canvasHeight }]);
  if (overlay.guides.y !== null) strokePolyline(context, [{ x: 0, y: overlay.guides.y }, { x: overlay.canvasWidth, y: overlay.guides.y }]);
  context.setLineDash([]);
  if (overlay.snapPoint) {
    context.beginPath();
    context.arc(overlay.snapPoint.x, overlay.snapPoint.y, 7 * unit, 0, Math.PI * 2);
    context.lineWidth = 2 * unit;
    context.stroke();
  }
  context.restore();
}

function outlineItem(context: CanvasRenderingContext2D, item: CanvasItem, unit: number): void {
  if (item.kind === 'shape' && item.shape === 'line') {
    strokePolyline(context, linePath(item));
    return;
  }
  const bounds = itemBounds(item);
  if (!bounds) return;
  const pad = item.kind === 'shape' ? 0 : 4 * unit;
  context.strokeRect(bounds.left - pad, bounds.top - pad, bounds.right - bounds.left + 2 * pad, bounds.bottom - bounds.top + 2 * pad);
}

// The editor's artboard: surface color with an optional grid, in logical units.
export function paintArtboardBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  gridSize: number,
  colors: { surface: string; grid: string },
  unitsPerPixel: number,
): void {
  context.save();
  context.fillStyle = colors.surface;
  context.fillRect(0, 0, width, height);
  // Grid lines closer than 4 screen pixels would read as a solid tint.
  if (gridSize > 0 && gridSize / unitsPerPixel >= 4) {
    context.strokeStyle = colors.grid;
    context.globalAlpha = 0.45;
    context.lineWidth = unitsPerPixel;
    context.beginPath();
    for (let x = gridSize; x < width; x += gridSize) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
    for (let y = gridSize; y < height; y += gridSize) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
    context.stroke();
  }
  context.restore();
}

export async function renderCanvasDrawingPngBytes(drawing: CanvasDrawing, width: number, height: number, scale: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas plugin could not create a 2D context for static export.');
  }
  context.setTransform(scale, 0, 0, scale, 0, 0);
  paintCanvasDrawing(context, drawing, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Canvas plugin could not encode the drawing as PNG.');
  }
  return new Uint8Array(await blob.arrayBuffer());
}
