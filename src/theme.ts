import { state } from './state';
import type { ThemeConfig } from './types';
import type { JsonObject } from './hvy/types';

export type { ThemeConfig };
export type ColorMode = 'light' | 'dark';

export const THEME_COLOR_NAMES: readonly string[] = [
  '--hvy-bg',
  '--hvy-bg-alt',
  '--hvy-surface',
  '--hvy-surface-alt',
  '--hvy-surface-tint',
  '--hvy-text',
  '--hvy-text-alt',
  '--hvy-text-muted',
  '--hvy-link-color',
  '--hvy-accent-1',
  '--hvy-accent-1-alt',
  '--hvy-accent-1-text',
  '--hvy-accent-2',
  '--hvy-accent-2-alt',
  '--hvy-button-bg',
  '--hvy-button-text',
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

let colorModeMediaQuery: MediaQueryList | null = null;
let colorModeListener: ((event: MediaQueryListEvent) => void) | null = null;

export function getPreferredColorMode(): ColorMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyColorMode(mode: ColorMode = getPreferredColorMode()): void {
  document.documentElement.classList.toggle('theme-dark', mode === 'dark');
}

export function initColorModeSync(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  if (colorModeMediaQuery && colorModeListener) {
    return;
  }

  colorModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  colorModeListener = (event: MediaQueryListEvent) => {
    applyColorMode(event.matches ? 'dark' : 'light');
  };
  colorModeMediaQuery.addEventListener('change', colorModeListener);
}

export function applyTheme(): void {
  const theme = getThemeConfig();
  const root = document.documentElement;

  applyColorMode();

  // Remove all previously applied user override inline properties.
  const stale: string[] = [];
  for (let i = 0; i < root.style.length; i++) {
    const prop = root.style.item(i);
    if (prop.startsWith('--hvy-')) {
      stale.push(prop);
    }
  }
  stale.forEach((prop) => root.style.removeProperty(prop));

  root.classList.add('no-transitions');
  // Apply only user-specified overrides verbatim (key IS the CSS property name).
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value);
  }
  // Force a reflow so changes take effect before re-enabling transitions.
  void root.offsetHeight;
  root.classList.remove('no-transitions');
}

export function getThemeConfig(): ThemeConfig {
  const themeRaw = state.document.meta.theme;
  if (!themeRaw || typeof themeRaw !== 'object') {
    const fresh: ThemeConfig = { colors: {} };
    state.document.meta.theme = fresh;
    return fresh;
  }
  const theme = themeRaw as JsonObject;
  const colorsRaw = theme.colors;
  const colors: Record<string, string> = {};
  if (colorsRaw && typeof colorsRaw === 'object' && !Array.isArray(colorsRaw)) {
    for (const [k, v] of Object.entries(colorsRaw as JsonObject)) {
      if (typeof v === 'string') {
        colors[k] = v;
      }
    }
  }
  return { colors };
}

export function writeThemeConfig(next: ThemeConfig): void {
  state.document.meta.theme = {
    colors: { ...next.colors },
  };
}
