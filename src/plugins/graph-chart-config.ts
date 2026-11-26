export const GRAPH_TYPES = ['bar', 'line', 'pie', 'doughnut', 'scatter', 'bubble', 'radar', 'polarArea'] as const;
export type GraphType = (typeof GRAPH_TYPES)[number];

export const GRAPH_SERIES_LAYOUTS = ['grouped', 'stacked', 'overlapped'] as const;
export type GraphSeriesLayout = (typeof GRAPH_SERIES_LAYOUTS)[number];

export const GRAPH_BAR_WIDTH_RANGE = { min: 0.05, max: 1 } as const;
export const GRAPH_BAR_GAP_RANGE = { min: 0, max: 0.9 } as const;

export interface GraphConfig {
  type: GraphType;
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  legend: boolean;
  seriesLayout: GraphSeriesLayout;
  /** Share of each category slot covered by that category's bars. */
  barWidth: number;
  /** Share of each grouped bar's slot left empty between neighboring bars. */
  barGap: number;
  /** Optional fixed bounds for the numeric x axis; null lets the chart fit the data. */
  xAxisMin: number | null;
  xAxisMax: number | null;
  /** Optional fixed bounds for the value (y) axis; null lets the chart fit the data. */
  yAxisMin: number | null;
  yAxisMax: number | null;
}

export const GRAPH_AXIS_BOUND_FIELDS = ['xAxisMin', 'xAxisMax', 'yAxisMin', 'yAxisMax'] as const;
export type GraphAxisBoundField = (typeof GRAPH_AXIS_BOUND_FIELDS)[number];

export interface GraphTheme {
  text: string;
  grid: string;
  axis: string;
  outline: string;
  series: string[];
}

export interface GraphChartOptionOverrides {
  legend?: boolean;
}

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  type: 'bar',
  title: '',
  xAxisLabel: '',
  yAxisLabel: '',
  legend: true,
  seriesLayout: 'grouped',
  barWidth: 0.8,
  barGap: 0.1,
  xAxisMin: null,
  xAxisMax: null,
  yAxisMin: null,
  yAxisMax: null,
};

