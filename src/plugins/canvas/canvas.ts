import type { VisualBlock } from '../../editor/types';
import { isPdfDocument } from '../../pdf-document-rules';
import { invertCssColor } from '../../theme';
import type { VisualDocument } from '../../types';
import { writePluginStaticImageBlock } from '../plugin-static-image-block';
import { CANVAS_PLUGIN_ID, createBuiltInPluginMetadata } from '../registry';
import type { HvyPlugin, HvyPluginAttachmentsApi, HvyPluginContext, HvyPluginFactory, HvyPluginInstance, HvyPluginPdfStaticRenderContext } from '../types';
import canvasDocumentation from './about-canvas.txt?raw';
import {
  CANVAS_DEFAULT_FONT,
  CANVAS_MAX_ERASER_WIDTH,
  cloneDrawing,
  createCanvasDrawingName,
  createCanvasLayer,
  findCanvasLayer,
  getCanvasDrawingAttachmentId,
  finiteNumber,
  normalizeCanvasDrawing,
  normalizeCanvasItem,
  normalizeLayerFilter,
  normalizePoint,
  parseCanvasDrawing,
  serializeCanvasDrawing,
  withCanvasLayerItems,
  type CanvasDrawing,
  type CanvasItem,
  type CanvasLayer,
  type CanvasLayerFilter,
  type CanvasPoint,
  type CanvasTextItem,
} from './canvas-drawing-format';
import { eraseCanvasDrawing } from './canvas-erase';
import { createCanvasHistoryData, restoreCanvasHistory } from './canvas-history';
import { renderCanvasLayersPanel } from './canvas-layers-panel';
import { paintArtboardBackground, paintCanvasDrawing, paintCanvasLayerItems, paintCanvasOverlay, renderCanvasDrawingPngBytes } from './canvas-paint';
import { NO_GUIDE_LINES } from './canvas-guides';
import { attachCanvasPointer, type CanvasOverlayState } from './canvas-pointer';
import { isSelectableItem, unionBounds, type CanvasSelectableItem } from './canvas-selection';
import { canvasModalColorField, canvasModalNumberField, canvasModalPercentField, canvasModalToggleField, openCanvasModal, type CanvasModalHandle } from './canvas-modal';
import { createCanvasTextEditor } from './canvas-text-editor';
import { attachCanvasViewport, clampView, initialView, fitView, logicalToView, viewToLogical, type CanvasView } from './canvas-viewport';
import { runsToTextFields, textItemRuns } from './canvas-text-runs';
import { renderCanvasToolbar, type CanvasLineStyle, type CanvasSelectionStylePatch, type CanvasTool, type CanvasToolbarHandles } from './canvas-toolbar';
import './canvas.css';

// Script-facing API. Script changes are saved but are not undo steps.
export interface HvyCanvasApi {
  canvas: HTMLCanvasElement;
  getDrawing(): CanvasDrawing;
  setDrawing(drawing: CanvasDrawing): void;
  // Adds an item to the given layer, or to the active layer.
  addItem(item: CanvasItem, layerId?: string): void;
  erase(path: CanvasPoint[], width: number, layerId?: string): void;
  // Removes every item from the given layer, or from the active layer.
  clear(layerId?: string): void;
  // Removes the newest item from the active layer.
  undo(): void;
  redraw(): void;
  toDataURL(type?: string, quality?: number): string;
  // Page (client) coordinates of a logical canvas point at the current view.
  toClientPoint(point: CanvasPoint): CanvasPoint;
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
  // Name of the drawing attachment; empty until the canvas first saves.
  drawing: string;
  // Editor grid spacing in logical units; 0 hides the grid.
  gridSize: number;
}

const CANVAS_DRAWING_MEDIA_TYPE = 'application/vnd.hvy.canvas+json';
// Static PDF output rasterizes logical canvas units at this multiple so print
// output stays sharp when the image is fit to the page width.
const CANVAS_STATIC_PDF_SCALE = 3;

// PDF documents are viewed as their exported PDF, so their canvases are never
// drawable outside the editor (spec §7.13).
export function isCanvasViewerDrawingDisabled(document: Pick<VisualDocument, 'extension'>): boolean {
  return isPdfDocument(document);
}

export function readCanvasConfig(raw: Record<string, unknown>): CanvasConfig {
  return {
    width: Math.round(finiteNumber(raw.width, 800, 100, 4096)),
    height: Math.round(finiteNumber(raw.height, 450, 100, 4096)),
    viewerDrawing: raw.viewerDrawing === true,
    strokeColor: typeof raw.strokeColor === 'string' ? raw.strokeColor.trim() : '',
    strokeWidth: finiteNumber(raw.strokeWidth, 4, 1, 64),
    drawing: typeof raw.drawing === 'string' ? raw.drawing.trim() : '',
    gridSize: Math.round(finiteNumber(raw.gridSize, 20, 0, 400)),
  };
}

// A canvas without a drawing name has nothing stored yet.
function readCanvasDrawingAttachment(attachments: HvyPluginAttachmentsApi, drawingName: string): CanvasDrawing {
  const bytes = drawingName ? attachments.get(getCanvasDrawingAttachmentId(drawingName))?.bytes : null;
  return parseCanvasDrawing(new TextDecoder().decode(bytes ?? new Uint8Array()));
}

