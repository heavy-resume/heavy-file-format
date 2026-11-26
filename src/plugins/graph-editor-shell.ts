import { chevronDownIcon } from '../icons';
import { renderTableEditorFrame, renderTableEditorGrid } from '../editor/components/table/table-editor-grid';
import { escapeAttr, escapeHtml } from '../utils';
import { createFormRangeControl, type FormRangeDragTracker } from './form-range-field/form-range-field';
import { renderGraphAxisBoundControls, syncGraphAxisBoundControls } from './graph-axis-bounds';
import {
  GRAPH_BAR_GAP_RANGE,
  GRAPH_BAR_WIDTH_RANGE,
  GRAPH_SERIES_LAYOUTS,
  GRAPH_TYPES,
  graphTypeSupportsAxes,
  graphTypeSupportsSeriesLayout,
  readGraphConfig,
  type GraphConfig,
  type GraphSeriesLayout,
  type GraphType,
} from './graph-chart-config';
import { DEFAULT_GRAPH_CSV, getEditableGraphRows, parseGraphCsv } from './graph-csv';

export function renderGraphError(message: string): string {
  return `<div class="hvy-graph-error">${escapeHtml(message)}</div>`;
}

export function syncGraphEditorShell(root: HTMLElement, rawConfig: Record<string, unknown>, csv: string, rangeDragTracker: FormRangeDragTracker): void {
  const config = readGraphConfig(rawConfig);
  const active = document.activeElement;
  const inRoot = active instanceof HTMLElement && root.contains(active);
  const activeField = inRoot ? active.dataset.graphField ?? '' : '';
  const activeRow = inRoot ? active.dataset.rowIndex ?? '' : '';
  const activeColumn = inRoot ? active.dataset.columnIndex ?? '' : '';
  const activeSelection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
    : null;
  const focusedInTable = activeField === 'cell' || activeField === 'column';
  const editor = root.querySelector<HTMLElement>('.hvy-graph-editor');
  // The shell is built once and patched afterward, so the chart canvas and any
  // slider being dragged survive edits.
  if (!editor) {
    root.innerHTML = renderEditorShell(config, rawConfig, csv);
  } else if (!focusedInTable) {
    const existingTable = root.querySelector<HTMLElement>('.hvy-graph-data-panel .table-editor');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderDataTable(csv);
    const next = wrapper.firstElementChild;
    if (existingTable && next) existingTable.replaceWith(next);
  }
  syncGraphControlVisibility(root, config);
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[data-graph-field]:not([type="range"]), select[data-graph-field]').forEach((input) => {
    const field = input.dataset.graphField ?? '';
    if (field === 'legend' && input instanceof HTMLInputElement) {
      input.checked = config.legend;
      return;
    }
    const value = readGraphTextControlValue(config, field);
    if (value !== null && input.value !== value) input.value = value;
  });
  syncGraphRangeControls(root, config, rangeDragTracker);
  syncGraphAxisBoundControls(root, config.type, rawConfig);
  restoreGraphFocus(root, activeField, activeRow, activeColumn, activeSelection);
}

function readGraphTextControlValue(config: GraphConfig, field: string): string | null {
  switch (field) {
    case 'type': return config.type;
    case 'title': return config.title;
    case 'xAxisLabel': return config.xAxisLabel;
    case 'yAxisLabel': return config.yAxisLabel;
    case 'seriesLayout': return config.type === 'line' && config.seriesLayout !== 'stacked' ? 'grouped' : config.seriesLayout;
    default: return null;
  }
}

type GraphRangeField = 'barWidth' | 'barGap';

const GRAPH_RANGE_FIELDS: Record<GraphRangeField, { min: number; max: number }> = {
  barWidth: GRAPH_BAR_WIDTH_RANGE,
  barGap: GRAPH_BAR_GAP_RANGE,
};

// Sliders work in whole percents; pluginConfig stores the fraction.
function syncGraphRangeControls(root: HTMLElement, config: GraphConfig, rangeDragTracker: FormRangeDragTracker): void {
  if (rangeDragTracker.isDragging()) return;
  (Object.keys(GRAPH_RANGE_FIELDS) as GraphRangeField[]).forEach((field) => {
    const slot = root.querySelector<HTMLElement>(`[data-graph-range-slot="${field}"]`);
    if (!slot) return;
    const value = String(Math.round(config[field] * 100));
    const existing = slot.querySelector<HTMLInputElement>('input');
    if (existing?.value === value) return;
    const wasFocused = existing !== null && existing === document.activeElement;
    const range = GRAPH_RANGE_FIELDS[field];
    const { control, input } = createFormRangeControl({
      name: `hvy-graph-${field}`,
      bounds: { min: Math.round(range.min * 100), max: Math.round(range.max * 100), step: 5 },
      value,
      unit: '%',
    });
    input.dataset.graphField = field;
    rangeDragTracker.watch(input);
    slot.replaceChildren(control);
    if (wasFocused) input.focus({ preventScroll: true });
  });
}