export function readGraphConfig(raw: Record<string, unknown>): GraphConfig {
  const [xAxisMin, xAxisMax] = readAxisBounds(raw.xAxisMin, raw.xAxisMax);
  const [yAxisMin, yAxisMax] = readAxisBounds(raw.yAxisMin, raw.yAxisMax);
  return {
    type: readEnum(raw.type, GRAPH_TYPES, DEFAULT_GRAPH_CONFIG.type),
    title: typeof raw.title === 'string' ? raw.title : DEFAULT_GRAPH_CONFIG.title,
    xAxisLabel: typeof raw.xAxisLabel === 'string' ? raw.xAxisLabel : DEFAULT_GRAPH_CONFIG.xAxisLabel,
    yAxisLabel: typeof raw.yAxisLabel === 'string' ? raw.yAxisLabel : DEFAULT_GRAPH_CONFIG.yAxisLabel,
    legend: typeof raw.legend === 'boolean' ? raw.legend : DEFAULT_GRAPH_CONFIG.legend,
    seriesLayout: readEnum(raw.seriesLayout, GRAPH_SERIES_LAYOUTS, DEFAULT_GRAPH_CONFIG.seriesLayout),
    barWidth: readFraction(raw.barWidth, GRAPH_BAR_WIDTH_RANGE, DEFAULT_GRAPH_CONFIG.barWidth),
    barGap: readFraction(raw.barGap, GRAPH_BAR_GAP_RANGE, DEFAULT_GRAPH_CONFIG.barGap),
    xAxisMin,
    xAxisMax,
    yAxisMin,
    yAxisMax,
  };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A bound pair whose min is not below its max cannot describe an axis, so both are dropped. */
function readAxisBounds(rawMin: unknown, rawMax: unknown): [number | null, number | null] {
  const min = readFiniteNumber(rawMin);
  const max = readFiniteNumber(rawMax);
  return min !== null && max !== null && min >= max ? [null, null] : [min, max];
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function readFraction(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

/** Series layout applies to charts that plot several series against shared categories. */
export function graphTypeSupportsSeriesLayout(type: GraphType): boolean {
  return type === 'bar' || type === 'line';
}

function isRadialGraphType(type: GraphType): boolean {
  return type === 'pie' || type === 'doughnut' || type === 'polarArea' || type === 'radar';
}

/** Scatter and bubble charts plot numeric x values; other Cartesian types use label categories. */
export function graphTypeHasNumericXAxis(type: GraphType): boolean {
  return type === 'scatter' || type === 'bubble';
}

/** Radar and polar area plot values on one radial scale instead of a y axis. */
function graphTypeHasRadialValueScale(type: GraphType): boolean {
  return type === 'radar' || type === 'polarArea';
}

/** The yAxisMin/yAxisMax bounds apply to the value axis, whether it is a Cartesian y axis or a radial scale. */
export function graphTypeHasValueScale(type: GraphType): boolean {
  return graphTypeSupportsAxes(type) || graphTypeHasRadialValueScale(type);
}

/** Axis labels only render on Cartesian charts; radial types omit x/y scales. */
export function graphTypeSupportsAxes(type: GraphType): boolean {
  return !isRadialGraphType(type);
}

export function formatStackedTooltipTotal(items: readonly { parsed?: { y?: unknown } }[]): string {
  if (items.length <= 1) return '';
  let total = 0;
  let count = 0;
  for (const item of items) {
    const value = item.parsed?.y;
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }
  return count > 1 ? `Total: ${total.toLocaleString()}` : '';
}

export function buildGraphChartOptions(config: GraphConfig, theme: GraphTheme, overrides: GraphChartOptionOverrides = {}): Record<string, unknown> {
  const supportsSeries = graphTypeSupportsSeriesLayout(config.type);
  const stacked = supportsSeries && config.seriesLayout === 'stacked';
  return {
    responsive: true,
    maintainAspectRatio: false,
    color: theme.text,
    ...(supportsSeries ? { interaction: { mode: 'index', intersect: false } } : {}),
    plugins: {
      legend: {
        display: overrides.legend ?? config.legend,
        labels: {
          color: theme.text,
          boxWidth: 10,
          boxHeight: 10,
          padding: 10,
          usePointStyle: true,
          sort: (a: { datasetIndex?: number }, b: { datasetIndex?: number }) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),
        },
      },
      ...(supportsSeries
        ? {
            tooltip: {
              mode: 'index',
              intersect: false,
              itemSort: (a: { datasetIndex: number }, b: { datasetIndex: number }) => a.datasetIndex - b.datasetIndex,
              ...(stacked ? { callbacks: { footer: formatStackedTooltipTotal } } : {}),
            },
          }
        : {}),
      title: { color: theme.text, display: Boolean(config.title.trim()), text: config.title },
    },
    scales: buildGraphScales(config, theme, stacked),
  };
}

function buildGraphScales(config: GraphConfig, theme: GraphTheme, stacked: boolean): Record<string, unknown> {
  if (graphTypeHasRadialValueScale(config.type)) {
    return {
      r: {
        ...axisBoundOptions(config.yAxisMin, config.yAxisMax),
        grid: { color: theme.grid },
        angleLines: { color: theme.grid },
        pointLabels: { color: theme.text },
        ticks: { color: theme.text, backdropColor: theme.outline },
      },
    };
  }
  if (!graphTypeSupportsAxes(config.type)) return {};
  return {
    x: {
      stacked,
      ...(graphTypeHasNumericXAxis(config.type) ? axisBoundOptions(config.xAxisMin, config.xAxisMax) : {}),
      border: { color: theme.axis },
      grid: { color: theme.grid },
      ticks: { color: theme.text },
      title: { color: theme.text, display: Boolean(config.xAxisLabel.trim()), text: config.xAxisLabel },
    },
    y: {
      stacked,
      ...axisBoundOptions(config.yAxisMin, config.yAxisMax),
      border: { color: theme.axis },
      grid: { color: theme.grid },
      ticks: { color: theme.text },
      title: { color: theme.text, display: Boolean(config.yAxisLabel.trim()), text: config.yAxisLabel },
    },
  };
}

function axisBoundOptions(min: number | null, max: number | null): Record<string, number> {
  return {
    ...(min !== null ? { min } : {}),
    ...(max !== null ? { max } : {}),
  };
}

export function readGraphTheme(root: HTMLElement): GraphTheme {
  const computed = getComputedStyle(root);
  const read = (name: string, fallbackValue: string) => computed.getPropertyValue(name).trim() || fallbackValue;
  const text = read('--hvy-text', '#1a2530');
  return {
    text,
    grid: colorWithAlpha(text, 0.15),
    axis: colorWithAlpha(text, 0.52),
    outline: read('--hvy-surface', '#ffffff'),
    series: [
      read('--hvy-accent-1', '#2c5e78'),
      read('--hvy-danger', '#c86464'),
      read('--hvy-success', '#1c6231'),
      read('--hvy-warning', '#c79200'),
      read('--hvy-accent-2', '#325f6e'),
      read('--hvy-link-color', '#162f3d'),
      read('--hvy-focus', '#8cb0c4'),
      read('--hvy-text-muted', '#6b8fa0'),
    ],
  };
}

function datasetMeanMagnitude(dataset: unknown): number {
  const source = dataset && typeof dataset === 'object' && !Array.isArray(dataset) ? dataset as Record<string, unknown> : {};
  const values = Array.isArray(source.data) ? source.data : [];
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      sum += Math.abs(value);
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

export function styleGraphChartData(data: Record<string, unknown>, config: GraphConfig, theme: GraphTheme): Record<string, unknown> {
  const datasets = Array.isArray(data.datasets) ? data.datasets : [];
  const overlappedBar = config.type === 'bar' && config.seriesLayout === 'overlapped';
  // Chart.js draws higher `order` values behind lower ones; rank larger overlapped series behind smaller ones.
  const overlappedOrders = overlappedBar ? computeOverlappedDrawOrders(datasets) : null;
  const styledDatasets = datasets.map((dataset, index) => styleGraphDataset(dataset, index, config, theme, overlappedOrders?.[index]));
  return { ...data, datasets: styledDatasets };
}

function computeOverlappedDrawOrders(datasets: readonly unknown[]): number[] {
  const ranked = datasets
    .map((dataset, index) => ({ index, magnitude: datasetMeanMagnitude(dataset) }))
    .sort((a, b) => a.magnitude - b.magnitude || b.index - a.index);
  const orders = new Array<number>(datasets.length);
  ranked.forEach((entry, rank) => {
    orders[entry.index] = rank;
  });
  return orders;
}

function styleGraphDataset(
  dataset: unknown,
  index: number,
  config: GraphConfig,
  theme: GraphTheme,
  overlappedOrder?: number
): Record<string, unknown> {
  const { type } = config;
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
  const barFillAlpha = config.seriesLayout === 'grouped' ? 0.88 : 0.94;
  return {
    ...source,
    backgroundColor: colorWithAlpha(color, type === 'line' ? 0.16 : type === 'bar' ? barFillAlpha : 0.72),
    borderColor: type === 'bar' ? theme.outline : color,
    borderWidth: type === 'bar' ? 1.5 : 2.5,
    pointBackgroundColor: color,
    pointBorderColor: theme.outline,
    pointBorderWidth: 2,
    ...(type === 'bar' ? graphBarGeometry(config, overlappedOrder) : {}),
  };
}

function graphBarGeometry(config: GraphConfig, overlappedOrder?: number): Record<string, unknown> {
  const grouped = config.seriesLayout === 'grouped';
  return {
    categoryPercentage: config.barWidth,
    // Stacked and overlapped bars share one slot per category, so there is no neighbor to gap from.
    barPercentage: grouped ? 1 - config.barGap : 1,
    grouped: config.seriesLayout !== 'overlapped',
    ...(!grouped ? { borderSkipped: false } : {}),
    ...(overlappedOrder !== undefined ? { order: overlappedOrder } : {}),
  };
}

export function colorWithAlpha(color: string, alpha: number): string {
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