// Per-canvas UI state (tool, styles, view, layer choices) kept across plugin
// remounts, so re-rendering the block (for example when it is activated) does
// not reset what the author was doing. Keyed by the editor's mount root (stable
// across re-renders), then by canvas. Saved on every change, because a
// re-render builds the new instance before the old one unmounts.
interface CanvasUiState {
  tool: CanvasTool;
  lineStyle: CanvasLineStyle;
  textSize: number;
  view: CanvasView;
  viewAutomatic: boolean;
  activeLayerId: string;
  selectedLayerIds: string[];
  expanded: boolean;
}
const canvasUiStates = new WeakMap<object, Map<string, CanvasUiState>>();
// The newest instance per canvas owns its saved state: an older instance still
// tearing down after a re-render must not overwrite it.
const canvasUiStateOwners = new WeakMap<object, Map<string, symbol>>();

function canvasUiStateStore(mountRoot: object): Map<string, CanvasUiState> {
  let store = canvasUiStates.get(mountRoot);
  if (!store) {
    store = new Map();
    canvasUiStates.set(mountRoot, store);
  }
  return store;
}

function themeValue(root: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(root).getPropertyValue(name).trim() || fallback;
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-canvas-plugin hvy-canvas-plugin-${ctx.mode}`;
  root.dataset.hvyCanvasId = ctx.block.schema.id || ctx.block.id;
  // Used when the canvas has no drawing name yet; written to pluginConfig on
  // the first save so later saves and reloads find the same attachment.
  let unsavedDrawingName: string | null = null;
  const drawingName = () => readCanvasConfig(ctx.block.schema.pluginConfig).drawing || (unsavedDrawingName ??= createCanvasDrawingName());
  const drawingAttachmentMeta = () => ({ plugin: CANVAS_PLUGIN_ID, mediaType: CANVAS_DRAWING_MEDIA_TYPE });

  // Settings controls are not the editing surface, so activating the block
  // must not move focus into them.
  const toolbar = document.createElement('div');
  toolbar.className = 'hvy-canvas-toolbar';
  toolbar.setAttribute('data-editor-activation-autofocus', 'false');
  const layersPanel = document.createElement('div');
  layersPanel.className = 'hvy-canvas-layers';
  layersPanel.setAttribute('data-editor-activation-autofocus', 'false');

  const canvasFrame = document.createElement('div');
  canvasFrame.className = 'hvy-canvas-frame';
  const canvas = document.createElement('canvas');
  canvas.className = 'hvy-canvas-surface';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Drawable canvas');
  // A named field lets editor history remember the surface as the focused
  // target and restore focus to it after undo/redo, like any input.
  canvas.dataset.field = 'canvas-surface';
  const cursorPreview = document.createElement('div');
  cursorPreview.className = 'hvy-canvas-cursor-preview';
  cursorPreview.setAttribute('aria-hidden', 'true');
  canvasFrame.append(canvas, cursorPreview);
  const workspace = document.createElement('div');
  workspace.className = 'hvy-canvas-workspace';
  workspace.append(canvasFrame, layersPanel);
  root.append(toolbar, workspace);
  const textEditor = createCanvasTextEditor(canvasFrame);

  let drawing = readCanvasDrawingAttachment(ctx.attachments, drawingName());
  const uiStateKey = ctx.block.schema.id || readCanvasConfig(ctx.block.schema.pluginConfig).drawing || ctx.block.id;
  const savedUiState = canvasUiStateStore(ctx.hostRoot).get(uiStateKey);
  const uiStateOwner = Symbol(uiStateKey);
  if (!canvasUiStateOwners.has(ctx.hostRoot)) canvasUiStateOwners.set(ctx.hostRoot, new Map());
  canvasUiStateOwners.get(ctx.hostRoot)!.set(uiStateKey, uiStateOwner);
  let activeLayerId = savedUiState && findCanvasLayer(drawing, savedUiState.activeLayerId) ? savedUiState.activeLayerId : drawing.layers[drawing.layers.length - 1]!.id;
  // The editor starts on the hand tool, so a stray click or drag pans instead of drawing.
  let activeTool: CanvasTool = savedUiState?.tool ?? 'hand';
  let lineStyle: CanvasLineStyle = savedUiState?.lineStyle ?? { startHead: null, endHead: 'arrow', dash: 'solid' };
  let textSize = savedUiState?.textSize ?? 24;
  // Item selection, in any selected layer; the draw layer is always selected.
  let selectedIds: string[] = [];
  let selectedLayerIds = new Set<string>([activeLayerId, ...(savedUiState?.selectedLayerIds ?? [])]);
  let preview: CanvasItem | null = null;
  let overlayState: CanvasOverlayState = { snapPoint: null, guides: NO_GUIDE_LINES, marquee: null, hoverId: null };
  let toolbarHandles: CanvasToolbarHandles = { fontSize: null };
  let toolbarStale = false;
  // Replaced once the pointer module exists.
  let gestureInProgress = () => false;
  let editingTextId: string | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const config = () => readCanvasConfig(ctx.block.schema.pluginConfig);
  const viewerDrawingDisabled = isCanvasViewerDrawingDisabled(ctx.rawDocument);
  const isEditorView = () => ctx.view === 'editor';
  const isDrawingAllowed = () => isEditorView() || (!viewerDrawingDisabled && config().viewerDrawing);
  const activeLayer = (): CanvasLayer => findCanvasLayer(drawing, activeLayerId) ?? drawing.layers[drawing.layers.length - 1]!;
  const canDrawOnActiveLayer = () => isDrawingAllowed() && activeLayer().visible && !activeLayer().locked;
  const selectionLayerIds = (): Set<string> => new Set([activeLayer().id, ...[...selectedLayerIds].filter((id) => findCanvasLayer(drawing, id))]);
  // Viewers only get the brush; the other tools live in the editor toolbar.
  const currentTool = (): CanvasTool => (isEditorView() ? activeTool : 'brush');
  // The picked color, as the author sees it.
  const currentColor = () => config().strokeColor || themeValue(root, '--hvy-text', '#1f2937');
  // Layers with an invert filter store the inverse of the picked color, so it
  // appears on screen as picked. The same mapping converts stored colors back
  // for display in the toolbar and text editor.
  const layerInverts = (layerId: string) => findCanvasLayer(drawing, layerId)?.filter?.invert === true;
  const layerIdOfItem = (itemId: string) => drawing.layers.find((layer) => layer.items.some((item) => item.kind !== 'fill' && item.id === itemId))?.id ?? activeLayer().id;
  const toStoredColor = (color: string, layerId: string) => (layerInverts(layerId) ? invertCssColor(color) : color);
  const drawColor = () => toStoredColor(currentColor(), activeLayer().id);
  const unitsPerPixel = () => 1 / view.zoom;
  // Selected items in drawing order, limited to the selected layers.
  const selectedItems = (): CanvasSelectableItem[] => {
    if (selectedIds.length === 0) return [];
    const wanted = new Set(selectedIds);
    const layers = selectionLayerIds();
    return drawing.layers.flatMap((layer) => (layers.has(layer.id) ? layer.items : []))
      .filter((item): item is CanvasSelectableItem => isSelectableItem(item) && wanted.has(item.id));
  };
  const findItem = (id: string | null): CanvasItem | null => {
    if (!id) return null;
    for (const layer of drawing.layers) {
      const item = layer.items.find((candidate) => candidate.kind !== 'fill' && candidate.id === id);
      if (item) return item;
    }
    return null;
  };
  const newItemId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

  // The committed drawing is painted once into this offscreen canvas and
  // reused until the drawing, the view, the pixel size, or the hidden item
  // changes, so a pointer move only composites it under the in-progress preview.
  const baseLayer = document.createElement('canvas');
  let baseLayerKey: { drawing: CanvasDrawing; view: CanvasView; width: number; height: number; hiddenItemId: string | null; colors: typeof overlayColors } | null = null;
  // Read when the controls rebuild (theme changes refresh the plugin) rather
  // than on every pointer move.
  let overlayColors = { accent: '#2563eb', surface: '#ffffff', grid: '#d4d4d8' };

  // Editor: a zoomable, pannable window onto the artboard. Viewer: the
  // artboard scaled to the block width.
  let view: CanvasView = savedUiState?.view ?? { zoom: 1, panX: 0, panY: 0 };
  // While true, the view follows the window size (100% if the artboard fits,
  // else fit); any zoom or pan by the user turns it off.
  let viewAutomatic = savedUiState?.viewAutomatic ?? true;
  let viewWindow = { width: 0, height: 0 };
  // A layer filter being adjusted in the layer settings dialog: painted in
  // place of the drawing until the change is committed or abandoned.
  let filterPreview: CanvasDrawing | null = null;
  let viewArtboard = { width: 0, height: 0 };

  const paintBaseLayer = (transform: DOMMatrix, width: number, height: number, editorBackground: boolean) => {
    const painted = filterPreview ?? drawing;
    if (
      baseLayerKey?.drawing === painted
      && baseLayerKey.view === view
      && baseLayerKey.width === canvas.width
      && baseLayerKey.height === canvas.height
      && baseLayerKey.hiddenItemId === editingTextId
      && baseLayerKey.colors === overlayColors
    ) return;
    baseLayer.width = canvas.width;
    baseLayer.height = canvas.height;
    const baseContext = baseLayer.getContext('2d');
    if (!baseContext) return;
    baseContext.setTransform(1, 0, 0, 1, 0, 0);
    baseContext.clearRect(0, 0, baseLayer.width, baseLayer.height);
    baseContext.setTransform(transform);
    baseContext.save();
    baseContext.beginPath();
    baseContext.rect(0, 0, width, height);
    baseContext.clip();
    if (editorBackground) paintArtboardBackground(baseContext, width, height, config().gridSize, overlayColors, 1 / view.zoom);
    paintCanvasDrawing(baseContext, painted, width, height, editingTextId, !editorBackground);
    baseContext.restore();
    baseLayerKey = { drawing: painted, view, width: canvas.width, height: canvas.height, hiddenItemId: editingTextId, colors: overlayColors };
  };

  const layoutWindow = () => {
    const { width, height } = config();
    // The window is as tall as the artboard at 100%, capped at 70% of the
    // screen; expanded, it fills the panel.
    if (isEditorView()) {
      canvasFrame.classList.add('is-viewport');
      canvas.style.height = expandedView ? '100%' : `min(${height}px, 70vh)`;
      canvas.style.aspectRatio = '';
    } else {
      canvasFrame.classList.remove('is-viewport');
      canvas.style.height = '';
      canvas.style.aspectRatio = `${width} / ${height}`;
    }
  };

  const setView = (next: CanvasView, automatic: boolean) => {
    const { width, height } = config();
    view = clampView(next, width, height, viewWindow.width || width, viewWindow.height || height);
    viewAutomatic = automatic;
    viewport.refreshControls();
    saveUiState();
    redraw();
  };

  const redraw = () => {
    const { width, height } = config();
    layoutWindow();
    const cssWidth = Math.max(1, canvas.clientWidth || width);
    const cssHeight = isEditorView() ? Math.max(1, canvas.clientHeight || height) : cssWidth * height / width;
    if (!isEditorView()) {
      view = { zoom: cssWidth / width, panX: 0, panY: 0 };
    } else if (viewAutomatic && (cssWidth !== viewWindow.width || cssHeight !== viewWindow.height || width !== viewArtboard.width || height !== viewArtboard.height)) {
      view = initialView(width, height, cssWidth, cssHeight);
    }
    viewArtboard = { width, height };
    if (cssWidth !== viewWindow.width || cssHeight !== viewWindow.height) {
      // A view the author set keeps its center when the window resizes (for
      // example expanding or collapsing), instead of its top-left corner.
      if (isEditorView() && !viewAutomatic && viewWindow.width > 0) {
        view = {
          zoom: view.zoom,
          panX: view.panX + (viewWindow.width - cssWidth) / (2 * view.zoom),
          panY: view.panY + (viewWindow.height - cssHeight) / (2 * view.zoom),
        };
      }
      viewWindow = { width: cssWidth, height: cssHeight };
      viewport.refreshControls();
    }
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    const scale = dpr * view.zoom;
    const transform = new DOMMatrix([scale, 0, 0, scale, -view.panX * scale, -view.panY * scale]);
    paintBaseLayer(transform, width, height, isEditorView());
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(baseLayer, 0, 0);
    context.setTransform(transform);
    if (preview) paintCanvasLayerItems(context, [preview], activeLayer().filter, width, height);
    const selection = editingTextId ? [] : selectedItems();
    const single = selection.length === 1 ? selection[0]! : null;
    const selectedLine = single?.kind === 'shape' && single.shape === 'line' ? single : null;
    paintCanvasOverlay(context, {
      selected: selection,
      selectedLine,
      selectionBox: selection.length > 0 && !selectedLine ? unionBounds(selection) : null,
      hovered: findItem(overlayState.hoverId),
      marquee: overlayState.marquee,
      guides: overlayState.guides,
      snapPoint: overlayState.snapPoint,
      accentColor: overlayColors.accent,
      surfaceColor: overlayColors.surface,
      unitsPerPixel: unitsPerPixel(),
      canvasWidth: width,
      canvasHeight: height,
    });
    // Listeners draw in logical canvas units: the context keeps the view transform.
    root.dispatchEvent(new CustomEvent('hvy:canvas:render', {
      bubbles: true,
      detail: { api, context, width, height },
    }));
  };

  const persist = () => {
    const name = drawingName();
    // The attachment is written before the name is saved: saving the name
    // refreshes this instance, which must find the drawing already stored.
    ctx.attachments.set(getCanvasDrawingAttachmentId(name), drawingAttachmentMeta(), new TextEncoder().encode(serializeCanvasDrawing(drawing)));
    if (!config().drawing) ctx.setConfig({ drawing: name });
    root.dispatchEvent(new CustomEvent('hvy:canvas:change', {
      bubbles: true,
      detail: { api, drawing: cloneDrawing(drawing) },
    }));
  };

  // Whiteboard actions become app undo steps. `before` is the drawing as it was
  // before the action; the current drawing is the result.
  const commit = (label: string, before: CanvasDrawing) => {
    const data = createCanvasHistoryData(getCanvasDrawingAttachmentId(drawingName()), drawingAttachmentMeta(), before, drawing);
    if (data) ctx.history.record({ label, data, apply: persist });
    rebuildControls();
  };

  const showDrawing = (next: CanvasDrawing) => {
    drawing = next;
    redraw();
  };

  const select = (itemIds: string[]) => {
    selectedIds = [...new Set(itemIds)];
    overlayState = { ...overlayState, snapPoint: null };
    rebuildControls();
    redraw();
  };

  // Applies one style change to every selected item it fits, as one undo step.
  const styleSelected = (patch: CanvasSelectionStylePatch) => {
    const selection = selectedItems();
    if (selection.length === 0) return;
    const restyled = new Map(selection.map((item): [string, CanvasItem] => {
      const storedColor = patch.color ? toStoredColor(patch.color, layerIdOfItem(item.id)) : undefined;
      if (item.kind === 'text') {
        // A size set on the whole item replaces any per-character sizes.
        const { sizes, ...rest } = item;
        return [item.id, { ...rest, ...(storedColor ? { color: storedColor } : {}), ...(patch.size ? { size: patch.size } : sizes ? { sizes } : {}) }];
      }
      const next = { ...item, ...(storedColor ? { color: storedColor } : {}), ...(patch.width ? { width: patch.width } : {}), ...(patch.dash ? { dash: patch.dash } : {}) };
      if (next.kind === 'shape' && next.shape === 'line') {
        // null removes the end marker.
        for (const end of ['startHead', 'endHead'] as const) {
          const value = patch[end];
          if (value === null) delete next[end];
          else if (value) next[end] = value;
        }
      }
      return [item.id, next];
    }));
    const before = cloneDrawing(drawing);
    showDrawing({
      version: 2,
      layers: drawing.layers.map((layer) => ({
        ...layer,
        items: layer.items.map((item) => (item.kind !== 'fill' && item.id && restyled.has(item.id) ? restyled.get(item.id)! : item)),
      })),
    });
    commit('Restyle', before);
  };

  // Layer rows: a click makes a layer the draw layer (and the only selected
  // layer if it was not selected); Shift-click adds an unselected layer, or
  // isolates a selected one.
  const selectLayer = (layerId: string, additive: boolean) => {
    textEditor.close();
    const wasSelected = selectionLayerIds().has(layerId);
    if (additive && !wasSelected) {
      selectedLayerIds = new Set([...selectionLayerIds(), layerId]);
    } else {
      activeLayerId = layerId;
      if (!wasSelected || additive) selectedLayerIds = new Set([layerId]);
    }
    // Items on layers that are no longer selected leave the item selection.
    select(selectedItems().map((item) => item.id));
  };

  const editLayers = (label: string, update: (layers: CanvasLayer[]) => CanvasLayer[]) => {
    const before = cloneDrawing(drawing);
    showDrawing({ version: 2, layers: update(drawing.layers) });
    commit(label, before);
  };

  const editText = (existing: CanvasTextItem | null, at: CanvasPoint) => {
    const scale = view.zoom;
    const baseSize = existing?.size ?? textSize;
    // New text stores the layer's draw color; the editor shows the on-screen color.
    const color = drawColor();
    const displayColor = existing ? toStoredColor(existing.color, layerIdOfItem(existing.id)) : currentColor();
    const font = existing?.font ?? (getComputedStyle(root).fontFamily || CANVAS_DEFAULT_FONT);
    editingTextId = existing?.id ?? null;
    selectedIds = existing ? [existing.id] : [];
    redraw();
    textEditor.open({
      runs: existing ? textItemRuns(existing) : [],
      baseSize,
      center: { x: canvas.offsetLeft + logicalToView(view, at).x, y: canvas.offsetTop + logicalToView(view, at).y },
      scale,
      color: displayColor,
      font,
      onSelectionSize: (size) => toolbarHandles.fontSize?.setValue(size),
      onClose: (runs) => {
        editingTextId = null;
        const before = cloneDrawing(drawing);
        const fields = runs.length > 0 ? runsToTextFields(runs) : null;
        const withFields = (item: CanvasTextItem): CanvasTextItem => {
          const { sizes: _previous, ...rest } = item;
          return { ...rest, text: fields!.text, size: fields!.size, ...(fields!.sizes ? { sizes: fields!.sizes } : {}) };
        };
        if (existing) {
          const layer = drawing.layers.find((candidate) => candidate.items.some((item) => item.kind === 'text' && item.id === existing.id)) ?? activeLayer();
          const items = layer.items.flatMap((item) => (item.kind === 'text' && item.id === existing.id ? (fields ? [withFields(existing)] : []) : [item]));
          showDrawing(withCanvasLayerItems(drawing, layer.id, items));
          commit(fields ? 'Edit text' : 'Delete text', before);
          select(fields ? [existing.id] : []);
          return;
        }
        const layer = activeLayer();
        if (!fields) {
          redraw();
          return;
        }
        const item = withFields({ kind: 'text', id: newItemId('text'), text: '', at, size: baseSize, color, font });
        showDrawing(withCanvasLayerItems(drawing, layer.id, [...layer.items, item]));
        commit('Add text', before);
        select([item.id]);
      },
    });
  };

  // Per-layer filter dialog: invert, a color multiply, and opacity. Every change
  // is one undo step.
  const openLayerSettings = (layerId: string, invoker: HTMLElement) => {
    const layer = findCanvasLayer(drawing, layerId);
    if (!layer) return;
    const withFilter = (update: (filter: CanvasLayerFilter) => CanvasLayerFilter) => (layers: CanvasLayer[]) => layers.map((candidate) => {
      if (candidate.id !== layerId) return candidate;
      const { filter: previous, ...rest } = candidate;
      const next = normalizeLayerFilter(update(previous ?? {}));
      return next ? { ...rest, filter: next } : rest;
    });
    const setFilter = (update: (filter: CanvasLayerFilter) => CanvasLayerFilter) => {
      filterPreview = null;
      editLayers('Layer filter', withFilter(update));
    };
    const previewFilter = (update: (filter: CanvasLayerFilter) => CanvasLayerFilter) => {
      filterPreview = { ...drawing, layers: withFilter(update)(drawing.layers) };
      redraw();
    };
    const withColor = (value: string) => (filter: CanvasLayerFilter): CanvasLayerFilter => ({
      ...filter,
      multiply: { ...multiply(), r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) },
    });
    const withOpacity = (percent: number) => (filter: CanvasLayerFilter): CanvasLayerFilter => ({ ...filter, multiply: { ...multiply(), a: percent / 100 } });
    const multiply = () => findCanvasLayer(drawing, layerId)?.filter?.multiply ?? { r: 255, g: 255, b: 255, a: 1 };
    const hex = (value: number) => value.toString(16).padStart(2, '0');
    const current = layer.filter;
    const color = current?.multiply ? `#${hex(current.multiply.r)}${hex(current.multiply.g)}${hex(current.multiply.b)}` : '#ffffff';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost hvy-canvas-modal-reset';
    remove.textContent = 'Remove filter';
    remove.addEventListener('click', () => {
      setFilter(() => ({}));
      openLayerSettings(layerId, invoker);
    });
    openCanvasModal({
      title: `${layer.name} settings`,
      invoker,
      body: [
        canvasModalToggleField('Invert colors', current?.invert === true, (invert) => setFilter((filter) => ({ ...filter, invert }))),
        canvasModalColorField('Color filter (multiply)', color, (value) => setFilter(withColor(value)), (value) => previewFilter(withColor(value))),
        canvasModalPercentField('Opacity', (current?.multiply?.a ?? 1) * 100, (percent) => setFilter(withOpacity(percent)), (percent) => previewFilter(withOpacity(percent))),
        remove,
      ],
      onClose: () => {
        if (!filterPreview) return;
        filterPreview = null;
        redraw();
      },
    });
  };

  const saveUiState = () => {
    if (canvasUiStateOwners.get(ctx.hostRoot)?.get(uiStateKey) !== uiStateOwner) return;
    canvasUiStateStore(ctx.hostRoot).set(uiStateKey, {
      tool: activeTool,
      lineStyle,
      textSize,
      view,
      viewAutomatic,
      activeLayerId,
      selectedLayerIds: [...selectedLayerIds],
      expanded: expandedView !== null,
    });
  };

  // Expanded view: the same canvas element moves into a large panel over the
  // editor (inside the preview frame), keeping its tool, selection, and view. A
  // placeholder holds its space in the page so nothing below shifts.
  let expandedView: { handle: CanvasModalHandle; placeholder: HTMLElement } | null = null;
  const expand = () => {
    if (expandedView || !root.isConnected) return;
    const placeholder = document.createElement('div');
    placeholder.className = 'hvy-canvas-expanded-placeholder';
    placeholder.style.height = `${root.offsetHeight}px`;
    placeholder.textContent = 'Editing in the expanded canvas view.';
    root.replaceWith(placeholder);
    root.classList.add('is-expanded');
    const handle = openCanvasModal({
      title: 'Canvas',
      invoker: placeholder,
      body: [root],
      kind: 'expanded',
      panelClassName: 'hvy-canvas-expanded-panel',
      closeLabel: 'Collapse',
      // Escape belongs to the canvas (deselect, close the text editor), and
      // drawing near the edge must not close the view.
      closeOnEscape: false,
      closeOnOverlay: false,
      initialFocus: canvas,
      onClose: collapse,
    });
    expandedView = { handle, placeholder };
    rebuildControls();
    viewport.refreshControls();
    redraw();
  };
  // Opens the expanded view once the host has attached this instance's element.
  const reopenExpandedWhenAttached = () => {
    let attempts = 0;
    const reopen = () => {
      if (root.isConnected) expand();
      else if (attempts++ < 10) requestAnimationFrame(reopen);
    };
    reopen();
  };

  // A full editor render rebuilds the shell (removing the expanded panel) and
  // puts this same element back in the block. If the canvas still believes it
  // is expanded but is no longer in its panel, it reopens from where it is.
  const restoreExpandedAfterHostRender = () => {
    if (!expandedView || root.closest('.hvy-canvas-expanded-panel')) return;
    const stale = expandedView;
    expandedView = null;
    root.classList.remove('is-expanded');
    stale.handle.dismiss();
    reopenExpandedWhenAttached();
  };

  function collapse() {
    if (!expandedView) return;
    const { placeholder } = expandedView;
    expandedView = null;
    root.classList.remove('is-expanded');
    if (placeholder.isConnected) placeholder.replaceWith(root);
    rebuildControls();
    viewport.refreshControls();
    redraw();
  }

  const rebuildControls = () => {
    saveUiState();
    overlayColors = {
      accent: themeValue(root, '--hvy-accent-1', '#2563eb'),
      surface: themeValue(root, '--hvy-surface', '#ffffff'),
      grid: themeValue(root, '--hvy-border', '#d4d4d8'),
    };
    const drawingAllowed = isDrawingAllowed();
    canvas.classList.toggle('is-enabled', canDrawOnActiveLayer());
    canvas.classList.toggle('is-shape-tool', !['brush', 'eraser', 'select', 'hand'].includes(currentTool()));
    canvas.classList.toggle('is-select-tool', currentTool() === 'select');
    canvas.classList.toggle('is-text-tool', currentTool() === 'text');
    canvas.classList.toggle('is-hand-tool', currentTool() === 'hand');
    canvasFrame.classList.toggle('is-readonly', !drawingAllowed);
    if (drawingAllowed) canvas.tabIndex = 0;
    else canvas.removeAttribute('tabindex');
    if (!isEditorView()) {
      toolbar.hidden = true;
      layersPanel.hidden = true;
      return;
    }
    toolbar.hidden = false;
    layersPanel.hidden = false;
    const { viewerDrawing, strokeWidth } = config();
    // A field being typed in (or stepped with its arrows) keeps its element:
    // rebuilding would drop focus after the first change. During a drag the
    // rebuild waits for pointer-up, so a re-wrapping toolbar can't move the
    // canvas under the pointer.
    const focused = document.activeElement;
    const editingToolbarField = focused instanceof HTMLInputElement && toolbar.contains(focused);
    toolbarStale = gestureInProgress();
    if (!editingToolbarField && !toolbarStale) toolbarHandles = renderCanvasToolbar(toolbar, {
      viewerDrawing,
      viewerDrawingDisabled,
      color: currentColor(),
      strokeWidth,
      tool: activeTool,
      lineStyle,
      textSize,
      // Selected items in their on-screen colors, matching the picker.
      selection: selectedItems().map((item) => ({ ...item, color: toStoredColor(item.color, layerIdOfItem(item.id)) })),
    }, {
      setTool: (tool) => {
        textEditor.close();
        activeTool = tool;
        // The Select tool keeps the current selection; drawing tools start fresh.
        select(tool === 'select' ? selectedIds : []);
      },
      setConfig: (patch) => ctx.setConfig(patch),
      openSettings: (invoker) => {
        const { width, height, gridSize } = config();
        openCanvasModal({
          title: 'Canvas settings',
          invoker,
          body: [
            canvasModalNumberField('Width', width, 100, 4096, (next) => ctx.setConfig({ width: next }), 'Artboard width in pixels at 100% zoom.'),
            canvasModalNumberField('Height', height, 100, 4096, (next) => ctx.setConfig({ height: next }), 'Artboard height in pixels at 100% zoom.'),
            canvasModalNumberField('Grid size', gridSize, 0, 400, (next) => ctx.setConfig({ gridSize: next }), 'Grid spacing in pixels; 0 hides the grid. Editor only.'),
          ],
        });
      },
      setLineStyle: (style) => {
        lineStyle = style;
        rebuildControls();
      },
      setFontSize: (size) => {
        if (textEditor.isOpen()) {
          textSize = size;
          textEditor.applySize(size);
        } else if (selectedItems().some((item) => item.kind === 'text')) {
          styleSelected({ size });
        } else {
          textSize = size;
        }
        saveUiState();
      },
      styleSelected,
    });
    renderCanvasLayersPanel(layersPanel, drawing.layers, activeLayer().id, selectionLayerIds(), {
      select: selectLayer,
      add: () => {
        const ids = new Set(drawing.layers.map((layer) => layer.id));
        let number = drawing.layers.length + 1;
        while (ids.has(`layer-${number}`)) number += 1;
        const layer = createCanvasLayer(`layer-${number}`, `Layer ${number}`);
        const activeIndex = drawing.layers.findIndex((candidate) => candidate.id === activeLayer().id);
        activeLayerId = layer.id;
        selectedLayerIds = new Set([layer.id]);
        selectedIds = [];
        editLayers('Add layer', (layers) => [...layers.slice(0, activeIndex + 1), layer, ...layers.slice(activeIndex + 1)]);
      },
      remove: (layerId) => {
        if (drawing.layers.length <= 1) return;
        const index = drawing.layers.findIndex((layer) => layer.id === layerId);
        if (layerId === activeLayer().id) {
          activeLayerId = (drawing.layers[index - 1] ?? drawing.layers[index + 1])!.id;
        }
        selectedLayerIds.delete(layerId);
        selectedIds = [];
        editLayers('Delete layer', (layers) => layers.filter((layer) => layer.id !== layerId));
      },
      moveTo: (layerId, index) => editLayers('Move layer', (layers) => {
        const moving = layers.find((layer) => layer.id === layerId);
        if (!moving) return layers;
        const rest = layers.filter((layer) => layer !== moving);
        return [...rest.slice(0, index), moving, ...rest.slice(index)];
      }),
      openSettings: (layerId, invoker) => openLayerSettings(layerId, invoker),
      setVisible: (layerId, visible) => editLayers(visible ? 'Show layer' : 'Hide layer', (layers) => layers.map((layer) => (layer.id === layerId ? { ...layer, visible } : layer))),
      setLocked: (layerId, locked) => editLayers(locked ? 'Lock layer' : 'Unlock layer', (layers) => layers.map((layer) => (layer.id === layerId ? { ...layer, locked } : layer))),
      rename: (layerId, name) => editLayers('Rename layer', (layers) => layers.map((layer) => (layer.id === layerId ? { ...layer, name } : layer))),
    });
  };

  const api: HvyCanvasApi = {
    canvas,
    getDrawing: () => cloneDrawing(drawing),
    setDrawing(next) {
      showDrawing(normalizeCanvasDrawing(next));
      persist();
      refreshAfterExternalChange();
    },
    addItem(item, layerId) {
      // Scripts may omit ids; brush strokes, shapes, and text need one to be selectable.
      const withId = item && typeof item === 'object' && item.kind !== 'fill' && !item.id ? { ...item, id: newItemId(item.kind) } : item;
      const normalized = normalizeCanvasItem(withId);
      const layer = findCanvasLayer(drawing, layerId ?? activeLayer().id);
      if (!normalized || !layer) return;
      showDrawing(withCanvasLayerItems(drawing, layer.id, [...layer.items, normalized]));
      persist();
    },
    erase(path, width, layerId) {
      const points = (Array.isArray(path) ? path : []).map(normalizePoint).filter((point): point is CanvasPoint => point !== null);
      const next = eraseCanvasDrawing(drawing, layerId ?? activeLayer().id, points, finiteNumber(width, 0, 0, CANVAS_MAX_ERASER_WIDTH));
      if (next === drawing) return;
      showDrawing(next);
      persist();
    },
    clear(layerId) {
      const layer = findCanvasLayer(drawing, layerId ?? activeLayer().id);
      if (!layer || layer.items.length === 0) return;
      showDrawing(withCanvasLayerItems(drawing, layer.id, []));
      persist();
    },
    undo() {
      const layer = activeLayer();
      if (layer.items.length === 0) return;
      showDrawing(withCanvasLayerItems(drawing, layer.id, layer.items.slice(0, -1)));
      persist();
    },
    redraw,
    toDataURL: (type, quality) => canvas.toDataURL(type, quality),
    toClientPoint(point) {
      const bounds = canvas.getBoundingClientRect();
      const local = logicalToView(view, point);
      return { x: bounds.left + local.x, y: bounds.top + local.y };
    },
  };
  root.hvyCanvas = api;

  const pointer = attachCanvasPointer({
    canvas,
    canDrawOnActiveLayer,
    canSelect: isDrawingAllowed,
    tool: currentTool,
    activeLayerId: () => activeLayer().id,
    selectionLayerIds,
    getDrawing: () => drawing,
    showDrawing,
    commit,
    selectedItems,
    select,
    setPreview: (item) => {
      preview = item;
      redraw();
    },
    setOverlay: (patch) => {
      overlayState = { ...overlayState, ...patch };
      redraw();
    },
    pointFromEvent: (event) => {
      const bounds = canvas.getBoundingClientRect();
      return viewToLogical(view, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    },
    unitsPerPixel,
    color: drawColor,
    strokeWidth: () => config().strokeWidth,
    lineStyle: () => lineStyle,
    textSize: () => textSize,
    editText,
    isEditingText: () => textEditor.isOpen(),
    stopEditingText: () => textEditor.close(),
    newItemId,
  });

  gestureInProgress = () => pointer.isInteracting();
  // Registered after the pointer module, so this runs once its gesture has ended.
  for (const type of ['pointerup', 'pointercancel']) {
    canvas.addEventListener(type, () => {
      if (toolbarStale) rebuildControls();
    });
  }

  const viewport = attachCanvasViewport({
    surface: canvas,
    frame: canvasFrame,
    enabled: isEditorView,
    view: () => view,
    setView: (next, automatic) => setView(next, automatic),
    fit: () => setView(fitView(config().width, config().height, viewWindow.width, viewWindow.height), false),
    cancelGesture: () => pointer.cancel(),
    isHandTool: () => currentTool() === 'hand',
    isExpanded: () => expandedView !== null,
    toggleExpanded: () => (expandedView ? expandedView.handle.dismiss() : expand()),
  });

  canvas.addEventListener('click', (event) => {
    if (isDrawingAllowed()) event.stopPropagation();
  });
  // Clicks on the canvas's own controls belong to the plugin: letting them
  // reach the editor would activate the block, re-render it, and reset the
  // canvas's tool and selection mid-interaction. Clicks on empty toolbar or
  // panel space still reach the editor, so the block can be activated there.
  for (const controls of [toolbar, layersPanel]) {
    controls.addEventListener('click', (event) => {
      if ((event.target as HTMLElement | null)?.closest('button, input, select, textarea, label, [role="option"]')) event.stopPropagation();
    });
  }
  const updateCursorPreview = (event: PointerEvent) => {
    const tool = currentTool();
    if (!canDrawOnActiveLayer() || (tool !== 'brush' && tool !== 'eraser')) {
      cursorPreview.hidden = true;
      return;
    }
    const { strokeWidth } = config();
    const bounds = canvas.getBoundingClientRect();
    const diameter = Math.max(2, strokeWidth * view.zoom);
    cursorPreview.hidden = false;
    cursorPreview.style.width = `${diameter}px`;
    cursorPreview.style.height = `${diameter}px`;
    cursorPreview.style.transform = `translate(${event.clientX - bounds.left - diameter / 2}px, ${event.clientY - bounds.top - diameter / 2}px)`;
    cursorPreview.classList.toggle('is-eraser', tool === 'eraser');
  };
  canvas.addEventListener('pointerenter', updateCursorPreview);
  canvas.addEventListener('pointermove', updateCursorPreview);
  canvas.addEventListener('pointerleave', () => {
    cursorPreview.hidden = true;
  });

  // After the stored drawing changes underneath (undo/redo, scripts), keep the
  // active layer and selection only if they still exist.
  const refreshAfterExternalChange = () => {
    if (!findCanvasLayer(drawing, activeLayerId)) activeLayerId = drawing.layers[drawing.layers.length - 1]!.id;
    selectedLayerIds = selectionLayerIds();
    const remaining = new Set(selectedItems().map((item) => item.id));
    selectedIds = selectedIds.filter((id) => remaining.has(id));
    rebuildControls();
    redraw();
  };

  const refresh = () => {
    restoreExpandedAfterHostRender();
    const stored = readCanvasDrawingAttachment(ctx.attachments, drawingName());
    if (!pointer.isInteracting() && !textEditor.isOpen() && serializeCanvasDrawing(stored) !== serializeCanvasDrawing(drawing)) {
      drawing = stored;
    }
    refreshAfterExternalChange();
  };

  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(redraw);
  resizeObserver?.observe(canvasFrame);
  refresh();
  queueMicrotask(() => {
    redraw();
    root.dispatchEvent(new CustomEvent('hvy:canvas:ready', { bubbles: true, detail: { api } }));
    if (savedUiState?.expanded && isEditorView()) reopenExpandedWhenAttached();
  });

  return {
    element: root,
    refresh,
    unmount() {
      // Unmounting keeps the remembered expanded state, so a re-rendered block reopens expanded.
      const open = expandedView;
      expandedView = null;
      open?.handle.dismiss();
      textEditor.close();
      resizeObserver?.disconnect();
      delete root.hvyCanvas;
    },
  };
}

