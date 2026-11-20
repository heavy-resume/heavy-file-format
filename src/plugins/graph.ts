import './graph.css';

import { chevronDownIcon, closeIcon } from '../icons';
import { renderTableEditorFrame, renderTableEditorGrid } from '../editor/components/table/table-editor-grid';
import { createBuiltInPluginMetadata, GRAPH_PLUGIN_ID } from './registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from './types';
import graphDocumentation from './graph.about.txt?raw';
import { createFormRangeControl, createFormRangeDragTracker, type FormRangeDragTracker } from './form-range-field/form-range-field';
import {
  GRAPH_BAR_GAP_RANGE,
  GRAPH_BAR_WIDTH_RANGE,
  GRAPH_SERIES_LAYOUTS,
  GRAPH_TYPES,
  buildGraphChartOptions,
  graphTypeSupportsAxes,
  graphTypeSupportsSeriesLayout,
  readGraphConfig,
  readGraphTheme,
  styleGraphChartData,
  type GraphConfig,
  type GraphSeriesLayout,
  type GraphType,
} from './graph-chart-config';

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

let chartModulePromise: Promise<ChartModule> | null = null;

function loadChartModule(): Promise<ChartModule> {
  chartModulePromise ??= import('chart.js/auto');
  return chartModulePromise;
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

// Remounts (view switches, undo, full rerenders) create a fresh chart for a graph the reader
// has already watched animate in; those draw at rest instead of replaying the entrance.
const animatedGraphKeys = new Set<string>();

// Draws overlapped bar elements tallest-first per column so shorter series stay visible in front even when series cross.
const overlappedBarDrawOrderPlugin = {
  id: 'hvyOverlappedBarDrawOrder',
  beforeDatasetsDraw(chart: ChartInstance): boolean | void {
    const configType = (chart.config as { type?: string }).type;
    if (configType !== 'bar') return;
    const datasets = chart.data.datasets as { grouped?: boolean }[];
    if (datasets.length < 2 || !datasets.some((dataset) => dataset.grouped === false)) return;
    const entries: { element: { draw(ctx: CanvasRenderingContext2D): void }; height: number; datasetIndex: number }[] = [];
    datasets.forEach((_dataset, datasetIndex) => {
      if (!chart.isDatasetVisible(datasetIndex)) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      meta.data.forEach((rawElement) => {
        const element = rawElement as unknown as { draw(ctx: CanvasRenderingContext2D): void; y?: number; base?: number; skip?: boolean };
        if (element.skip) return;
        const height = typeof element.y === 'number' && typeof element.base === 'number' ? Math.abs(element.base - element.y) : 0;
        entries.push({ element, height, datasetIndex });
      });
    });
    entries.sort((a, b) => b.height - a.height || a.datasetIndex - b.datasetIndex);
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
    ctx.clip();
    entries.forEach(({ element }) => element.draw(ctx));
    ctx.restore();
    return false;
  },
};

function graphAnimationKey(ctx: HvyPluginContext): string {
  return `${ctx.sectionKey}\u0000${ctx.block.id}`;
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-graph hvy-graph-${ctx.mode}`;
  let chart: ChartInstance | null = null;
  let expandedChart: ChartInstance | null = null;
  let chartType: GraphType | null = null;
  let chartSignature = '';
  let renderVersion = 0;
  const rangeDragTracker = createFormRangeDragTracker();
  let expandedKeydownListener: ((event: KeyboardEvent) => void) | null = null;

  const destroyChart = () => {
    chart?.destroy();
    chart = null;
    chartType = null;
    chartSignature = '';
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
    const theme = readGraphTheme(root);
    const styledData = styleGraphChartData(builtData, config, theme);
    const frameRect = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
    const datasetCount = Array.isArray(builtData.datasets) ? builtData.datasets.length : 0;
    const useExternalLegend = config.legend && shouldCollapseInlineGraphLegend(frameRect.width, frameRect.height, datasetCount);
    const options = buildGraphChartOptions(config, theme, {
      legend: config.legend && !useExternalLegend,
    });
    const signature = JSON.stringify([config, styledData, options]);
    if (chart && chart.canvas === canvas && chartType === config.type) {
      if (signature === chartSignature) return;
      chart.data = styledData as never;
      chart.options = options as never;
      // Edits and redraws show the new state directly; only a graph's first appearance animates.
      chart.update('none');
      chartSignature = signature;
      syncExternalGraphLegend(canvas, styledData, useExternalLegend);
      return;
    }
    destroyChart();
    const animationKey = graphAnimationKey(ctx);
    const animate = !animatedGraphKeys.has(animationKey);
    animatedGraphKeys.add(animationKey);
    chart = new module.Chart(canvas, {
      type: config.type,
      data: styledData as never,
      options: animate ? options : { ...options, animation: false },
      plugins: [overlappedBarDrawOrderPlugin],
    });
    chartSignature = signature;
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
    const theme = readGraphTheme(root);
    expandedChart?.destroy();
    expandedChart = new module.Chart(canvas, {
      type: config.type,
      data: styleGraphChartData(builtData, config, theme) as never,
      options: buildGraphChartOptions(config, theme),
      plugins: [overlappedBarDrawOrderPlugin],
    });
  };

  const openExpandedChart = (frame: HTMLElement) => {
    if (ctx.mode !== 'reader' || !shouldOpenExpandedChart(frame)) return;
    const config = readGraphConfig(ctx.block.schema.pluginConfig);
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
    const config = readGraphConfig(ctx.block.schema.pluginConfig);
    const csv = ctx.block.text.trim().length > 0 ? ctx.block.text : DEFAULT_CSV;
    const parsed = parseGraphCsv(csv);
    if (ctx.mode === 'editor') {
      syncEditorShell(root, config, csv, rangeDragTracker);
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
    if (target instanceof HTMLInputElement && target.type === 'range') {
      ctx.setConfig({ [field]: Number(target.value) / 100 });
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
      rangeDragTracker.dispose();
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

function syncEditorShell(root: HTMLElement, config: GraphConfig, csv: string, rangeDragTracker: FormRangeDragTracker): void {
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
    root.innerHTML = renderEditorShell(config, csv);
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

function renderEditorShell(config: GraphConfig, csv: string): string {
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
    </div>
    <div data-graph-preview="true"></div>
    <div class="hvy-graph-data-panel">
      ${renderDataTable(csv)}
    </div>
  </div>`;
}

function renderDataTable(csv: string): string {
  const parsed = parseGraphCsv(csv.trim().length > 0 ? csv : DEFAULT_CSV);
  if (parsed.error) {
    return renderTableEditorFrame(renderError(parsed.error));
  }
  const rows = parsed.rows.length > 0 ? parsed.rows : getEditableRows(DEFAULT_CSV);
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

export const graphPluginFactory: HvyPluginFactory = build;

export const graphPlugin: HvyPlugin = {
  ...createBuiltInPluginMetadata(GRAPH_PLUGIN_ID),
  displayName: 'Graph',
  mount: { placeholderHeight: '360px' },
  documentation: {
    filename: 'about-graph.txt',
    text: graphDocumentation,
  },
  aiHint: 'Chart/graph plugin. Chart options live in pluginConfig and CSV data lives in plugin.txt.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${GRAPH_PLUGIN_ID}","pluginConfig":{"type":"bar","title":"Example"}}-->\`.`,
    'Store CSV data in the plugin body, with the first row as headers.',
    'Supported types are bar, line, pie, doughnut, scatter, bubble, radar, and polarArea.',
    'Bar and line charts accept seriesLayout grouped, stacked, or overlapped; bar charts accept barWidth (0.05-1) and barGap (0-0.9) fractions.',
  ].join(' '),
  create: graphPluginFactory,
};

/** @deprecated Use graphPlugin. */
export const graphPluginRegistration = graphPlugin;
