import { expect, test } from 'vitest';

import { buildGraphChartData, parseGraphCsv, shouldCollapseInlineGraphLegend } from '../src/plugins/graph';

test('parseGraphCsv handles quoted cells and consistent rows', () => {
  const expectedResult = parseGraphCsv('Label,Value\n"Example, A",10\n"Example ""B""",20');

  expect(expectedResult.error).toBeNull();
  expect(expectedResult.rows).toEqual([
    ['Label', 'Value'],
    ['Example, A', '10'],
    ['Example "B"', '20'],
  ]);
});

test('buildGraphChartData maps bar CSV to labels and datasets', () => {
  const expectedResult = buildGraphChartData('Quarter,Revenue,Cost\nQ1,12,7\nQ2,18,9', 'bar');

  expect(expectedResult.error).toBeNull();
  expect(expectedResult.data).toEqual({
    labels: ['Q1', 'Q2'],
    datasets: [
      { label: 'Revenue', data: [12, 18] },
      { label: 'Cost', data: [7, 9] },
    ],
  });
});

test('buildGraphChartData maps pie CSV to first numeric series', () => {
  const expectedResult = buildGraphChartData('Type,Count,Ignored\nAlpha,5,100\nBeta,8,200', 'pie');

  expect(expectedResult.error).toBeNull();
  expect(expectedResult.data).toEqual({
    labels: ['Alpha', 'Beta'],
    datasets: [{ label: 'Count', data: [5, 8] }],
  });
});

test('buildGraphChartData reports invalid numeric values without discarding CSV', () => {
  const expectedResult = buildGraphChartData('Label,Value\nAlpha,nope', 'line');

  expect(expectedResult.error).toBe('line chart values must be numeric.');
});

test('shouldCollapseInlineGraphLegend preserves plot space for dense inline graphs', () => {
  expect(shouldCollapseInlineGraphLegend(390, 252, 5)).toBe(true);
  expect(shouldCollapseInlineGraphLegend(760, 360, 5)).toBe(false);
  expect(shouldCollapseInlineGraphLegend(390, 252, 2)).toBe(false);
});