// An empty drawing still exports a blank image at the configured size so the
// PDF layout matches the authored canvas.
export async function renderCanvasStaticBlock(ctx: HvyPluginPdfStaticRenderContext): Promise<VisualBlock> {
  const config = readCanvasConfig(ctx.block.schema.pluginConfig);
  const drawing = readCanvasDrawingAttachment(ctx.attachments, config.drawing);
  return writePluginStaticImageBlock(ctx, {
    filenamePrefix: 'canvas',
    bytes: await renderCanvasDrawingPngBytes(drawing, config.width, config.height, CANVAS_STATIC_PDF_SCALE),
    mediaType: 'image/png',
    imageAlt: ctx.block.text.trim() || 'Canvas drawing',
  });
}

export const canvasPluginFactory: HvyPluginFactory = build;

export const canvasPlugin: HvyPlugin = {
  ...createBuiltInPluginMetadata(CANVAS_PLUGIN_ID),
  displayName: 'Canvas',
  documentation: { filename: 'about-canvas.txt', text: canvasDocumentation },
  aiHint: 'Drawable canvas with layers, brush strokes, shapes, arrows, and text. Dimensions and viewerDrawing live in pluginConfig; vector drawing data lives in a tail attachment.',
  aiHelp: `Use \`<!--hvy:plugin {"plugin":"${CANVAS_PLUGIN_ID}","pluginConfig":{"width":800,"height":450,"viewerDrawing":false,"drawing":"canvas-example"}}-->\` with a drawing name unique in the document. Keep the body as a short description; the client stores vector drawing data in the canvas:<drawing> attachment.`,
  visualDescription: {
    describe: () => 'Drawable canvas with vector data stored in its HVY tail attachment.',
  },
  create: canvasPluginFactory,
  history: {
    undo: (ctx) => restoreCanvasHistory(ctx, 'undo'),
    redo: (ctx) => restoreCanvasHistory(ctx, 'redo'),
  },
  pdf: {
    renderStatic: renderCanvasStaticBlock,
  },
};
