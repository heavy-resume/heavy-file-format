import '../editor/components/table/table.css';
import './graph.css';

import { plusIcon, closeIcon } from '../icons';
import { GRAPH_PLUGIN_ID } from './registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from './types';
import graphDocumentation from './graph.about.txt?raw';

export const GRAPH_TYPES = ['bar', 'line', 'pie', 'doughnut', 'scatter', 'bubble', 'radar', 'polarArea'] as const;
export type GraphType = (typeof GRAPH_TYPES)[number];
export const GRAPH_COLOR_SCHEMES = ['auto', 'light', 'dark'] as const;
export type GraphColorScheme = (typeof GRAPH_COLOR_SCHEMES)[number];

interface GraphConfig {
  type: GraphType;
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  legend: boolean;
  colorScheme: GraphColorScheme;
}

interface GraphTheme {
  text: string;
  grid: string;
  axis: string;
  outline: string;
  series: string[];
}

interface GraphChartOptionOverrides {
  legend?: boolean;
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
  colorScheme: 'auto',
};

const GRAPH_LIGHT_THEME: GraphTheme = {
  text: '#1a2530',
  grid: 'rgba(26, 37, 48, 0.14)',
  axis: 'rgba(26, 37, 48, 0.52)',
  outline: '#ffffff',
  series: ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#f59e0b', '#0891b2', '#db2777', '#64748b'],
};

