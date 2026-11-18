import type { JsonObject } from '../../hvy/types';
import { settingsIcon } from '../../icons';
import type { CanvasDash, CanvasLineEnd } from './canvas-drawing-format';
import {
  canvasArrowIcon,
  canvasBrushIcon,
  canvasEllipseIcon,
  canvasEraserIcon,
  canvasFillIcon,
  canvasLineBodyIcon,
  canvasLineHeadIcon,
  canvasRectIcon,
  canvasHandIcon,
  canvasSelectIcon,
  canvasTextIcon,
} from './canvas-icons';
import { makeCanvasFontSizeControl, type CanvasFontSizeControl } from './canvas-font-size-control';
import type { CanvasSelectableItem } from './canvas-selection';

export type CanvasTool = 'select' | 'hand' | 'brush' | 'eraser' | 'fill' | 'rect' | 'ellipse' | 'arrow' | 'text';

// null is a plain line end.
export interface CanvasLineStyle {
  startHead: CanvasLineEnd | null;
  endHead: CanvasLineEnd | null;
  dash: CanvasDash;
}

export interface CanvasSelectionStylePatch {
  color?: string;
  width?: number;
  size?: number;
  dash?: CanvasDash;
  // null removes the end marker.
  startHead?: CanvasLineEnd | null;
  endHead?: CanvasLineEnd | null;
}

export interface CanvasToolbarModel {
  viewerDrawing: boolean;
  viewerDrawingDisabled: boolean;
  color: string;
  strokeWidth: number;
  tool: CanvasTool;
  lineStyle: CanvasLineStyle;
  textSize: number;
  // Current selection; when non-empty, style controls edit it.
  selection: CanvasSelectableItem[];
}

export interface CanvasToolbarActions {
  setTool(tool: CanvasTool): void;
  setConfig(patch: JsonObject): void;
  // Opens the canvas settings dialog (artboard size, grid).
  openSettings(invoker: HTMLElement): void;
  setLineStyle(style: CanvasLineStyle): void;
  // Applies to the text being edited, else the selection, else new text.
  setFontSize(size: number): void;
  // Applies to every selected item it fits, as one undo step.
  styleSelected(patch: CanvasSelectionStylePatch): void;
}

const BRUSH_SIZES = [2, 4, 8, 16, 32];
// Tools whose strokes use the Size control.
const SIZED_TOOLS: CanvasTool[] = ['brush', 'eraser', 'rect', 'ellipse', 'arrow'];
const DASH_ORDER: CanvasDash[] = ['solid', 'dashed', 'dotted'];
const LINE_END_ORDER: Array<CanvasLineEnd | null> = [null, 'arrow', 'round'];
const LINE_END_LABELS: Record<CanvasLineEnd | 'none', string> = { none: 'none', arrow: 'arrow', round: 'round' };

// Controls the host updates in place, without rebuilding the toolbar.
export interface CanvasToolbarHandles {
  fontSize: CanvasFontSizeControl | null;
}

export function renderCanvasToolbar(toolbar: HTMLElement, model: CanvasToolbarModel, actions: CanvasToolbarActions): CanvasToolbarHandles {
  toolbar.replaceChildren();
  const handles: CanvasToolbarHandles = { fontSize: null };
  const selection = model.selection;
  const hasSelection = selection.length > 0;
  // With a selection, controls show its first item's values and edit every
  // item they apply to.
  const firstText = selection.find((item) => item.kind === 'text');
  const firstStroked = selection.find((item) => item.kind !== 'text');
  const firstLine = selection.find((item) => item.kind === 'shape' && item.shape === 'line');
  const textContext = hasSelection ? !firstStroked : model.tool === 'text';
  const lineContext = hasSelection ? Boolean(firstLine) : model.tool === 'arrow';
  const outlineContext = hasSelection ? Boolean(firstStroked) && !firstLine : model.tool === 'rect' || model.tool === 'ellipse';
  const selected = hasSelection;

  const color = selection[0]?.color ?? model.color;
  const lineStyle: CanvasLineStyle = firstStroked
    ? {
      startHead: firstLine?.kind === 'shape' ? firstLine.startHead ?? null : null,
      endHead: firstLine?.kind === 'shape' ? firstLine.endHead ?? null : null,
      dash: firstStroked.dash ?? 'solid',
    }
    : model.lineStyle;

  // One wrapping row: tools, color, the controls the current tool or selection
  // uses, then Viewer drawing and settings at the far end. The host defers
  // rebuilding it during a drag, so a re-wrap can't shift the canvas mid-gesture.
  const row = document.createElement('div');
  row.className = 'hvy-canvas-toolbar-row';
  toolbar.append(row);

  const sizeContext = hasSelection ? Boolean(firstStroked) : SIZED_TOOLS.includes(model.tool);
  row.append(
    makeToolPicker(model.tool, actions.setTool),
    makeColorControl(color, (next) => (selected ? actions.styleSelected({ color: next }) : actions.setConfig({ strokeColor: next }))),
  );
  if (textContext) {
    const size = firstText?.kind === 'text' ? firstText.size : model.textSize;
    handles.fontSize = makeCanvasFontSizeControl(size, actions.setFontSize);
    row.append(handles.fontSize.element);
  } else if (sizeContext) {
    const width = firstStroked ? firstStroked.width : model.strokeWidth;
    row.append(makeChoicePicker('Size', BRUSH_SIZES, width, (next) => `Brush size ${next}`, (next) => (
      selected ? actions.styleSelected({ width: next }) : actions.setConfig({ strokeWidth: next })
    ), brushSizeSwatch));
  }
  if (lineContext || outlineContext) {
    row.append(makeLineStylePicker(lineStyle, lineContext, (next) => (
      selected ? actions.styleSelected(next) : actions.setLineStyle({ ...lineStyle, ...next })
    )));
  }
  const settings = makeActionButton('Canvas settings', settingsIcon(), () => actions.openSettings(settings));
  settings.classList.add('hvy-canvas-settings-button');
  row.append(
    makeToggleControl(
      'Viewer drawing',
      !model.viewerDrawingDisabled && model.viewerDrawing,
      (viewerDrawing) => actions.setConfig({ viewerDrawing }),
      model.viewerDrawingDisabled ? 'PDF documents never allow drawing outside the editor.' : ''
    ),
    settings,
  );
  return handles;
}

