import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { colorValueToPickerHex, getThemeColorLabel, THEME_COLOR_NAMES } from '../src/theme';
import { parsePaletteCss } from '../src/palettes/palette-registry';

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

test('converted palettes provide every conventional HVY theme color', () => {
  for (const file of [
    'black-widow-palette.css',
    'mocha-palette.css',
    'paper-palette.css',
    'petrichor-palette.css',
    'spring-palette.css',
    'ufo-palette.css',
  ]) {
    const colors = parsePaletteCss(readFileSync(fileURLToPath(new URL(`../src/palettes/${file}`, import.meta.url)), 'utf8'));
    for (const name of THEME_COLOR_NAMES) {
      expect(colors[name], `${file} should define ${name}`).toBeTruthy();
    }
  }
});

test('palette css parser extracts hvy custom properties', () => {
  expect(parsePaletteCss(':root { --hvy-bg: #fff; --other: red; --hvy-text: rgb(1, 2, 3); }')).toEqual({
    '--hvy-bg': '#fff',
    '--hvy-text': 'rgb(1, 2, 3)',
  });
});