const GRAPH_DARK_THEME: GraphTheme = {
  text: '#e7eef5',
  grid: 'rgba(231, 238, 245, 0.16)',
  axis: 'rgba(231, 238, 245, 0.55)',
  outline: '#0f1720',
  series: ['#60a5fa', '#fb7185', '#4ade80', '#c084fc', '#fbbf24', '#22d3ee', '#f472b6', '#94a3b8'],
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
    colorScheme: GRAPH_COLOR_SCHEMES.includes(raw.colorScheme as GraphColorScheme) ? raw.colorScheme as GraphColorScheme : DEFAULT_CONFIG.colorScheme,
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

function renderChartOptions(config: GraphConfig, theme: GraphTheme, overrides: GraphChartOptionOverrides = {}): Record<string, unknown> {
  const axisScales = config.type === 'pie' || config.type === 'doughnut' || config.type === 'polarArea' || config.type === 'radar'
    ? {}
    : {
        x: {
          border: { color: theme.axis },
          grid: { color: theme.grid },
          ticks: { color: theme.text },
          title: { color: theme.text, display: Boolean(config.xAxisLabel.trim()), text: config.xAxisLabel },
        },
        y: {
          border: { color: theme.axis },
          grid: { color: theme.grid },
          ticks: { color: theme.text },
          title: { color: theme.text, display: Boolean(config.yAxisLabel.trim()), text: config.yAxisLabel },
        },
      };
  return {
    responsive: true,
    maintainAspectRatio: false,
    color: theme.text,
    plugins: {
      legend: {
        display: overrides.legend ?? config.legend,
        labels: {
          color: theme.text,
          boxWidth: 10,
          boxHeight: 10,
          padding: 10,
          usePointStyle: true,
        },
      },
      title: { color: theme.text, display: Boolean(config.title.trim()), text: config.title },
    },
    scales: axisScales,
  };
}

export function shouldCollapseInlineGraphLegend(width: number, height: number, datasetCount: number): boolean {
  return datasetCount >= 4 && (width < 720 || height < 340);
}

function syncExternalGraphLegend(canvas: HTMLCanvasElement, data: Record<string, unknown>, visible: boolean): void {
  const frame = canvas.closest<HTMLElement>('.hvy-graph-frame');
  if (!frame) return;
  let legend = frame.nextElementSibling instanceof HTMLElement && frame.nextElementSibling.classList.contains('hvy-graph-external-legend')
    ? frame.nextElementSibling
    : null;
  if (!visible) {
    legend?.setAttribute('hidden', '');
    return;
  }
  if (!legend) {
    legend = document.createElement('div');
    legend.className = 'hvy-graph-external-legend';
    frame.insertAdjacentElement('afterend', legend);
  }
  legend.removeAttribute('hidden');
  legend.replaceChildren();
  const datasets = Array.isArray(data.datasets) ? data.datasets : [];
  datasets.forEach((dataset) => {
    const source = dataset && typeof dataset === 'object' && !Array.isArray(dataset) ? dataset as Record<string, unknown> : {};
    const item = document.createElement('span');
    item.className = 'hvy-graph-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'hvy-graph-legend-swatch';
    swatch.style.setProperty('--hvy-graph-legend-color', readLegendColor(source));
    const label = document.createElement('span');
    label.className = 'hvy-graph-legend-label';
    label.textContent = typeof source.label === 'string' && source.label.trim() ? source.label : 'Series';
    item.append(swatch, label);
    legend.appendChild(item);
  });
}

function readLegendColor(dataset: Record<string, unknown>): string {
  const borderColor = dataset.borderColor;
  if (typeof borderColor === 'string') return borderColor;
  const backgroundColor = dataset.backgroundColor;
  if (typeof backgroundColor === 'string') return backgroundColor;
  if (Array.isArray(backgroundColor) && typeof backgroundColor[0] === 'string') return backgroundColor[0];
  return 'var(--hvy-accent-1)';
}

function readGraphTheme(root: HTMLElement, config: GraphConfig): GraphTheme {
  if (config.colorScheme === 'light') return GRAPH_LIGHT_THEME;
  if (config.colorScheme === 'dark') return GRAPH_DARK_THEME;
  const computed = getComputedStyle(root);
  const fallback = computed.colorScheme.includes('dark') ? GRAPH_DARK_THEME : GRAPH_LIGHT_THEME;
  const read = (name: string, fallbackValue: string) => computed.getPropertyValue(name).trim() || fallbackValue;
  return {
    text: read('--hvy-graph-text', fallback.text),
    grid: read('--hvy-graph-grid', fallback.grid),
    axis: read('--hvy-graph-axis', fallback.axis),
    outline: read('--hvy-graph-outline', fallback.outline),
    series: fallback.series.map((color, index) => read(`--hvy-graph-series-${index + 1}`, color)),
  };
}

function styleGraphChartData(data: Record<string, unknown>, type: GraphType, theme: GraphTheme): Record<string, unknown> {
  const datasets = Array.isArray(data.datasets) ? data.datasets : [];
  const styledDatasets = datasets.map((dataset, index) => styleGraphDataset(dataset, index, type, theme));
  return { ...data, datasets: styledDatasets };
}

function styleGraphDataset(dataset: unknown, index: number, type: GraphType, theme: GraphTheme): Record<string, unknown> {
  const source = dataset && typeof dataset === 'object' && !Array.isArray(dataset) ? dataset as Record<string, unknown> : {};
  const color = theme.series[index % theme.series.length] ?? theme.series[0] ?? '#2563eb';
  if (type === 'pie' || type === 'doughnut' || type === 'polarArea') {
    const count = Array.isArray(source.data) ? source.data.length : theme.series.length;
    return {
      ...source,
      backgroundColor: Array.from({ length: count }, (_value, itemIndex) => colorWithAlpha(theme.series[itemIndex % theme.series.length] ?? color, 0.78)),
      borderColor: theme.outline,
      borderWidth: 2,
      hoverBorderColor: theme.outline,
      hoverBorderWidth: 3,
    };
  }
  return {
    ...source,
    backgroundColor: colorWithAlpha(color, type === 'line' ? 0.16 : 0.72),
    borderColor: type === 'bar' ? theme.outline : color,
    borderWidth: type === 'bar' ? 2 : 2.5,
    pointBackgroundColor: color,
    pointBorderColor: theme.outline,
    pointBorderWidth: 2,
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1]!.length === 3
      ? hex[1]!.split('').map((char) => `${char}${char}`).join('')
      : hex[1]!;
    const numeric = Number.parseInt(raw, 16);
    return `rgba(${(numeric >> 16) & 255}, ${(numeric >> 8) & 255}, ${numeric & 255}, ${alpha})`;
  }
  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1]!.split(',').map((part) => part.trim()).slice(0, 3);
    if (parts.length === 3) {
      return `rgba(${parts.join(', ')}, ${alpha})`;
    }
  }
  return trimmed;
}

