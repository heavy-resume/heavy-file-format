import { state } from './state';
import type { ThemeConfig, ThemeMode } from './types';
import type { JsonObject } from './hvy/types';

export type { ThemeConfig, ThemeMode };

export const THEME_COLOR_NAMES: readonly string[] = [
  'background',
  'background-alt',
  'surface',
  'surface-alt',
  'text',
  'text-alt',
  'accent-1',
  'accent-1-alt',
  'accent-2',
  'accent-2-alt',
  'highlight-1',
  'highlight-2',
  'border',
  'border-alt',
  'xref-card-bg',
  'table-header',
  'table-row-bg-1',
  'table-row-bg-2',
];

const LIGHT_DEFAULTS: Record<string, string> = {
  'background': '#f5f9ff',
  'background-alt': '#eef3fa',
  'surface': '#ffffff',
  'surface-alt': '#f3f5f8',
  'text': '#1a2530',
  'text-alt': '#4b5563',
  'accent-1': '#325f6e',
  'accent-1-alt': '#7aa4b0',
  'accent-2': '#1f7a8c',
  'accent-2-alt': '#a7d3db',
  'highlight-1': 'rgba(31, 122, 140, 0.15)',
  'highlight-2': 'rgba(255, 214, 102, 0.35)',
  'border': '#d2dde6',
  'border-alt': '#e5e7eb',
  'xref-card-bg': '#f3f5f8',
  'table-header': '#e5e7eb',
  'table-row-bg-1': '#ffffff',
  'table-row-bg-2': '#f9fafb',
};

const DARK_DEFAULTS: Record<string, string> = {
  'background': '#0f1720',
  'background-alt': '#161b22',
  'surface': '#17222d',
  'surface-alt': '#1f2630',
  'text': '#e7eef5',
  'text-alt': '#a3adbf',
  'accent-1': '#7db3d0',
  'accent-1-alt': '#335b78',
  'accent-2': '#6fb3c1',
  'accent-2-alt': '#2d5d68',
  'highlight-1': 'rgba(125, 179, 208, 0.20)',
  'highlight-2': 'rgba(255, 214, 102, 0.25)',
  'border': '#2a3340',
  'border-alt': '#3d4756',
  'xref-card-bg': 'rgba(255, 255, 255, 0.04)',
  'table-header': '#1f2a37',
  'table-row-bg-1': '#17222d',
  'table-row-bg-2': '#1b2632',
};

export function getBuiltinDefaults(mode: ThemeMode): Record<string, string> {
  return { ...(mode === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS) };
}

export function applyTheme(): void {
  const theme = getThemeConfig();
  const root = document.documentElement;
  const merged = { ...getBuiltinDefaults(theme.mode), ...theme.colors };

  // Remove stale --hvy-* custom properties that aren't in the current set.
  const stale: string[] = [];
  for (let i = 0; i < root.style.length; i++) {
    const prop = root.style.item(i);
    if (prop.startsWith('--hvy-') && !(prop.slice('--hvy-'.length) in merged)) {
      stale.push(prop);
    }
  }
  stale.forEach((prop) => root.style.removeProperty(prop));

  for (const [name, value] of Object.entries(merged)) {
    root.style.setProperty(`--hvy-${name}`, value);
  }
  root.classList.toggle('theme-dark', theme.mode === 'dark');
}

export function getThemeConfig(): ThemeConfig {
  const themeRaw = state.document.meta.theme;
  if (!themeRaw || typeof themeRaw !== 'object') {
    const fresh: ThemeConfig = { mode: 'light', colors: {} };
    state.document.meta.theme = fresh;
    return fresh;
  }
  const theme = themeRaw as JsonObject;
  const mode: ThemeMode = theme.mode === 'dark' ? 'dark' : 'light';
  const colorsRaw = theme.colors;
  const colors: Record<string, string> = {};
  if (colorsRaw && typeof colorsRaw === 'object' && !Array.isArray(colorsRaw)) {
    for (const [k, v] of Object.entries(colorsRaw as JsonObject)) {
      if (typeof v === 'string') {
        colors[k] = v;
      }
    }
  }
  return { mode, colors };
}

export function writeThemeConfig(next: ThemeConfig): void {
  state.document.meta.theme = {
    mode: next.mode,
    colors: { ...next.colors },
  };
}