function makeToolPicker(selected: CanvasTool, commit: (tool: CanvasTool) => void): HTMLDivElement {
  const tools: Array<[CanvasTool, string, string]> = [
    ['select', 'Select', canvasSelectIcon()],
    ['hand', 'Hand (pan)', canvasHandIcon()],
    ['brush', 'Brush', canvasBrushIcon()],
    ['eraser', 'Eraser', canvasEraserIcon()],
    ['fill', 'Fill canvas', canvasFillIcon()],
    ['rect', 'Rectangle', canvasRectIcon()],
    ['ellipse', 'Ellipse', canvasEllipseIcon()],
    ['arrow', 'Arrow', canvasArrowIcon()],
    ['text', 'Text', canvasTextIcon()],
  ];
  const choices = document.createElement('div');
  choices.className = 'hvy-canvas-tool-picker';
  for (const [tool, label, svg] of tools) {
    const button = makeActionButton(label, svg, () => commit(tool));
    button.classList.toggle('is-active', tool === selected);
    button.setAttribute('aria-pressed', String(tool === selected));
    choices.appendChild(button);
  }
  return wrapControl('Tool', choices);
}

function brushSizeSwatch(size: number): HTMLElement {
  const dot = document.createElement('span');
  dot.className = 'hvy-canvas-size-dot';
  dot.style.width = `${Math.max(3, Math.sqrt(size) * 2.2)}px`;
  dot.style.height = dot.style.width;
  return dot;
}


function makeChoicePicker(
  caption: string,
  values: number[],
  current: number,
  label: (value: number) => string,
  commit: (value: number) => void,
  swatch: (value: number) => HTMLElement,
): HTMLDivElement {
  const choices = document.createElement('div');
  choices.className = 'hvy-canvas-size-picker';
  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost hvy-canvas-size-choice';
    button.title = label(value);
    button.setAttribute('aria-label', label(value));
    button.setAttribute('aria-pressed', String(value === current));
    button.classList.toggle('is-active', value === current);
    button.appendChild(swatch(value));
    button.addEventListener('click', () => commit(value));
    choices.appendChild(button);
  }
  return wrapControl(caption, choices);
}

// Three independently clickable segments, each cycling its own setting: start
// end (none, arrow, round), line body (dash style), end end. Outline shapes
// only show the body.
function makeLineStylePicker(
  style: CanvasLineStyle,
  withHeads: boolean,
  commit: (patch: Partial<CanvasLineStyle>) => void,
): HTMLDivElement {
  const segments = document.createElement('div');
  segments.className = 'hvy-canvas-line-style';
  const segment = (label: string, svg: string, pressed: boolean, run: () => void, part: string) => {
    const button = makeActionButton(label, svg, run);
    button.classList.add('hvy-canvas-line-segment', `is-${part}`);
    button.classList.toggle('is-active', pressed);
    button.setAttribute('aria-pressed', String(pressed));
    return button;
  };
  const nextDash = DASH_ORDER[(DASH_ORDER.indexOf(style.dash) + 1) % DASH_ORDER.length]!;
  const nextEnd = (end: CanvasLineEnd | null) => LINE_END_ORDER[(LINE_END_ORDER.indexOf(end) + 1) % LINE_END_ORDER.length]!;
  const endSegment = (side: 'start' | 'end', end: CanvasLineEnd | null, run: () => void) => segment(
    `${side === 'start' ? 'Start' : 'End'} of line: ${LINE_END_LABELS[end ?? 'none']}`,
    canvasLineHeadIcon(side, end),
    end !== null,
    run,
    side,
  );
  if (withHeads) segments.append(endSegment('start', style.startHead, () => commit({ startHead: nextEnd(style.startHead) })));
  segments.append(segment(`Line style: ${style.dash}`, canvasLineBodyIcon(style.dash), style.dash !== 'solid', () => commit({ dash: nextDash }), 'body'));
  if (withHeads) segments.append(endSegment('end', style.endHead, () => commit({ endHead: nextEnd(style.endHead) })));
  return wrapControl('Line', segments);
}

function wrapControl(caption: string, content: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'hvy-canvas-control';
  const label = document.createElement('span');
  label.textContent = caption;
  wrapper.append(label, content);
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

function makeToggleControl(label: string, checked: boolean, commit: (value: boolean) => void, lockedReason = ''): HTMLLabelElement {
  const wrapper = document.createElement('label');
  // checkbox-label opts out of the modal grid layout for labels (the expanded view is a modal).
  wrapper.className = 'checkbox-label hvy-canvas-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  if (lockedReason) {
    input.disabled = true;
    wrapper.classList.add('is-locked');
    wrapper.title = lockedReason;
  }
  const track = document.createElement('span');
  track.className = 'hvy-canvas-toggle-track';
  const caption = document.createElement('span');
  caption.textContent = label;
  input.addEventListener('change', () => commit(input.checked));
  wrapper.append(input, track, caption);
  return wrapper;
}

export function makeActionButton(label: string, icon: string, run: () => void, danger = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `ghost hvy-canvas-action${danger ? ' danger' : ''}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  button.addEventListener('click', run);
  return button;
}
