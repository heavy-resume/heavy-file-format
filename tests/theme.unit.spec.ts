import { expect, test } from 'vitest';

import { colorValueToPickerHex, getThemeColorLabel } from '../src/theme';

test('theme color labels are human readable', () => {
  expect(getThemeColorLabel('--hvy-xref-card-bg')).toBe('Xref Card Background');
  expect(getThemeColorLabel('--hvy-table-row-bg-2')).toBe('Table Row Background 2');
});

test('picker colors normalize rgb and short hex values', () => {
  expect(colorValueToPickerHex('#abc')).toBe('#aabbcc');
  expect(colorValueToPickerHex('rgb(12, 34, 56)')).toBe('#0c2238');
  expect(colorValueToPickerHex('rgba(12, 34, 56, 0.5)')).toBe('#0c2238');
});
