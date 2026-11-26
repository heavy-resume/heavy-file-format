import './graph.css';

import { closeIcon } from '../icons';
import { escapeHtml } from '../utils';
import { createBuiltInPluginMetadata, GRAPH_PLUGIN_ID } from './registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from './types';
import graphDocumentation from './graph.about.txt?raw';
import { createFormRangeDragTracker } from './form-range-field/form-range-field';
import { isGraphAxisBoundField, readGraphAxisBoundInput } from './graph-axis-bounds';
import {
  buildGraphChartOptions,
  readGraphConfig,
  readGraphTheme,
  styleGraphChartData,
  type GraphConfig,
  type GraphType,
} from './graph-chart-config';
import { buildGraphChartData, DEFAULT_GRAPH_CSV, getEditableGraphRows, parseGraphCsv, serializeGraphCsv } from './graph-csv';
import { renderGraphError, syncGraphEditorShell } from './graph-editor-shell';

type ChartModule = typeof import('chart.js/auto');
type ChartInstance = InstanceType<ChartModule['Chart']>;

let chartModulePromise: Promise<ChartModule> | null = null;

function loadChartModule(): Promise<ChartModule> {
  chartModulePromise ??= import('chart.js/auto');
  return chartModulePromise;
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
    const csv = ctx.block.text.trim().length > 0 ? ctx.block.text : DEFAULT_GRAPH_CSV;
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
    const csv = ctx.block.text.trim().length > 0 ? ctx.block.text : DEFAULT_GRAPH_CSV;
    const parsed = parseGraphCsv(csv);
    if (ctx.mode === 'editor') {
      syncGraphEditorShell(root, ctx.block.schema.pluginConfig, csv, rangeDragTracker);
    }
    if (parsed.rows.length === 0) {
      destroyChart();
      clearPreviewArea(renderEmpty());
      return;
    }
    const built = buildGraphChartData(csv, config.type);
    if (built.error) {
      destroyChart();
      clearPreviewArea(renderGraphError(built.error));
      return;
    }
    const canvas = ensureChartFrame();
    if (!canvas) return;
    void drawChart(canvas, config, built.data, version).catch((error) => {
      if (version !== renderVersion) return;
      clearPreviewArea(renderGraphError(error instanceof Error ? error.message : 'Unable to render graph.'));
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
      const rows = getEditableGraphRows(ctx.block.text);
      if (!rows[rowIndex]) return;
      rows[rowIndex]![columnIndex] = readCellText(target);
      ctx.setText(serializeGraphCsv(rows));
      return;
    }
    if (field === 'legend' && target instanceof HTMLInputElement) {
      ctx.setConfig({ legend: target.checked });
      return;
    }
    if (isGraphAxisBoundField(field) && target instanceof HTMLInputElement) {
      ctx.setConfig({ [field]: readGraphAxisBoundInput(target) });
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
    const rows = getEditableGraphRows(ctx.block.text);
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
    const rows = getEditableGraphRows(ctx.block.text);
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
    'Optional numeric yAxisMin/yAxisMax fix the value axis range (the y axis, or the radial scale on radar and polarArea); xAxisMin/xAxisMax fix the x range on scatter and bubble charts. Omit a bound to fit it to the data.',
  ].join(' '),
  create: graphPluginFactory,
};

/** @deprecated Use graphPlugin. */
export const graphPluginRegistration = graphPlugin;
