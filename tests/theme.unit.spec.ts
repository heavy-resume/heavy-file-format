import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test, vi } from 'vitest';

import { initState } from '../src/state';
import { colorValueToPickerHex, getThemeColorLabel, setThemeOverrides, THEME_COLOR_NAMES } from '../src/theme';
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
  expect(getThemeColorLabel('--hvy-ai-view-hint-bg')).toBe('AI Editing Hint Background');
  expect(getThemeColorLabel('--hvy-diff-removed-text')).toBe('Diff Removed Text');
  expect(getThemeColorLabel('--hvy-diff-added-bg')).toBe('Diff Added Background');
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

test('diff foregrounds remain legible against their palette backgrounds', () => {
  for (const file of [
    'black-widow-palette.css',
    'mocha-palette.css',
    'paper-palette.css',
    'petrichor-palette.css',
    'spring-palette.css',
    'ufo-palette.css',
  ]) {
    const colors = parsePaletteCss(readFileSync(fileURLToPath(new URL(`../src/palettes/${file}`, import.meta.url)), 'utf8'));
    expect(colorContrastRatio(colors['--hvy-diff-removed-text']!, colors['--hvy-diff-removed-bg']!), `${file} removed diff contrast`).toBeGreaterThanOrEqual(4.5);
    expect(colorContrastRatio(colors['--hvy-diff-added-text']!, colors['--hvy-diff-added-bg']!), `${file} added diff contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test('palette css parser extracts hvy custom properties', () => {
  expect(parsePaletteCss(':root { --hvy-bg: #fff; --other: red; --hvy-text: rgb(1, 2, 3); }')).toEqual({
    '--hvy-bg': '#fff',
    '--hvy-text': 'rgb(1, 2, 3)',
  });
});

function colorContrastRatio(left: string, right: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5]
      .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

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

test('host theme overrides win without changing document metadata', () => {
  const style = createStyleDeclaration();
  vi.stubGlobal('document', {
    documentElement: {
      style,
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      offsetHeight: 0,
    },
  });
  vi.stubGlobal('window', {});
  const document = {
    meta: { hvy_version: 0.1, theme: { colors: { '--hvy-bg': '#123456' } } },
    extension: '.hvy' as const,
    sections: [],
    attachments: [],
  };
  const expectedDocument = structuredClone(document);
  initState({ document, paletteOverrideId: 'paper' } as unknown as AppState);
  setThemeOverrides({
    '--hvy-bg': ' #abcdef ',
    '--hvy-accent-1': '#fedcba',
    'background-color': 'red',
  });

  applyTheme();

  expect(style.getPropertyValue('--hvy-bg')).toBe('#abcdef');
  expect(style.getPropertyValue('--hvy-accent-1')).toBe('#fedcba');
  expect(style.getPropertyValue('background-color')).toBe('');
  expect(document).toEqual(expectedDocument);

  setThemeOverrides(null);
  applyTheme();
  expect(style.getPropertyValue('--hvy-bg')).not.toBe('#abcdef');
  expect(document).toEqual(expectedDocument);
});

test('applying viewer defaults does not add theme metadata to the document', () => {
  const style = createStyleDeclaration();
  vi.stubGlobal('document', {
    documentElement: {
      style,
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      offsetHeight: 0,
    },
  });
  vi.stubGlobal('window', {});
  const document = {
    meta: { hvy_version: 0.1 },
    extension: '.hvy' as const,
    sections: [],
    attachments: [],
  };
  initState({ document, paletteOverrideId: null } as unknown as AppState);

  applyTheme();

  expect(document.meta).toEqual({ hvy_version: 0.1 });
});

test('document sidebar width is applied at the theme root with its format default', () => {
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
      meta: { hvy_version: 0.1, sidebar_max_width: '28rem' },
      extension: '.hvy',
      sections: [],
      attachments: [],
    },
  } as unknown as AppState);

  applyTheme();
  expect(style.getPropertyValue('--hvy-sidebar-max-width')).toBe('28rem');

  initState({
    document: {
      meta: { hvy_version: 0.1 },
      extension: '.hvy',
      sections: [],
      attachments: [],
    },
  } as unknown as AppState);

  applyTheme();
  expect(style.getPropertyValue('--hvy-sidebar-max-width')).toBe('40rem');
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
