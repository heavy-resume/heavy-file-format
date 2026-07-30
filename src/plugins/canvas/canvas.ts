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

  const toolbar = document.createElement('div');
  toolbar.className = 'hvy-canvas-toolbar';

  const canvasFrame = document.createElement('div');
  canvasFrame.className = 'hvy-canvas-frame';
  const canvas = document.createElement('canvas');
  canvas.className = 'hvy-canvas-surface';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Drawable canvas');
  canvasFrame.appendChild(canvas);
  root.append(toolbar, canvasFrame);

  let drawing = parseCanvasDrawing(ctx.block.text);
  let activeStroke: CanvasStroke | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const isDrawingAllowed = () => ctx.mode === 'editor' || readCanvasConfig(ctx.block.schema.pluginConfig).viewerDrawing;

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
    for (const stroke of drawing.strokes) drawStroke(context, stroke);
    if (activeStroke) drawStroke(context, activeStroke);
    root.dispatchEvent(new CustomEvent('hvy:canvas:render', {
      bubbles: true,
      detail: { api, context, width: config.width, height: config.height },
    }));
  };

  const persist = () => {
    ctx.setText(serializeCanvasDrawing(drawing));
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
    activeStroke = {
      points: [pointFromEvent(event)],
      color: resolvedStrokeColor(root, config.strokeColor),
      width: config.strokeWidth,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-drawing');
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!activeStroke || !canvas.hasPointerCapture(event.pointerId)) return;
    activeStroke.points.push(pointFromEvent(event));
    redraw();
  };
  const finishStroke = (event: PointerEvent) => {
    if (!activeStroke) return;
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

  const rebuildToolbar = () => {
    toolbar.replaceChildren();
    const config = readCanvasConfig(ctx.block.schema.pluginConfig);
    const drawingAllowed = isDrawingAllowed();
    canvas.classList.toggle('is-enabled', drawingAllowed);
    canvasFrame.classList.toggle('is-readonly', !drawingAllowed);
    if (ctx.mode !== 'editor') {
      toolbar.hidden = true;
      return;
    }
    toolbar.hidden = false;
    toolbar.append(
      makeNumberControl('Width', config.width, 100, 4096, (width) => ctx.setConfig({ width })),
      makeNumberControl('Height', config.height, 100, 4096, (height) => ctx.setConfig({ height })),
      makeColorControl(config.strokeColor || resolvedStrokeColor(root, ''), (strokeColor) => ctx.setConfig({ strokeColor })),
      makeNumberControl('Brush', config.strokeWidth, 1, 64, (strokeWidth) => ctx.setConfig({ strokeWidth })),
      makeToggleControl('Viewer drawing', config.viewerDrawing, (viewerDrawing) => ctx.setConfig({ viewerDrawing })),
      makeActionButton('Undo', undoIcon(), () => api.undo()),
      makeActionButton('Clear', closeIcon(), () => api.clear(), true),
    );
  };

  const refresh = () => {
    const serialized = serializeCanvasDrawing(parseCanvasDrawing(ctx.block.text));
    if (serialized !== serializeCanvasDrawing(drawing) && !activeStroke) {
      drawing = parseCanvasDrawing(ctx.block.text);
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

function drawStroke(context: CanvasRenderingContext2D, stroke: CanvasStroke): void {
  const first = stroke.points[0];
  if (!first) return;
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
    return;
  }
  for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
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

export const canvasPluginFactory: HvyPluginFactory = build;

export const canvasPlugin: HvyPlugin = {
  id: CANVAS_PLUGIN_ID,
  displayName: 'Canvas',
  documentation: { filename: 'about-canvas.txt', text: canvasDocumentation },
  aiHint: 'Drawable canvas. Dimensions and viewerDrawing live in pluginConfig; versioned stroke data lives in plugin.txt.',
  aiHelp: `Use \`<!--hvy:plugin {"plugin":"${CANVAS_PLUGIN_ID}","pluginConfig":{"width":800,"height":450,"viewerDrawing":false}}-->\`. The body is a JSON CanvasDrawing object.`,
  visualDescription: {
    describe: ({ block }) => `${parseCanvasDrawing(block.text).strokes.length} drawn stroke(s) on a canvas.`,
  },
  create: canvasPluginFactory,
};
