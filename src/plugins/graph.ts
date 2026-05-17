import './graph.css';

import { GRAPH_PLUGIN_ID } from './registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from './types';
import graphDocumentation from './graph.about.txt?raw';

export const GRAPH_TYPES = ['bar', 'line', 'pie', 'doughnut', 'scatter', 'bubble', 'radar', 'polarArea'] as const;
export type GraphType = (typeof GRAPH_TYPES)[number];

interface GraphConfig {
  type: GraphType;
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  legend: boolean;
}

export interface CsvParseResult {
  rows: string[][];
  error: string | null;
}

export interface GraphBuildResult {
  data: Record<string, unknown>;
  error: string | null;
}

type ChartModule = typeof import('chart.js/auto');
type ChartInstance = InstanceType<ChartModule['Chart']>;

const DEFAULT_CSV = 'Label,Value\nExample A,10\nExample B,20\nExample C,15';
const DEFAULT_CONFIG: GraphConfig = {
  type: 'bar',
  title: '',
  xAxisLabel: '',
  yAxisLabel: '',
  legend: true,
};

let chartModulePromise: Promise<ChartModule> | null = null;

function loadChartModule(): Promise<ChartModule> {
  chartModulePromise ??= import('chart.js/auto');
  return chartModulePromise;
}

function readConfig(raw: Record<string, unknown>): GraphConfig {
  const rawType = typeof raw.type === 'string' ? raw.type : '';
  return {
    type: GRAPH_TYPES.includes(rawType as GraphType) ? rawType as GraphType : DEFAULT_CONFIG.type,
    title: typeof raw.title === 'string' ? raw.title : DEFAULT_CONFIG.title,
    xAxisLabel: typeof raw.xAxisLabel === 'string' ? raw.xAxisLabel : DEFAULT_CONFIG.xAxisLabel,
    yAxisLabel: typeof raw.yAxisLabel === 'string' ? raw.yAxisLabel : DEFAULT_CONFIG.yAxisLabel,
    legend: typeof raw.legend === 'boolean' ? raw.legend : DEFAULT_CONFIG.legend,
  };
}

export function parseGraphCsv(csv: string): CsvParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (inQuotes) {
    return { rows: [], error: 'CSV contains an unclosed quoted value.' };
  }
  row.push(field);
  rows.push(row);
  const trimmedRows = rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell.length > 0));
  if (trimmedRows.length === 0) {
    return { rows: [], error: null };
  }
  const width = trimmedRows[0]?.length ?? 0;
  if (width === 0) {
    return { rows: [], error: null };
  }
  const inconsistent = trimmedRows.some((cells) => cells.length !== width);
  return {
    rows: trimmedRows,
    error: inconsistent ? 'CSV rows must all have the same number of columns.' : null,
  };
}

export function serializeGraphCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function numberOrNull(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

export function buildGraphChartData(csv: string, type: GraphType): GraphBuildResult {
  const parsed = parseGraphCsv(csv);
  if (parsed.error) {
    return { data: {}, error: parsed.error };
  }
  if (parsed.rows.length < 2) {
    return { data: {}, error: 'Graph data needs a header row and at least one data row.' };
  }
  const [headers, ...bodyRows] = parsed.rows;
  if (!headers || headers.length < 2) {
    return { data: {}, error: 'Graph data needs at least two columns.' };
  }
  if (type === 'scatter' || type === 'bubble') {
    const requiredColumns = type === 'bubble' ? 3 : 2;
    if (headers.length < requiredColumns) {
      return { data: {}, error: `${type} charts need ${requiredColumns} numeric columns.` };
    }
    const points = bodyRows.map((row) => {
      const x = numberOrNull(row[0] ?? '');
      const y = numberOrNull(row[1] ?? '');
      const r = type === 'bubble' ? numberOrNull(row[2] ?? '') : null;
      return { x, y, r };
    });
    if (points.some((point) => point.x === null || point.y === null || (type === 'bubble' && point.r === null))) {
      return { data: {}, error: `${type} chart values must be numeric.` };
    }
    return {
      data: {
        datasets: [{
          label: headers[1] || 'Series 1',
          data: points.map((point) => type === 'bubble' ? { x: point.x, y: point.y, r: point.r } : { x: point.x, y: point.y }),
        }],
      },
      error: null,
    };
  }

  const labels = bodyRows.map((row) => row[0] ?? '');
  const numericColumnIndexes = headers.slice(1).map((_header, offset) => offset + 1);
  if (type === 'pie' || type === 'doughnut' || type === 'polarArea') {
    const column = numericColumnIndexes[0];
    const values = bodyRows.map((row) => numberOrNull(row[column] ?? ''));
    if (values.some((value) => value === null)) {
      return { data: {}, error: `${type} chart values must be numeric.` };
    }
    return {
      data: {
        labels,
        datasets: [{ label: headers[column] || 'Value', data: values }],
      },
      error: null,
    };
  }

  const datasets = numericColumnIndexes.map((column) => {
    const values = bodyRows.map((row) => numberOrNull(row[column] ?? ''));
    return {
      label: headers[column] || `Series ${column}`,
      data: values,
    };
  });
  if (datasets.some((dataset) => dataset.data.some((value) => value === null))) {
    return { data: {}, error: `${type} chart values must be numeric.` };
  }
  return { data: { labels, datasets }, error: null };
}

function renderChartOptions(config: GraphConfig): Record<string, unknown> {
  const axisScales = config.type === 'pie' || config.type === 'doughnut' || config.type === 'polarArea' || config.type === 'radar'
    ? {}
    : {
        x: { title: { display: Boolean(config.xAxisLabel.trim()), text: config.xAxisLabel } },
        y: { title: { display: Boolean(config.yAxisLabel.trim()), text: config.yAxisLabel } },
      };
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: config.legend },
      title: { display: Boolean(config.title.trim()), text: config.title },
    },
    scales: axisScales,
  };
}