function renderChartFrame(): string {
  return '<div class="hvy-graph-frame"><canvas></canvas></div>';
}

function renderExpandedChartFrame(config: GraphConfig): string {
  const title = config.title.trim() || 'Graph';
  return `<div class="modal-root hvy-graph-expanded-modal-root">
    <div class="modal-overlay" data-graph-expanded-action="close"></div>
    <section class="modal-panel hvy-graph-expanded-modal" role="dialog" aria-modal="true" aria-labelledby="hvyGraphExpandedTitle">
      <div class="hvy-graph-expanded-head">
        <h3 id="hvyGraphExpandedTitle">${escapeHtml(title)}</h3>
        <button type="button" class="ghost hvy-graph-expanded-close" data-graph-expanded-action="close" aria-label="Close graph">${closeIcon()}</button>
      </div>
      ${renderChartFrame()}
    </section>
  </div>`;
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
  let expandedChart: ChartInstance | null = null;
  let chartType: GraphType | null = null;
  let renderVersion = 0;
  let expandedKeydownListener: ((event: KeyboardEvent) => void) | null = null;

  const destroyChart = () => {
    chart?.destroy();
    chart = null;
    chartType = null;
  };

  const destroyExpandedChart = () => {
    expandedChart?.destroy();
    expandedChart = null;
    if (expandedKeydownListener) {
      document.removeEventListener('keydown', expandedKeydownListener);
      expandedKeydownListener = null;
    }
    document.querySelector('.hvy-graph-expanded-modal-root')?.remove();
  };

  const ensureChartFrame = (): HTMLCanvasElement | null => {
    const host = ctx.mode === 'reader' ? root : root.querySelector<HTMLElement>('[data-graph-preview="true"]');
    if (!host) return null;
    let canvas = host.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas || !host.querySelector('.hvy-graph-frame')) {
      host.innerHTML = renderChartFrame();
      canvas = host.querySelector<HTMLCanvasElement>('canvas');
    }
    return canvas;
  };

  const clearPreviewArea = (replacement: string) => {
    if (ctx.mode === 'reader') {
      root.innerHTML = replacement;
      return;
    }
    const host = root.querySelector<HTMLElement>('[data-graph-preview="true"]');
    if (host) host.innerHTML = replacement;
  };

  const drawChart = async (canvas: HTMLCanvasElement, config: GraphConfig, builtData: Record<string, unknown>, version: number) => {
    const module = await loadChartModule();
    if (version !== renderVersion) return;
    if (!canvas.isConnected) {
      // Re-look up the live canvas in case the DOM was reattached / replaced.
      const live = ctx.mode === 'reader'
        ? root.querySelector<HTMLCanvasElement>('canvas')
        : root.querySelector<HTMLCanvasElement>('[data-graph-preview="true"] canvas');
      if (!live) return;
      canvas = live;
    }
    const theme = readGraphTheme(root, config);
    const styledData = styleGraphChartData(builtData, config.type, theme);
    const frameRect = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
    const datasetCount = Array.isArray(builtData.datasets) ? builtData.datasets.length : 0;
    const useExternalLegend = config.legend && shouldCollapseInlineGraphLegend(frameRect.width, frameRect.height, datasetCount);
    const options = renderChartOptions(config, theme, {
      legend: config.legend && !useExternalLegend,
    });
    if (chart && chart.canvas === canvas && chartType === config.type) {
      chart.data = styledData as never;
      chart.options = options as never;
      chart.update();
      syncExternalGraphLegend(canvas, styledData, useExternalLegend);
      return;
    }
    destroyChart();
    chart = new module.Chart(canvas, {
      type: config.type,
      data: styledData as never,
      options,
    });
    syncExternalGraphLegend(canvas, styledData, useExternalLegend);
    chartType = config.type;
  };

  const drawExpandedChart = async (
    canvas: HTMLCanvasElement,
    config: GraphConfig,
    builtData: Record<string, unknown>,
  ) => {
    const module = await loadChartModule();
    if (!canvas.isConnected) return;
    const theme = readGraphTheme(root, config);
    expandedChart?.destroy();
    expandedChart = new module.Chart(canvas, {
      type: config.type,
      data: styleGraphChartData(builtData, config.type, theme) as never,
      options: renderChartOptions(config, theme),
    });
  };

  const openExpandedChart = (frame: HTMLElement) => {
    if (ctx.mode !== 'reader' || !shouldOpenExpandedChart(frame)) return;
    const config = readConfig(ctx.block.schema.pluginConfig);
    const csv = ctx.block.text.trim().length > 0 ? ctx.block.text : DEFAULT_CSV;
    const built = buildGraphChartData(csv, config.type);
    if (built.error) return;
    destroyExpandedChart();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderExpandedChartFrame(config);
    const modal = wrapper.firstElementChild as HTMLElement | null;
    if (!modal) return;
    const closeExpandedChart = () => {
      destroyExpandedChart();
    };
    modal.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-graph-expanded-action]');
      if (!action) return;
      event.preventDefault();
      closeExpandedChart();
    });
    expandedKeydownListener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !modal.isConnected) return;
      event.preventDefault();
      closeExpandedChart();
    };
    const mount = root.closest<HTMLElement>('.viewer-shell, .editor-shell') ?? root.closest<HTMLElement>('.hvy-embed-layout') ?? root;
    configureExpandedChartModal(modal, mount);
    document.addEventListener('keydown', expandedKeydownListener);
    mount.appendChild(modal);
    modal.querySelector<HTMLButtonElement>('[data-graph-expanded-action="close"]')?.focus();
    const canvas = modal.querySelector<HTMLCanvasElement>('canvas');
    if (canvas) {
      void drawExpandedChart(canvas, config, built.data).catch(() => {
        destroyExpandedChart();
      });
    }
  };

  const renderPreview = () => {
    const version = ++renderVersion;
    const config = readConfig(ctx.block.schema.pluginConfig);
    const csv = ctx.block.text.trim().length > 0 ? ctx.block.text : DEFAULT_CSV;
    const parsed = parseGraphCsv(csv);
    if (ctx.mode === 'editor') {
      syncEditorShell(ctx, root, config, csv);
    }
    if (parsed.rows.length === 0) {
      destroyChart();
      clearPreviewArea(renderEmpty());
      return;
    }
    const built = buildGraphChartData(csv, config.type);
    if (built.error) {
      destroyChart();
      clearPreviewArea(renderError(built.error));
      return;
    }
    const canvas = ensureChartFrame();
    if (!canvas) return;
    void drawChart(canvas, config, built.data, version).catch((error) => {
      if (version !== renderVersion) return;
      clearPreviewArea(renderError(error instanceof Error ? error.message : 'Unable to render graph.'));
    });
  };

  const readCellText = (element: HTMLElement): string => {
    return (element.textContent ?? '').replace(/[\r\n]+/g, ' ');
  };

  const onInput = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const field = target.dataset.graphField;
    if (!field) return;
    if (field === 'cell' || field === 'column') {
      const rowIndex = field === 'column' ? 0 : Number(target.dataset.rowIndex);
      const columnIndex = Number(target.dataset.columnIndex);
      const rows = getEditableRows(ctx.block.text);
      if (!rows[rowIndex]) return;
      rows[rowIndex]![columnIndex] = readCellText(target);
      ctx.setText(serializeGraphCsv(rows));
      return;
    }
    if (field === 'legend' && target instanceof HTMLInputElement) {
      ctx.setConfig({ legend: target.checked });
      return;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
      ctx.setConfig({ [field]: target.value });
    }
  };

  const onClick = (event: Event) => {
    if (ctx.mode === 'reader') {
      const frame = (event.target as HTMLElement | null)?.closest<HTMLElement>('.hvy-graph-frame');
      if (frame && root.contains(frame)) {
        openExpandedChart(frame);
      }
      return;
    }
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-graph-action]');
    if (!button) return;
    const action = button.dataset.graphAction;
    const rows = getEditableRows(ctx.block.text);
    if (action === 'add-row') {
      const width = rows[0]?.length || 2;
      rows.push(Array.from({ length: width }, () => ''));
      ctx.setText(serializeGraphCsv(rows));
      return;
    }
    if (action === 'add-column') {
      rows.forEach((row, index) => row.push(index === 0 ? `Series ${row.length}` : ''));
      ctx.setText(serializeGraphCsv(rows));
      return;
    }
    if (action === 'remove-row') {
      const rowIndex = Number(button.dataset.rowIndex);
      if (!Number.isFinite(rowIndex) || rowIndex < 1 || rowIndex >= rows.length) return;
      rows.splice(rowIndex, 1);
      ctx.setText(serializeGraphCsv(rows));
      return;
    }
    if (action === 'remove-column') {
      const columnIndex = Number(button.dataset.columnIndex);
      const width = rows[0]?.length ?? 0;
      if (!Number.isFinite(columnIndex) || columnIndex < 0 || columnIndex >= width || width <= 1) return;
      rows.forEach((row) => row.splice(columnIndex, 1));
      ctx.setText(serializeGraphCsv(rows));
      return;
    }
  };

  let dragKind: 'row' | 'column' | null = null;
  let dragIndex: number | null = null;

  const onDragStart = (event: DragEvent) => {
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-graph-drag]');
    if (!handle || !event.dataTransfer) return;
    const kind = handle.dataset.graphDrag === 'row' ? 'row' : handle.dataset.graphDrag === 'column' ? 'column' : null;
    if (!kind) return;
    const indexAttr = kind === 'row' ? handle.dataset.rowIndex : handle.dataset.columnIndex;
    const index = Number(indexAttr);
    if (!Number.isFinite(index)) return;
    dragKind = kind;
    dragIndex = index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `graph:${kind}:${index}`);
  };

  const onDragOver = (event: DragEvent) => {
    if (!dragKind || dragIndex === null) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const dropAttr = dragKind === 'row' ? 'data-graph-row-drop' : 'data-graph-column-drop';
    if (target.closest(`[${dropAttr}]`)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }
  };

  const onDrop = (event: DragEvent) => {
    if (!dragKind || dragIndex === null) return;
    const target = event.target as HTMLElement | null;
    if (!target) {
      dragKind = null;
      dragIndex = null;
      return;
    }
    const rows = getEditableRows(ctx.block.text);
    if (dragKind === 'row') {
      const dropCell = target.closest<HTMLElement>('[data-graph-row-drop]');
      if (!dropCell) {
        dragKind = null;
        dragIndex = null;
        return;
      }
      event.preventDefault();
      const targetIndex = Number(dropCell.dataset.rowIndex);
      const from = dragIndex;
      if (Number.isFinite(targetIndex) && from >= 1 && targetIndex >= 1 && from < rows.length && targetIndex < rows.length && from !== targetIndex) {
        const moved = rows.splice(from, 1)[0];
        if (moved) rows.splice(targetIndex, 0, moved);
        ctx.setText(serializeGraphCsv(rows));
      }
    } else {
      const dropCell = target.closest<HTMLElement>('[data-graph-column-drop]');
      if (!dropCell) {
        dragKind = null;
        dragIndex = null;
        return;
      }
      event.preventDefault();
      const targetIndex = Number(dropCell.dataset.columnIndex);
      const from = dragIndex;
      const width = rows[0]?.length ?? 0;
      if (Number.isFinite(targetIndex) && from >= 0 && targetIndex >= 0 && from < width && targetIndex < width && from !== targetIndex) {
        rows.forEach((row) => {
          const moved = row.splice(from, 1)[0] ?? '';
          row.splice(targetIndex, 0, moved);
        });
        ctx.setText(serializeGraphCsv(rows));
      }
    }
    dragKind = null;
    dragIndex = null;
  };

  if (ctx.mode === 'editor') {
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    root.addEventListener('click', onClick);
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
  } else {
    root.addEventListener('click', onClick);
  }

  renderPreview();
  return {
    element: root,
    refresh: renderPreview,
    unmount: () => {
      destroyChart();
      destroyExpandedChart();
      if (ctx.mode === 'editor') {
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onInput);
        root.removeEventListener('click', onClick);
        root.removeEventListener('dragstart', onDragStart);
        root.removeEventListener('dragover', onDragOver);
        root.removeEventListener('drop', onDrop);
      } else {
        root.removeEventListener('click', onClick);
      }
    },
  };
}

