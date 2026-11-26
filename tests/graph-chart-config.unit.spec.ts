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

test('readGraphConfig keeps finite axis bounds and drops inverted or non-numeric ones', () => {
  const expectedResult = readGraphConfig({ xAxisMin: 5, xAxisMax: 5, yAxisMin: -10, yAxisMax: 'high' });

  expect(expectedResult).toMatchObject({ xAxisMin: null, xAxisMax: null, yAxisMin: -10, yAxisMax: null });
});

test('y axis bounds fix the value axis while categorical x axes ignore x bounds', () => {
  const expectedResult = buildGraphChartOptions(readGraphConfig({ type: 'bar', xAxisMin: 1, xAxisMax: 3, yAxisMin: 0, yAxisMax: 50 }), theme);

  expect(expectedResult.scales).toMatchObject({ y: { min: 0, max: 50 } });
  expect(expectedResult.scales).toMatchObject({ x: expect.not.objectContaining({ min: expect.anything() }) });
  expect(expectedResult.scales).toMatchObject({ x: expect.not.objectContaining({ max: expect.anything() }) });
});

test('scatter charts apply x axis bounds and leave an omitted bound to fit the data', () => {
  const expectedResult = buildGraphChartOptions(readGraphConfig({ type: 'scatter', xAxisMin: -2, xAxisMax: 8, yAxisMax: 4 }), theme);

  expect(expectedResult.scales).toMatchObject({ x: { min: -2, max: 8 }, y: { max: 4 } });
  expect(expectedResult.scales).toMatchObject({ y: expect.not.objectContaining({ min: expect.anything() }) });
});

test('radar and polar area charts apply y bounds to a themed radial scale', () => {
  const radarOptions = buildGraphChartOptions(readGraphConfig({ type: 'radar', yAxisMin: 0, yAxisMax: 30 }), theme);
  const polarOptions = buildGraphChartOptions(readGraphConfig({ type: 'polarArea', yAxisMax: 12 }), theme);

  expect(radarOptions.scales).toEqual({
    r: {
      min: 0,
      max: 30,
      grid: { color: '#222222' },
      angleLines: { color: '#222222' },
      pointLabels: { color: '#111111' },
      ticks: { color: '#111111', backdropColor: '#ffffff' },
    },
  });
  expect(polarOptions.scales).toMatchObject({ r: { max: 12 } });
});

test('pie and doughnut charts have no value scale to bound', () => {
  const expectedResult = buildGraphChartOptions(readGraphConfig({ type: 'doughnut', yAxisMin: 0, yAxisMax: 30 }), theme);

  expect(expectedResult.scales).toEqual({});
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
