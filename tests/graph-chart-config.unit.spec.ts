import { expect, test } from 'vitest';

import {
  buildGraphChartOptions,
  formatStackedTooltipTotal,
  graphTypeSupportsAxes,
  readGraphConfig,
  styleGraphChartData,
  type GraphTheme,
} from '../src/plugins/graph-chart-config';

const theme: GraphTheme = { text: '#111111', grid: '#222222', axis: '#333333', outline: '#ffffff', series: ['#aa0000', '#00aa00'] };
const twoSeriesData = { labels: ['Q1'], datasets: [{ label: 'A', data: [1] }, { label: 'B', data: [2] }] };

test('readGraphConfig defaults series layout and bar geometry', () => {
  const expectedResult = readGraphConfig({ type: 'bar' });

  expect(expectedResult).toMatchObject({ seriesLayout: 'grouped', barWidth: 0.8, barGap: 0.1 });
});

test('readGraphConfig clamps bar geometry and rejects unknown layouts', () => {
  const expectedResult = readGraphConfig({ seriesLayout: 'sideways', barWidth: 4, barGap: -1 });

  expect(expectedResult).toMatchObject({ seriesLayout: 'grouped', barWidth: 1, barGap: 0 });
});

test('grouped bars use bar width for the slot and bar gap between neighbors', () => {
  const config = readGraphConfig({ type: 'bar', seriesLayout: 'grouped', barWidth: 0.5, barGap: 0.25 });

  const expectedResult = styleGraphChartData(twoSeriesData, config, theme);

  expect(expectedResult.datasets).toEqual([
    expect.objectContaining({ categoryPercentage: 0.5, barPercentage: 0.75, grouped: true }),
    expect.objectContaining({ categoryPercentage: 0.5, barPercentage: 0.75, grouped: true }),
  ]);
});

test('overlapped bars share one ungrouped slot and ignore bar gap', () => {
  const config = readGraphConfig({ type: 'bar', seriesLayout: 'overlapped', barWidth: 0.6, barGap: 0.5 });

  const expectedResult = styleGraphChartData(twoSeriesData, config, theme);

  expect(expectedResult.datasets).toEqual([
    expect.objectContaining({ categoryPercentage: 0.6, barPercentage: 1, grouped: false }),
    expect.objectContaining({ categoryPercentage: 0.6, barPercentage: 1, grouped: false }),
  ]);
});

test('stacked layout stacks both axes for bar and line charts', () => {
  const barOptions = buildGraphChartOptions(readGraphConfig({ type: 'bar', seriesLayout: 'stacked' }), theme);
  const lineOptions = buildGraphChartOptions(readGraphConfig({ type: 'line', seriesLayout: 'stacked' }), theme);

  expect(barOptions.scales).toMatchObject({ x: { stacked: true }, y: { stacked: true } });
  expect(lineOptions.scales).toMatchObject({ x: { stacked: true }, y: { stacked: true } });
});

test('series layout is ignored by charts without shared series axes', () => {
  const expectedResult = buildGraphChartOptions(readGraphConfig({ type: 'scatter', seriesLayout: 'stacked' }), theme);

  expect(expectedResult.scales).toMatchObject({ x: { stacked: false }, y: { stacked: false } });
});

test('bar geometry only applies to bar charts', () => {
  const config = readGraphConfig({ type: 'line', barWidth: 0.3 });

  const expectedResult = styleGraphChartData(twoSeriesData, config, theme);

  expect(expectedResult.datasets).toEqual([
    expect.not.objectContaining({ categoryPercentage: expect.anything() }),
    expect.not.objectContaining({ categoryPercentage: expect.anything() }),
  ]);
});

test('graphTypeSupportsAxes distinguishes cartesian and radial graph types', () => {
  expect(graphTypeSupportsAxes('bar')).toBe(true);
  expect(graphTypeSupportsAxes('line')).toBe(true);
  expect(graphTypeSupportsAxes('scatter')).toBe(true);
  expect(graphTypeSupportsAxes('bubble')).toBe(true);
  expect(graphTypeSupportsAxes('pie')).toBe(false);
  expect(graphTypeSupportsAxes('doughnut')).toBe(false);
  expect(graphTypeSupportsAxes('radar')).toBe(false);
  expect(graphTypeSupportsAxes('polarArea')).toBe(false);
});

test('overlapped bars rank larger series behind smaller ones with crisp near-opaque fills', () => {
  const config = readGraphConfig({ type: 'bar', seriesLayout: 'overlapped' });
  const data = {
    labels: ['Day 1', 'Day 2'],
    datasets: [
      { label: 'Largest', data: [600, 700] },
      { label: 'Medium', data: [250, 300] },
      { label: 'Smallest', data: [50, 80] },
    ],
  };

  const expectedResult = styleGraphChartData(data, config, theme);
  const datasets = expectedResult.datasets as { order: number; backgroundColor: string; borderSkipped: boolean }[];

  expect(datasets.map((dataset) => dataset.order)).toEqual([2, 1, 0]);
  expect(datasets[0]?.backgroundColor).toContain('0.94');
  expect(datasets[0]?.borderSkipped).toBe(false);
});

test('bar and line charts enable column-index tooltips and stacked charts include a total footer', () => {
  const stackedOptions = buildGraphChartOptions(readGraphConfig({ type: 'bar', seriesLayout: 'stacked' }), theme) as {
    interaction?: { mode?: string; intersect?: boolean };
    plugins?: { tooltip?: { mode?: string; intersect?: boolean; callbacks?: { footer?: typeof formatStackedTooltipTotal } } };
  };
  const groupedOptions = buildGraphChartOptions(readGraphConfig({ type: 'bar', seriesLayout: 'grouped' }), theme) as {
    interaction?: { mode?: string; intersect?: boolean };
    plugins?: { tooltip?: { callbacks?: { footer?: unknown } } };
  };

  expect(stackedOptions.interaction).toEqual({ mode: 'index', intersect: false });
  expect(stackedOptions.plugins?.tooltip?.mode).toBe('index');
  expect(stackedOptions.plugins?.tooltip?.callbacks?.footer).toBe(formatStackedTooltipTotal);
  expect(groupedOptions.interaction).toEqual({ mode: 'index', intersect: false });
  expect(groupedOptions.plugins?.tooltip?.callbacks?.footer).toBeUndefined();
});

test('formatStackedTooltipTotal sums multi-series hovered values and omits single-series totals', () => {
  expect(formatStackedTooltipTotal([{ parsed: { y: 1200 } }, { parsed: { y: 3400 } }])).toBe('Total: 4,600');
  expect(formatStackedTooltipTotal([{ parsed: { y: 1200 } }])).toBe('');
});
