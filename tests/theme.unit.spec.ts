import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test, vi } from 'vitest';

import { initState } from '../src/state';
import { colorValueToPickerHex, getThemeColorLabel, THEME_COLOR_NAMES } from '../src/theme';
import { applyTheme } from '../src/theme';
import { parsePaletteCss } from '../src/palettes/palette-registry';
import type { AppState } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('theme color labels are human readable', () => {
  expect(getThemeColorLabel('--hvy-xref-card-bg')).toBe('Reference Card Background');
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

test('palette override takes precedence until document theme is selected', () => {
  const style = createStyleDeclaration();
  vi.stubGlobal('document', {
    documentElement: {
      style,
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      offsetHeight: 0,
    },
  });
  vi.stubGlobal('window', {});
  initState({
    document: {
      meta: { hvy_version: 0.1, theme: { colors: { '--hvy-bg': '#123456' } } },
      extension: '.hvy',
      sections: [],
      attachments: [],
    },
    paletteOverrideId: 'ufo',
  } as unknown as AppState);

  applyTheme();
  expect(style.getPropertyValue('--hvy-bg')).not.toBe('#123456');

  initState({
    document: {
      meta: { hvy_version: 0.1, theme: { colors: { '--hvy-bg': '#123456' } } },
      extension: '.hvy',
      sections: [],
      attachments: [],
    },
    paletteOverrideId: null,
  } as unknown as AppState);

  applyTheme();
  expect(style.getPropertyValue('--hvy-bg')).toBe('#123456');
});

function createStyleDeclaration(): CSSStyleDeclaration {
  const values = new Map<string, string>();
  const priorities = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    item: (index: number) => [...values.keys()][index] ?? '',
    setProperty: (name: string, value: string, priority?: string) => {
      values.set(name, value);
      priorities.set(name, priority ?? '');
    },
    removeProperty: (name: string) => {
      const previous = values.get(name) ?? '';
      values.delete(name);
      priorities.delete(name);
      return previous;
    },
    getPropertyValue: (name: string) => values.get(name) ?? '',
    getPropertyPriority: (name: string) => priorities.get(name) ?? '',
  } as CSSStyleDeclaration;
}
