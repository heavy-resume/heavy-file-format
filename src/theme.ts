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
  '--hvy-warning-text',
  '--hvy-success',
  '--hvy-success-bg',
  '--hvy-success-border',
];

const THEME_COLOR_LABELS: Record<string, string> = {
  '--hvy-bg': 'Background',
  '--hvy-bg-alt': 'Background Alt',
  '--hvy-surface': 'Surface',
  '--hvy-surface-alt': 'Surface Alt',
  '--hvy-surface-tint': 'Surface Tint',
  '--hvy-text': 'Text',
  '--hvy-text-alt': 'Text Alt',
  '--hvy-text-muted': 'Text Muted',
  '--hvy-link-color': 'Link Color',
  '--hvy-accent-1': 'Accent 1',
  '--hvy-accent-1-alt': 'Accent 1 Alt',
  '--hvy-accent-1-text': 'Accent 1 Text',
  '--hvy-accent-2': 'Accent 2',
  '--hvy-accent-2-alt': 'Accent 2 Alt',
  '--hvy-button-bg': 'Button Background',
  '--hvy-button-text': 'Button Text',
  '--hvy-highlight-1': 'Highlight 1',
  '--hvy-highlight-2': 'Highlight 2',
  '--hvy-border': 'Border',
  '--hvy-border-alt': 'Border Alt',
  '--hvy-border-input': 'Input Border',
  '--hvy-border-translucent': 'Translucent Border',
  '--hvy-xref-card-bg': 'Xref Card Background',
  '--hvy-xref-card-hover-bg': 'Xref Card Hover Background',
  '--hvy-table-header': 'Table Header',
  '--hvy-table-row-bg-1': 'Table Row Background 1',
  '--hvy-table-row-bg-2': 'Table Row Background 2',
  '--hvy-icon-muted': 'Muted Icon',
  '--hvy-shadow': 'Shadow',
  '--hvy-shadow-md': 'Shadow Medium',
  '--hvy-shadow-lg': 'Shadow Large',
  '--hvy-overlay': 'Overlay',
  '--hvy-danger': 'Danger',
  '--hvy-warning': 'Warning',
  '--hvy-warning-bg': 'Warning Background',
  '--hvy-warning-border': 'Warning Border',
  '--hvy-warning-text': 'Warning Text',
  '--hvy-success': 'Success',
  '--hvy-success-bg': 'Success Background',
  '--hvy-success-border': 'Success Border',
};

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

export function getThemeColorLabel(name: string): string {
  return THEME_COLOR_LABELS[name] ?? name.replace(/^--hvy-/, '').split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function getResolvedThemeColor(name: string): string {
  if (typeof window === 'undefined') {
    return getThemeConfig().colors[name] ?? '';
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || getThemeConfig().colors[name] || '';
}

export function colorValueToPickerHex(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '#000000';
  }
  const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return `#${hex
        .split('')
        .map((part) => `${part}${part}`)
        .join('')
        .toLowerCase()}`;
    }
    return `#${hex.toLowerCase()}`;
  }
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+\s*)?\)$/i);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number.parseInt(part, 10))));
    return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }
  return '#000000';
}