function syncGraphControlVisibility(root: HTMLElement, config: GraphConfig): void {
  const isBar = config.type === 'bar';
  const isLine = config.type === 'line';
  const hasAxes = graphTypeSupportsAxes(config.type);
  const seriesHidden: Record<string, boolean> = {
    seriesLayout: !graphTypeSupportsSeriesLayout(config.type),
    barWidth: !isBar,
    barGap: !isBar || config.seriesLayout !== 'grouped',
  };
  const hidden: Record<string, boolean> = {
    xAxisLabel: !hasAxes,
    yAxisLabel: !hasAxes,
    ...seriesHidden,
  };
  Object.entries(hidden).forEach(([control, isHidden]) => {
    root.querySelector<HTMLElement>(`[data-graph-control="${control}"]`)?.toggleAttribute('hidden', isHidden);
  });
  const controls = root.querySelector<HTMLElement>('.hvy-graph-controls');
  if (controls) {
    controls.dataset.graphHasAxes = hasAxes ? 'true' : 'false';
  }
  const seriesSelect = root.querySelector<HTMLSelectElement>('select[data-graph-field="seriesLayout"]');
  if (seriesSelect) {
    const allowedLayouts = isLine ? GRAPH_LINE_SERIES_LAYOUTS : GRAPH_SERIES_LAYOUTS;
    const labels = isLine ? GRAPH_LINE_SERIES_LAYOUT_LABELS : GRAPH_SERIES_LAYOUT_LABELS;
    const currentValues = Array.from(seriesSelect.options).map((option) => option.value);
    const sameOptions = currentValues.length === allowedLayouts.length
      && allowedLayouts.every((layout, index) => currentValues[index] === layout);
    if (!sameOptions) {
      seriesSelect.replaceChildren(
        ...allowedLayouts.map((layout) => {
          const option = document.createElement('option');
          option.value = layout;
          option.textContent = labels[layout];
          return option;
        })
      );
    } else {
      Array.from(seriesSelect.options).forEach((option) => {
        const nextLabel = labels[option.value as GraphSeriesLayout];
        if (nextLabel && option.textContent !== nextLabel) {
          option.textContent = nextLabel;
        }
      });
    }
  }
  root.querySelector<HTMLElement>('.hvy-graph-series-controls')?.toggleAttribute('hidden', Object.values(seriesHidden).every(Boolean));
}

const GRAPH_TYPE_LABELS: Record<GraphType, string> = {
  bar: 'Bar',
  line: 'Line',
  pie: 'Pie',
  doughnut: 'Doughnut',
  scatter: 'Scatter',
  bubble: 'Bubble',
  radar: 'Radar',
  polarArea: 'Polar area',
};

const GRAPH_SERIES_LAYOUT_LABELS: Record<GraphSeriesLayout, string> = {
  grouped: 'Side by side',
  stacked: 'Stacked',
  overlapped: 'Overlapped',
};

const GRAPH_LINE_SERIES_LAYOUTS: readonly GraphSeriesLayout[] = ['grouped', 'stacked'];

const GRAPH_LINE_SERIES_LAYOUT_LABELS: Record<GraphSeriesLayout, string> = {
  grouped: 'Separate',
  stacked: 'Stacked',
  overlapped: 'Overlapped',
};