function shouldOpenExpandedChart(frame: HTMLElement): boolean {
  const width = frame.getBoundingClientRect().width;
  return width <= 560 || (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
}

function configureExpandedChartModal(modal: HTMLElement, mount: HTMLElement): void {
  const mountRect = mount.getBoundingClientRect();
  const shouldRotate = mountRect.width <= 560 && mountRect.height > mountRect.width;
  if (!shouldRotate) return;
  const edgeInset = 16;
  modal.classList.add('is-rotated');
  modal.style.setProperty('--hvy-graph-expanded-rotated-width', `${Math.max(0, mountRect.height - edgeInset)}px`);
  modal.style.setProperty('--hvy-graph-expanded-rotated-height', `${Math.max(0, mountRect.width - edgeInset)}px`);
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
  const inRoot = active instanceof HTMLElement && root.contains(active);
  const activeField = inRoot ? active.dataset.graphField ?? '' : '';
  const activeRow = inRoot ? active.dataset.rowIndex ?? '' : '';
  const activeColumn = inRoot ? active.dataset.columnIndex ?? '' : '';
  const activeSelection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
    : null;
  const focusedInTable = activeField === 'cell' || activeField === 'column';
  const focusedInData = focusedInTable;
  if (!focusedInData || !root.querySelector('.hvy-graph-editor')) {
    root.innerHTML = renderEditorShell(ctx, config, csv);
  } else if (!focusedInTable) {
    const panel = root.querySelector<HTMLElement>('.hvy-graph-data-panel');
    if (panel) {
      const tableHtml = renderDataTable(csv, activeField, activeRow, activeColumn);
      const existingTable = panel.querySelector<HTMLElement>('.table-editor');
      if (existingTable) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = tableHtml;
        const next = wrapper.firstElementChild;
        if (next) existingTable.replaceWith(next);
      }
    }
  }
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input[data-graph-field], select[data-graph-field], textarea[data-graph-field]').forEach((input) => {
    const field = input.dataset.graphField ?? '';
    if (field === 'type' && input instanceof HTMLSelectElement) input.value = config.type;
    if (field === 'colorScheme' && input instanceof HTMLSelectElement) input.value = config.colorScheme;
    if (field === 'title' && input instanceof HTMLInputElement) input.value = config.title;
    if (field === 'xAxisLabel' && input instanceof HTMLInputElement) input.value = config.xAxisLabel;
    if (field === 'yAxisLabel' && input instanceof HTMLInputElement) input.value = config.yAxisLabel;
    if (field === 'legend' && input instanceof HTMLInputElement) input.checked = config.legend;
  });
  restoreGraphFocus(root, activeField, activeRow, activeColumn, activeSelection);
}

