import { expect, test } from 'vitest';

import { colorValueToPickerHex, getThemeColorLabel } from '../src/theme';

test('theme color labels are human readable', () => {
  expect(getThemeColorLabel('--hvy-xref-card-bg')).toBe('Cross-Reference Card Background');
  expect(getThemeColorLabel('--hvy-table-row-bg-2')).toBe('Even Table Row Background');
  expect(getThemeColorLabel('--hvy-accent-1')).toBe('Primary Accent Fill');
});

test('picker colors normalize rgb and short hex values', () => {
  expect(colorValueToPickerHex('#abc')).toBe('#aabbcc');
  expect(colorValueToPickerHex('rgb(12, 34, 56)')).toBe('#0c2238');
  expect(colorValueToPickerHex('rgba(12, 34, 56, 0.5)')).toBe('#0c2238');
});