function renderEditorShell(config: GraphConfig, rawConfig: Record<string, unknown>, csv: string): string {
  const hasAxes = graphTypeSupportsAxes(config.type);
  const seriesLayouts = config.type === 'line' ? GRAPH_LINE_SERIES_LAYOUTS : GRAPH_SERIES_LAYOUTS;
  const seriesLabels = config.type === 'line' ? GRAPH_LINE_SERIES_LAYOUT_LABELS : GRAPH_SERIES_LAYOUT_LABELS;
  const activeSeriesLayout = config.type === 'line' && config.seriesLayout !== 'stacked' ? 'grouped' : config.seriesLayout;
  return `<div class="hvy-graph-editor" data-editor-activation-autofocus="false">
    <div class="hvy-graph-controls" data-graph-has-axes="${hasAxes ? 'true' : 'false'}">
      <label class="hvy-graph-field">
        <span class="hvy-graph-field-label">Type</span>
        <span class="hvy-graph-select-shell">
          <select data-graph-field="type">
            ${GRAPH_TYPES.map((type) => `<option value="${type}"${config.type === type ? ' selected' : ''}>${GRAPH_TYPE_LABELS[type]}</option>`).join('')}
          </select>
          ${chevronDownIcon()}
        </span>
      </label>
      <label class="hvy-graph-field">
        <span class="hvy-graph-field-label">Title</span>
        <input type="text" data-graph-field="title" value="${escapeAttr(config.title)}" placeholder="Chart title">
      </label>
      <label class="hvy-graph-field" data-graph-control="xAxisLabel"${hasAxes ? '' : ' hidden'}>
        <span class="hvy-graph-field-label">X axis</span>
        <input type="text" data-graph-field="xAxisLabel" value="${escapeAttr(config.xAxisLabel)}" placeholder="Optional">
      </label>
      <label class="hvy-graph-field" data-graph-control="yAxisLabel"${hasAxes ? '' : ' hidden'}>
        <span class="hvy-graph-field-label">Y axis</span>
        <input type="text" data-graph-field="yAxisLabel" value="${escapeAttr(config.yAxisLabel)}" placeholder="Optional">
      </label>
      <label class="checkbox-label hvy-graph-toggle">
        <input type="checkbox" data-graph-field="legend"${config.legend ? ' checked' : ''}>
        <span>Legend</span>
      </label>
      <div class="hvy-graph-series-controls">
        <label class="hvy-graph-field" data-graph-control="seriesLayout">
          <span class="hvy-graph-field-label">Series</span>
          <span class="hvy-graph-select-shell">
            <select data-graph-field="seriesLayout">
              ${seriesLayouts.map((layout) => `<option value="${layout}"${activeSeriesLayout === layout ? ' selected' : ''}>${seriesLabels[layout]}</option>`).join('')}
            </select>
            ${chevronDownIcon()}
          </span>
        </label>
        <label class="hvy-graph-field hvy-graph-range-field" data-graph-control="barWidth">
          <span class="hvy-graph-field-label">Bar width</span>
          <span class="hvy-graph-range-slot" data-graph-range-slot="barWidth"></span>
        </label>
        <label class="hvy-graph-field hvy-graph-range-field" data-graph-control="barGap">
          <span class="hvy-graph-field-label">Bar gap</span>
          <span class="hvy-graph-range-slot" data-graph-range-slot="barGap"></span>
        </label>
      </div>
      ${renderGraphAxisBoundControls(config.type, rawConfig)}
    </div>
    <div data-graph-preview="true"></div>
    <div class="hvy-graph-data-panel">
      ${renderDataTable(csv)}
    </div>
  </div>`;
}

function renderDataTable(csv: string): string {
  const parsed = parseGraphCsv(csv.trim().length > 0 ? csv : DEFAULT_GRAPH_CSV);
  if (parsed.error) {
    return renderTableEditorFrame(renderGraphError(parsed.error));
  }
  const rows = parsed.rows.length > 0 ? parsed.rows : getEditableGraphRows(DEFAULT_GRAPH_CSV);
  const [headers = [], ...bodyRows] = rows;
  const canRemoveColumn = headers.length > 1;

  return renderTableEditorGrid({
    columns: headers.map((cell, columnIndex) => ({
      thAttrs: `data-graph-column-drop="true" data-column-index="${columnIndex}"`,
      leadingHtml: `<button type="button" class="table-drag-handle" draggable="true" data-graph-drag="column" data-column-index="${columnIndex}" title="Drag to reorder column">::</button>`,
      editableAttrs: `contenteditable="true" spellcheck="false" data-graph-field="column" data-column-index="${columnIndex}" data-placeholder="Column ${columnIndex + 1}"`,
      contentHtml: escapeHtml(cell),
      removeButtonAttrs: canRemoveColumn ? `data-graph-action="remove-column" data-column-index="${columnIndex}"` : null,
    })),
    addColumnButtonAttrs: 'data-graph-action="add-column"',
    rows: bodyRows.map((row, rowOffset) => {
      const rowIndex = rowOffset + 1;
      return {
        trAttrs: `data-graph-row-drop="true" data-row-index="${rowIndex}"`,
        leadingHtml: `<button type="button" class="table-drag-handle" draggable="true" data-graph-drag="row" data-row-index="${rowIndex}" title="Drag to reorder row">::</button>`,
        cells: headers.map((_header, columnIndex) => {
          const value = row[columnIndex] ?? '';
          const placeholder = headers[columnIndex] || 'Cell value';
          return {
            editableAttrs: `contenteditable="true" spellcheck="false" data-graph-field="cell" data-row-index="${rowIndex}" data-column-index="${columnIndex}" data-placeholder="${escapeAttr(placeholder)}"`,
            contentHtml: escapeHtml(value),
          };
        }),
        removeButtonAttrs: `data-graph-action="remove-row" data-row-index="${rowIndex}"`,
      };
    }),
    addRowButtonAttrs: 'data-graph-action="add-row"',
  });
}

function restoreGraphFocus(
  root: HTMLElement,
  field: string,
  row: string,
  column: string,
  selection: { start: number | null; end: number | null; direction: 'forward' | 'backward' | 'none' | null } | null
): void {
  if (!field) return;
  const selector = field === 'cell'
    ? `[data-graph-field="cell"][data-row-index="${cssEscape(row)}"][data-column-index="${cssEscape(column)}"]`
    : field === 'column'
      ? `[data-graph-field="column"][data-column-index="${cssEscape(column)}"]`
      : `[data-graph-field="${cssEscape(field)}"]`;
  const target = root.querySelector<HTMLElement>(selector);
  if (!target) return;
  try {
    target.focus({ preventScroll: true });
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && selection && selection.start !== null && selection.end !== null) {
      target.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
    }
  } catch {
    // Best effort.
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1');
}