function renderEditorShell(_ctx: HvyPluginContext, config: GraphConfig, csv: string): string {
  return `<div class="hvy-graph-editor" data-editor-activation-autofocus="false">
    <div class="hvy-graph-controls">
      <label><span>Type</span><select data-graph-field="type">
        ${GRAPH_TYPES.map((type) => `<option value="${type}"${config.type === type ? ' selected' : ''}>${type}</option>`).join('')}
      </select></label>
      <label><span>Colors</span><select data-graph-field="colorScheme">
        ${GRAPH_COLOR_SCHEMES.map((scheme) => `<option value="${scheme}"${config.colorScheme === scheme ? ' selected' : ''}>${scheme}</option>`).join('')}
      </select></label>
      <label><span>Title</span><input type="text" data-graph-field="title" value="${escapeAttr(config.title)}"></label>
      <label><span>X axis</span><input type="text" data-graph-field="xAxisLabel" value="${escapeAttr(config.xAxisLabel)}"></label>
      <label><span>Y axis</span><input type="text" data-graph-field="yAxisLabel" value="${escapeAttr(config.yAxisLabel)}"></label>
      <label class="hvy-graph-toggle"><input type="checkbox" data-graph-field="legend"${config.legend ? ' checked' : ''}><span>Legend</span></label>
    </div>
    <div class="hvy-graph-data-panel">
      ${renderDataTable(csv, '', '', '')}
    </div>
    <div data-graph-preview="true"></div>
  </div>`;
}