function renderChartFrame(): string {
  return '<div class="hvy-graph-frame"><canvas></canvas></div>';
}

function renderError(message: string): string {
  return `<div class="hvy-graph-error">${escapeHtml(message)}</div>`;
}

function renderEmpty(): string {
  return '<div class="hvy-graph-empty">Add CSV data to render a graph.</div>';
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-graph hvy-graph-${ctx.mode}`;
  let chart: ChartInstance | null = null;
  let renderVersion = 0;

  const destroyChart = () => {
    chart?.destroy();
    chart = null;
  };

  const drawChart = async (canvas: HTMLCanvasElement, config: GraphConfig, csv: string, version: number) => {
    const built = buildGraphChartData(csv, config.type);
    if (built.error) {
      destroyChart();
      root.innerHTML = ctx.mode === 'editor'
        ? `${renderEditorShell(ctx, config, csv)}${renderError(built.error)}`
        : renderError(built.error);
      return;
    }
    const module = await loadChartModule();
    if (version !== renderVersion || !canvas.isConnected) return;
    destroyChart();
    chart = new module.Chart(canvas, {
      type: config.type,
      data: built.data as never,
      options: renderChartOptions(config),
    });
  };

  const renderPreview = () => {
    const version = ++renderVersion;
    const config = readConfig(ctx.block.schema.pluginConfig);
    const csv = ctx.block.text.trim().length > 0 ? ctx.block.text : DEFAULT_CSV;
    const parsed = parseGraphCsv(csv);
    if (parsed.rows.length === 0) {
      destroyChart();
      root.innerHTML = ctx.mode === 'editor'
        ? `${renderEditorShell(ctx, config, csv)}${renderEmpty()}`
        : renderEmpty();
      return;
    }
    if (ctx.mode === 'reader') {
      root.innerHTML = renderChartFrame();
    } else {
      syncEditorShell(ctx, root, config, csv);
      const preview = root.querySelector<HTMLElement>('[data-graph-preview="true"]');
      if (preview) preview.innerHTML = renderChartFrame();
    }
    const canvas = root.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) return;
    void drawChart(canvas, config, csv, version).catch((error) => {
      if (version !== renderVersion) return;
      root.innerHTML = renderError(error instanceof Error ? error.message : 'Unable to render graph.');
    });
  };

  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!target) return;
    const field = target.dataset.graphField;
    if (!field) return;
    if (field === 'csv-text') {
      ctx.setText((target as HTMLTextAreaElement).value);
      return;
    }
    if (field === 'cell') {
      const rowIndex = Number(target.dataset.rowIndex);
      const columnIndex = Number(target.dataset.columnIndex);
      const rows = getEditableRows(ctx.block.text);
      if (!rows[rowIndex]) return;
      rows[rowIndex]![columnIndex] = target.value;
      ctx.setText(serializeGraphCsv(rows));
      return;
    }
    if (field === 'legend' && target instanceof HTMLInputElement) {
      ctx.setConfig({ legend: target.checked });
      return;
    }
    ctx.setConfig({ [field]: target.value });
  };

  const onClick = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-graph-action]');
    if (!button) return;
    const action = button.dataset.graphAction;
    const rows = getEditableRows(ctx.block.text);
    if (action === 'add-row') {
      const width = rows[0]?.length || 2;
      rows.push(Array.from({ length: width }, () => ''));
      ctx.setText(serializeGraphCsv(rows));
    }
    if (action === 'add-column') {
      rows.forEach((row, index) => row.push(index === 0 ? `Series ${row.length}` : ''));
      ctx.setText(serializeGraphCsv(rows));
    }
  };

  if (ctx.mode === 'editor') {
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    root.addEventListener('click', onClick);
  }

  renderPreview();
  return {
    element: root,
    refresh: renderPreview,
    unmount: () => {
      destroyChart();
      if (ctx.mode === 'editor') {
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onInput);
        root.removeEventListener('click', onClick);
      }
    },
  };
}

function getEditableRows(csv: string): string[][] {
  const parsed = parseGraphCsv(csv.trim().length > 0 ? csv : DEFAULT_CSV);
  if (parsed.rows.length > 0 && !parsed.error) {
    return parsed.rows.map((row) => [...row]);
  }
  return parseGraphCsv(DEFAULT_CSV).rows.map((row) => [...row]);
}

function syncEditorShell(ctx: HvyPluginContext, root: HTMLElement, config: GraphConfig, csv: string): void {
  const active = document.activeElement;
  const activeField = active instanceof HTMLElement && root.contains(active) ? active.dataset.graphField ?? '' : '';
  const activeRow = active instanceof HTMLElement && root.contains(active) ? active.dataset.rowIndex ?? '' : '';
  const activeColumn = active instanceof HTMLElement && root.contains(active) ? active.dataset.columnIndex ?? '' : '';
  const activeSelection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
    : null;
  const focusedInData = activeField === 'cell' || activeField === 'csv-text';
  if (!focusedInData || !root.querySelector('.hvy-graph-editor')) {
    root.innerHTML = renderEditorShell(ctx, config, csv);
  }
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-graph-field]').forEach((input) => {
    const field = input.dataset.graphField ?? '';
    if (field === activeField && input.dataset.rowIndex === activeRow && input.dataset.columnIndex === activeColumn) return;
    if (field === 'type' && input instanceof HTMLSelectElement) input.value = config.type;
    if (field === 'title' && input instanceof HTMLInputElement) input.value = config.title;
    if (field === 'xAxisLabel' && input instanceof HTMLInputElement) input.value = config.xAxisLabel;
    if (field === 'yAxisLabel' && input instanceof HTMLInputElement) input.value = config.yAxisLabel;
    if (field === 'legend' && input instanceof HTMLInputElement) input.checked = config.legend;
    if (field === 'csv-text' && input instanceof HTMLTextAreaElement) input.value = csv;
  });
  restoreGraphFocus(root, activeField, activeRow, activeColumn, activeSelection);
}

function renderEditorShell(_ctx: HvyPluginContext, config: GraphConfig, csv: string): string {
  return `<div class="hvy-graph-editor">
    <div class="hvy-graph-controls">
      <label><span>Type</span><select data-graph-field="type">
        ${GRAPH_TYPES.map((type) => `<option value="${type}"${config.type === type ? ' selected' : ''}>${type}</option>`).join('')}
      </select></label>
      <label><span>Title</span><input type="text" data-graph-field="title" value="${escapeAttr(config.title)}"></label>
      <label><span>X axis</span><input type="text" data-graph-field="xAxisLabel" value="${escapeAttr(config.xAxisLabel)}"></label>
      <label><span>Y axis</span><input type="text" data-graph-field="yAxisLabel" value="${escapeAttr(config.yAxisLabel)}"></label>
      <label class="hvy-graph-toggle"><input type="checkbox" data-graph-field="legend"${config.legend ? ' checked' : ''}><span>Legend</span></label>
    </div>
    <div class="hvy-graph-data-panel">
      <div class="hvy-graph-data-frame">${renderDataTable(csv)}</div>
      <div class="hvy-graph-row-actions">
        <button type="button" class="ghost" data-graph-action="add-row">Add Row</button>
        <button type="button" class="ghost" data-graph-action="add-column">Add Column</button>
      </div>
      <label><span>CSV</span><textarea class="hvy-graph-csv-textarea" data-graph-field="csv-text">${escapeHtml(csv)}</textarea></label>
    </div>
    <div data-graph-preview="true"></div>
  </div>`;
}

function renderDataTable(csv: string): string {
  const parsed = parseGraphCsv(csv.trim().length > 0 ? csv : DEFAULT_CSV);
  if (parsed.error) {
    return renderError(parsed.error);
  }
  const rows = parsed.rows.length > 0 ? parsed.rows : getEditableRows(DEFAULT_CSV);
  return `<table class="hvy-graph-data-table">
    <tbody>
      ${rows.map((row, rowIndex) => `<tr>${row.map((cell, columnIndex) => {
        const tag = rowIndex === 0 ? 'th' : 'td';
        return `<${tag}><input type="text" data-graph-field="cell" data-row-index="${rowIndex}" data-column-index="${columnIndex}" value="${escapeAttr(cell)}"></${tag}>`;
      }).join('')}</tr>`).join('')}
    </tbody>
  </table>`;
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
    : `[data-graph-field="${cssEscape(field)}"]`;
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
    if ((input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) && selection && selection.start !== null && selection.end !== null) {
      input.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
    }
  } catch {
    // Best effort.
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

export const graphPluginFactory: HvyPluginFactory = build;

export const graphPlugin: HvyPlugin = {
  id: GRAPH_PLUGIN_ID,
  displayName: 'Graph',
  documentation: {
    filename: 'about-graph.txt',
    text: graphDocumentation,
  },
  aiHint: 'Chart/graph plugin. Chart options live in pluginConfig and CSV data lives in plugin.txt.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${GRAPH_PLUGIN_ID}","pluginConfig":{"type":"bar","title":"Example"}}-->\`.`,
    'Store CSV data in the plugin body, with the first row as headers.',
    'Supported types are bar, line, pie, doughnut, scatter, bubble, radar, and polarArea.',
  ].join(' '),
  create: graphPluginFactory,
};

/** @deprecated Use graphPlugin. */
export const graphPluginRegistration = graphPlugin;
