import { closeIcon } from '../../icons';
import { CANVAS_PLUGIN_ID } from '../registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../types';
import canvasDocumentation from './about-canvas.txt?raw';
import './canvas.css';

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasStroke {
  points: CanvasPoint[];
  color: string;
  width: number;
  mode?: 'draw' | 'erase' | 'fill';
}

export interface CanvasDrawing {
  version: 1;
  strokes: CanvasStroke[];
}

export interface HvyCanvasApi {
  canvas: HTMLCanvasElement;
  getDrawing(): CanvasDrawing;
  setDrawing(drawing: CanvasDrawing): void;
  addStroke(stroke: CanvasStroke): void;
  clear(): void;
  undo(): void;
  redraw(): void;
  toDataURL(type?: string, quality?: number): string;
}

declare global {
  interface HTMLElement {
    hvyCanvas?: HvyCanvasApi;
  }
}

interface CanvasConfig {
  width: number;
  height: number;
  viewerDrawing: boolean;
  strokeColor: string;
  strokeWidth: number;
}

const EMPTY_DRAWING: CanvasDrawing = { version: 1, strokes: [] };
const CANVAS_DRAWING_MEDIA_TYPE = 'application/vnd.hvy.canvas+json';

export function getCanvasDrawingAttachmentId(blockId: string): string {
  return `canvas:${blockId}`;
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function readCanvasConfig(raw: Record<string, unknown>): CanvasConfig {
  return {
    width: Math.round(finiteNumber(raw.width, 800, 100, 4096)),
    height: Math.round(finiteNumber(raw.height, 450, 100, 4096)),
    viewerDrawing: raw.viewerDrawing === true,
    strokeColor: typeof raw.strokeColor === 'string' ? raw.strokeColor.trim() : '',
    strokeWidth: finiteNumber(raw.strokeWidth, 4, 1, 64),
  };
}

function normalizePoint(value: unknown): CanvasPoint | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: Number(point.x), y: Number(point.y) };
}

export function normalizeCanvasDrawing(value: unknown): CanvasDrawing {
  if (!value || typeof value !== 'object') return { ...EMPTY_DRAWING, strokes: [] };
  const strokes = Array.isArray((value as Record<string, unknown>).strokes)
    ? (value as Record<string, unknown>).strokes as unknown[]
    : [];
  return {
    version: 1,
    strokes: strokes.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const raw = candidate as Record<string, unknown>;
      const points = Array.isArray(raw.points)
        ? raw.points.map(normalizePoint).filter((point): point is CanvasPoint => point !== null)
        : [];
      if (points.length === 0) return [];
      return [{
        points,
        color: typeof raw.color === 'string' && raw.color.trim() ? raw.color : '#1f2937',
        width: finiteNumber(raw.width, 4, 1, 64),
        ...(raw.mode === 'erase' || raw.mode === 'fill' ? { mode: raw.mode } : {}),
      }];
    }),
  };
}

export function parseCanvasDrawing(text: string): CanvasDrawing {
  if (!text.trim()) return { ...EMPTY_DRAWING, strokes: [] };
  try {
    return normalizeCanvasDrawing(JSON.parse(text));
  } catch {
    return { ...EMPTY_DRAWING, strokes: [] };
  }
}

export function serializeCanvasDrawing(drawing: CanvasDrawing): string {
  return JSON.stringify(normalizeCanvasDrawing(drawing));
}

function cloneDrawing(drawing: CanvasDrawing): CanvasDrawing {
  return {
    version: 1,
    strokes: drawing.strokes.map((stroke) => ({
      color: stroke.color,
      width: stroke.width,
      ...(stroke.mode === 'erase' || stroke.mode === 'fill' ? { mode: stroke.mode } : {}),
      points: stroke.points.map((point) => ({ ...point })),
    })),
  };
}