function renderDataTable(csv: string, _activeField: string, _activeRow: string, _activeColumn: string): string {
  const parsed = parseGraphCsv(csv.trim().length > 0 ? csv : DEFAULT_CSV);
  if (parsed.error) {
    return `<div class="table-editor"><div class="table-editor-frame">${renderError(parsed.error)}</div></div>`;
  }
  const rows = parsed.rows.length > 0 ? parsed.rows : getEditableRows(DEFAULT_CSV);
  const [headers = [], ...bodyRows] = rows;
  const columnCount = Math.max(headers.length, 1);
  const canRemoveColumn = headers.length > 1;

  const renderHeaderCell = (cell: string, columnIndex: number) => {
    return `<th data-graph-column-drop="true" data-column-index="${columnIndex}">
      <div class="table-column-head">
        <button
          type="button"
          class="table-drag-handle"
          draggable="true"
          data-graph-drag="column"
          data-column-index="${columnIndex}"
          title="Drag to reorder column"
        >::</button>
        <div class="table-inline-edit-shell">
          <div
            class="inline-editable table-inline-text table-column-name"
            contenteditable="true"
            spellcheck="false"
            data-graph-field="column"
            data-column-index="${columnIndex}"
            data-placeholder="Column ${columnIndex + 1}"
          >${escapeHtml(cell)}</div>
        </div>
        ${canRemoveColumn
          ? `<button type="button" class="danger remove-x" data-graph-action="remove-column" data-column-index="${columnIndex}" title="Remove column">${closeIcon()}</button>`
          : ''}
      </div>
    </th>`;
  };

  const renderBodyRow = (row: string[], rowOffset: number) => {
    const rowIndex = rowOffset + 1;
    return `<tr class="table-row-editor table-row-editor-main" data-graph-row-drop="true" data-row-index="${rowIndex}">
      <td class="table-row-utility">
        <button
          type="button"
          class="table-drag-handle"
          draggable="true"
          data-graph-drag="row"
          data-row-index="${rowIndex}"
          title="Drag to reorder row"
        >::</button>
      </td>
      ${headers.map((_header, columnIndex) => {
        const value = row[columnIndex] ?? '';
        const placeholder = headers[columnIndex] || 'Cell value';
        return `<td>
          <div class="table-inline-edit-shell">
            <div
              class="inline-editable table-inline-text"
              contenteditable="true"
              spellcheck="false"
              data-graph-field="cell"
              data-row-index="${rowIndex}"
              data-column-index="${columnIndex}"
              data-placeholder="${escapeAttr(placeholder)}"
            >${escapeHtml(value)}</div>
          </div>
        </td>`;
      }).join('')}
      <td class="table-row-utility table-row-remove-cell">
        <button type="button" class="danger remove-x" data-graph-action="remove-row" data-row-index="${rowIndex}" title="Remove row">${closeIcon()}</button>
      </td>
    </tr>`;
  };

  return `<div class="table-editor">
    <div class="table-editor-frame">
      <table class="table-editor-grid" style="--hvy-table-editor-columns: ${columnCount};">
        <thead>
          <tr>
            <th class="table-utility-cell"></th>
            ${headers.map((cell, columnIndex) => renderHeaderCell(cell, columnIndex)).join('')}
            <th class="table-add-column-cell">
              <button type="button" class="ghost table-add-button" data-graph-action="add-column" title="Add column" aria-label="Add column">${plusIcon()}</button>
            </th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows.map((row, rowOffset) => renderBodyRow(row, rowOffset)).join('')}
          <tr class="table-add-row-line">
            <td colspan="${columnCount + 2}">
              <button type="button" class="ghost" data-graph-action="add-row">${plusIcon()} Add Row</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`;
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
