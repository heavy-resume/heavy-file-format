import { state } from './state';
import type { ThemeConfig, ThemeMode } from './types';
import type { JsonObject } from './hvy/types';

export type { ThemeConfig, ThemeMode };

export const THEME_COLOR_NAMES: readonly string[] = [
  '--hvy-background',
  '--hvy-background-alt',
  '--hvy-surface',
  '--hvy-surface-alt',
  '--hvy-surface-tint',
  '--hvy-text',
  '--hvy-text-alt',
  '--hvy-text-muted',
  '--hvy-accent-1',
  '--hvy-accent-1-alt',
  '--hvy-accent-1-text',
  '--hvy-accent-2',
  '--hvy-accent-2-alt',
  '--hvy-highlight-1',
  '--hvy-highlight-2',
  '--hvy-border',
  '--hvy-border-alt',
  '--hvy-border-input',
  '--hvy-border-translucent',
  '--hvy-xref-card-bg',
  '--hvy-xref-card-hover-bg',
  '--hvy-table-header',
  '--hvy-table-row-bg-1',
  '--hvy-table-row-bg-2',
  '--hvy-icon-muted',
  '--hvy-shadow',
  '--hvy-shadow-md',
  '--hvy-shadow-lg',
  '--hvy-overlay',
  '--hvy-danger',
  '--hvy-warning',
  '--hvy-warning-bg',
  '--hvy-warning-border',
  '--hvy-warning-accent',
  '--hvy-success',
  '--hvy-success-bg',
  '--hvy-success-border',
];

export function applyTheme(): void {
  const theme = getThemeConfig();
  const root = document.documentElement;

  // Remove all previously applied user override inline properties.
  const stale: string[] = [];
  for (let i = 0; i < root.style.length; i++) {
    const prop = root.style.item(i);
    if (prop.startsWith('--hvy-')) {
      stale.push(prop);
    }
  }
  stale.forEach((prop) => root.style.removeProperty(prop));

  // Apply only user-specified overrides verbatim (key IS the CSS property name).
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value);
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