function resolvedStrokeColor(root: HTMLElement, configured: string): string {
  if (configured) return configured;
  return getComputedStyle(root).getPropertyValue('--hvy-text').trim() || '#1f2937';
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-canvas-plugin hvy-canvas-plugin-${ctx.mode}`;
  root.dataset.hvyCanvasId = ctx.block.schema.id || ctx.block.id;
  const drawingAttachmentId = getCanvasDrawingAttachmentId(ctx.block.schema.id || ctx.block.id);

  const toolbar = document.createElement('div');
  toolbar.className = 'hvy-canvas-toolbar';

  const canvasFrame = document.createElement('div');
  canvasFrame.className = 'hvy-canvas-frame';
  const canvas = document.createElement('canvas');
  canvas.className = 'hvy-canvas-surface';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Drawable canvas');
  const cursorPreview = document.createElement('div');
  cursorPreview.className = 'hvy-canvas-cursor-preview';
  cursorPreview.setAttribute('aria-hidden', 'true');
  canvasFrame.append(canvas, cursorPreview);
  root.append(toolbar, canvasFrame);

  let drawing = parseCanvasDrawing(new TextDecoder().decode(
    ctx.attachments.get(drawingAttachmentId)?.bytes ?? new Uint8Array()
  ));
  let activeStroke: CanvasStroke | null = null;
  let activeTool: 'brush' | 'eraser' | 'fill' = 'brush';
  let resizeObserver: ResizeObserver | null = null;

  const isDrawingAllowed = () => ctx.view === 'editor' || readCanvasConfig(ctx.block.schema.pluginConfig).viewerDrawing;

  const redraw = () => {
    const config = readCanvasConfig(ctx.block.schema.pluginConfig);
    const cssWidth = Math.max(1, canvas.clientWidth || config.width);
    const cssHeight = cssWidth * config.height / config.width;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    canvas.style.aspectRatio = `${config.width} / ${config.height}`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr * cssWidth / config.width, 0, 0, dpr * cssHeight / config.height, 0, 0);
    context.clearRect(0, 0, config.width, config.height);
    for (const stroke of drawing.strokes) drawStroke(context, stroke, config.width, config.height);
    if (activeStroke) drawStroke(context, activeStroke, config.width, config.height);
    root.dispatchEvent(new CustomEvent('hvy:canvas:render', {
      bubbles: true,
      detail: { api, context, width: config.width, height: config.height },
    }));
  };

  const persist = () => {
    ctx.attachments.set(
      drawingAttachmentId,
      {
        plugin: CANVAS_PLUGIN_ID,
        blockId: ctx.block.schema.id || ctx.block.id,
        mediaType: CANVAS_DRAWING_MEDIA_TYPE,
      },
      new TextEncoder().encode(serializeCanvasDrawing(drawing))
    );
    root.dispatchEvent(new CustomEvent('hvy:canvas:change', {
      bubbles: true,
      detail: { api, drawing: cloneDrawing(drawing) },
    }));
  };

  const api: HvyCanvasApi = {
    canvas,
    getDrawing: () => cloneDrawing(drawing),
    setDrawing(next) {
      drawing = normalizeCanvasDrawing(next);
      redraw();
      persist();
    },
    addStroke(stroke) {
      const normalized = normalizeCanvasDrawing({ strokes: [stroke] }).strokes[0];
      if (!normalized) return;
      drawing.strokes.push(normalized);
      redraw();
      persist();
    },
    clear() {
      if (drawing.strokes.length === 0) return;
      drawing.strokes = [];
      redraw();
      persist();
    },
    undo() {
      if (!drawing.strokes.pop()) return;
      redraw();
      persist();
    },
    redraw,
    toDataURL: (type, quality) => canvas.toDataURL(type, quality),
  };
  root.hvyCanvas = api;

  const pointFromEvent = (event: PointerEvent): CanvasPoint => {
    const config = readCanvasConfig(ctx.block.schema.pluginConfig);
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * config.width / Math.max(1, bounds.width),
      y: (event.clientY - bounds.top) * config.height / Math.max(1, bounds.height),
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isDrawingAllowed() || event.button !== 0) return;
    const config = readCanvasConfig(ctx.block.schema.pluginConfig);
    if (activeTool === 'fill') {
      drawing.strokes.push({
        points: [{ x: 0, y: 0 }],
        color: resolvedStrokeColor(root, config.strokeColor),
        width: 1,
        mode: 'fill',
      });
      redraw();
      persist();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    activeStroke = {
      points: [pointFromEvent(event)],
      color: resolvedStrokeColor(root, config.strokeColor),
      width: config.strokeWidth,
      ...(activeTool === 'eraser' ? { mode: 'erase' as const } : {}),
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-drawing');
    event.preventDefault();
    event.stopPropagation();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!activeStroke || !canvas.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    activeStroke.points.push(pointFromEvent(event));
    redraw();
  };
  const finishStroke = (event: PointerEvent) => {
    if (!activeStroke) return;
    event.stopPropagation();
    activeStroke.points.push(pointFromEvent(event));
    drawing.strokes.push(activeStroke);
    activeStroke = null;
    canvas.classList.remove('is-drawing');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    redraw();
    persist();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);
  canvas.addEventListener('click', (event) => {
    if (isDrawingAllowed()) event.stopPropagation();
  });
  const updateCursorPreview = (event: PointerEvent) => {
    if (!isDrawingAllowed() || activeTool === 'fill') {
      cursorPreview.hidden = true;
      return;
    }
    const config = readCanvasConfig(ctx.block.schema.pluginConfig);
    const bounds = canvas.getBoundingClientRect();
    const diameter = Math.max(2, config.strokeWidth * bounds.width / config.width);
    cursorPreview.hidden = false;
    cursorPreview.style.width = `${diameter}px`;
    cursorPreview.style.height = `${diameter}px`;
    cursorPreview.style.transform = `translate(${event.clientX - bounds.left - diameter / 2}px, ${event.clientY - bounds.top - diameter / 2}px)`;
    cursorPreview.classList.toggle('is-eraser', activeTool === 'eraser');
  };
  canvas.addEventListener('pointerenter', updateCursorPreview);
  canvas.addEventListener('pointermove', updateCursorPreview);
  canvas.addEventListener('pointerleave', () => {
    cursorPreview.hidden = true;
  });

  const rebuildToolbar = () => {
    toolbar.replaceChildren();
    const config = readCanvasConfig(ctx.block.schema.pluginConfig);
    const drawingAllowed = isDrawingAllowed();
    canvas.classList.toggle('is-enabled', drawingAllowed);
    canvasFrame.classList.toggle('is-readonly', !drawingAllowed);
    if (ctx.view !== 'editor') {
      toolbar.hidden = true;
      return;
    }
    toolbar.hidden = false;
    const toolPicker = makeToolPicker(activeTool, (tool) => {
      activeTool = tool;
      rebuildToolbar();
    });
    toolbar.append(
      makeNumberControl('Width', config.width, 100, 4096, (width) => ctx.setConfig({ width })),
      makeNumberControl('Height', config.height, 100, 4096, (height) => ctx.setConfig({ height })),
      toolPicker,
      makeColorControl(config.strokeColor || resolvedStrokeColor(root, ''), (strokeColor) => ctx.setConfig({ strokeColor })),
      makeSizePicker(config.strokeWidth, (strokeWidth) => ctx.setConfig({ strokeWidth })),
      makeToggleControl('Viewer drawing', config.viewerDrawing, (viewerDrawing) => ctx.setConfig({ viewerDrawing })),
      makeActionButton('Undo', undoIcon(), () => api.undo()),
      makeActionButton('Clear', closeIcon(), () => api.clear(), true),
    );
  };

  const refresh = () => {
    const serialized = serializeCanvasDrawing(parseCanvasDrawing(new TextDecoder().decode(
      ctx.attachments.get(drawingAttachmentId)?.bytes ?? new Uint8Array()
    )));
    if (serialized !== serializeCanvasDrawing(drawing) && !activeStroke) {
      drawing = parseCanvasDrawing(new TextDecoder().decode(
        ctx.attachments.get(drawingAttachmentId)?.bytes ?? new Uint8Array()
      ));
    }
    rebuildToolbar();
    redraw();
  };

  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(redraw);
  resizeObserver?.observe(canvasFrame);
  refresh();
  queueMicrotask(() => {
    redraw();
    root.dispatchEvent(new CustomEvent('hvy:canvas:ready', { bubbles: true, detail: { api } }));
  });

  return {
    element: root,
    refresh,
    unmount() {
      resizeObserver?.disconnect();
      delete root.hvyCanvas;
    },
  };
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: CanvasStroke,
  canvasWidth: number,
  canvasHeight: number
): void {
  const first = stroke.points[0];
  if (!first) return;
  context.save();
  if (stroke.mode === 'fill') {
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = stroke.color;
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.restore();
    return;
  }
  context.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
  context.beginPath();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.moveTo(first.x, first.y);
  if (stroke.points.length === 1) {
    context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
  context.restore();
}

function makeToolPicker(
  selected: 'brush' | 'eraser' | 'fill',
  commit: (tool: 'brush' | 'eraser' | 'fill') => void
): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'hvy-canvas-control';
  const caption = document.createElement('span');
  caption.textContent = 'Tool';
  const choices = document.createElement('div');
  choices.className = 'hvy-canvas-tool-picker';
  choices.append(
    makeToolButton('Brush', brushIcon(), selected === 'brush', () => commit('brush')),
    makeToolButton('Eraser', eraserIcon(), selected === 'eraser', () => commit('eraser')),
    makeToolButton('Fill canvas', fillIcon(), selected === 'fill', () => commit('fill')),
  );
  wrapper.append(caption, choices);
  return wrapper;
}

function makeToolButton(label: string, icon: string, selected: boolean, commit: () => void): HTMLButtonElement {
  const button = makeActionButton(label, icon, commit);
  button.classList.toggle('is-active', selected);
  button.setAttribute('aria-pressed', String(selected));
  return button;
}

function makeSizePicker(value: number, commit: (value: number) => void): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'hvy-canvas-control';
  const caption = document.createElement('span');
  caption.textContent = 'Size';
  const choices = document.createElement('div');
  choices.className = 'hvy-canvas-size-picker';
  [2, 4, 8, 16, 32].forEach((size) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost hvy-canvas-size-choice';
    button.title = `${size}px`;
    button.setAttribute('aria-label', `Brush size ${size}`);
    button.setAttribute('aria-pressed', String(value === size));
    button.classList.toggle('is-active', value === size);
    const dot = document.createElement('span');
    dot.style.width = `${Math.max(3, Math.sqrt(size) * 2.2)}px`;
    dot.style.height = dot.style.width;
    button.appendChild(dot);
    button.addEventListener('click', () => commit(size));
    choices.appendChild(button);
  });
  wrapper.append(caption, choices);
  return wrapper;
}

function makeNumberControl(label: string, value: number, min: number, max: number, commit: (value: number) => void): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'hvy-canvas-control';
  const caption = document.createElement('span');
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener('change', () => commit(finiteNumber(input.value, value, min, max)));
  wrapper.append(caption, input);
  return wrapper;
}

function makeColorControl(value: string, commit: (value: string) => void): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'hvy-canvas-control hvy-canvas-color';
  const caption = document.createElement('span');
  caption.textContent = 'Color';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#1f2937';
  input.addEventListener('change', () => commit(input.value));
  wrapper.append(caption, input);
  return wrapper;
}

function makeToggleControl(label: string, checked: boolean, commit: (value: boolean) => void): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'hvy-canvas-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const track = document.createElement('span');
  track.className = 'hvy-canvas-toggle-track';
  const caption = document.createElement('span');
  caption.textContent = label;
  input.addEventListener('change', () => commit(input.checked));
  wrapper.append(input, track, caption);
  return wrapper;
}

function makeActionButton(label: string, icon: string, run: () => void, danger = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `ghost hvy-canvas-action${danger ? ' danger' : ''}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  button.addEventListener('click', run);
  return button;
}

function undoIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function brushIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4-4 4 4-4 4M13 7l4 4-8.5 8.5c-1.5 1.5-4.2 1.7-6.5.5 1.2-2.3 1-5 2.5-6.5L13 7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function eraserIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 4.5 5 5a2 2 0 0 1 0 2.8l-7.2 7.2H7.5l-3-3a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 2.8 0ZM9 19.5l-4-4M12.5 19.5H21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function fillIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 3 10 10-6.5 6.5a2.2 2.2 0 0 1-3 0l-4-4a2.2 2.2 0 0 1 0-3L13 3M5 11h12M19 17.5s-2 2.2-2 3.3a2 2 0 0 0 4 0c0-1.1-2-3.3-2-3.3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

export const canvasPluginFactory: HvyPluginFactory = build;

export const canvasPlugin: HvyPlugin = {
  id: CANVAS_PLUGIN_ID,
  displayName: 'Canvas',
  documentation: { filename: 'about-canvas.txt', text: canvasDocumentation },
  aiHint: 'Drawable canvas. Dimensions and viewerDrawing live in pluginConfig; vector drawing data lives in a tail attachment.',
  aiHelp: `Use \`<!--hvy:plugin {"plugin":"${CANVAS_PLUGIN_ID}","pluginConfig":{"width":800,"height":450,"viewerDrawing":false}}-->\`. Keep the body as a short description; the client stores vector drawing data in the canvas attachment.`,
  visualDescription: {
    describe: () => 'Drawable canvas with vector data stored in its HVY tail attachment.',
  },
  create: canvasPluginFactory,
};
