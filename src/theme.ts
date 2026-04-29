import './theme.css';
import { state } from './state';
import type { ThemeConfig } from './types';
import type { JsonObject } from './hvy/types';
import { cssFragmentTriggersNetwork } from './css-sanitizer';
import { isExternalCssAllowed } from './reference-config';

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
  '--hvy-code-bg',
  '--hvy-code-text',
  '--hvy-code-muted',
  '--hvy-code-string',
  '--hvy-code-builtin',
  '--hvy-code-keyword',
  '--hvy-code-number',
];

const THEME_COLOR_LABELS: Record<string, string> = {
  '--hvy-bg': 'Page Background',
  '--hvy-bg-alt': 'Page Background Gradient End',
  '--hvy-surface': 'Panel and Card Background',
  '--hvy-surface-alt': 'Inset and Secondary Panel Background',
  '--hvy-surface-tint': 'Subtle Panel Tint',
  '--hvy-text': 'Primary Text',
  '--hvy-text-alt': 'Secondary Text',
  '--hvy-text-muted': 'Muted Helper Text',
  '--hvy-link-color': 'Inline Link Text',
  '--hvy-accent-1': 'Primary Accent Fill',
  '--hvy-accent-1-alt': 'Primary Accent Border',
  '--hvy-accent-1-text': 'Text on Primary Accent',
  '--hvy-accent-2': 'Secondary Accent Fill',
  '--hvy-accent-2-alt': 'Secondary Accent Border',
  '--hvy-button-bg': 'Primary Button Background',
  '--hvy-button-text': 'Primary Button Text',
  '--hvy-highlight-1': 'Soft Content Highlight',
  '--hvy-highlight-2': 'Strong Content Highlight',
  '--hvy-border': 'Default Panel Border',
  '--hvy-border-alt': 'Emphasized Border',
  '--hvy-border-input': 'Form Field and Table Border',
  '--hvy-border-translucent': 'Floating Toolbar Border',
  '--hvy-xref-card-bg': 'Cross-Reference Card Background',
  '--hvy-xref-card-hover-bg': 'Cross-Reference Card Hover Background',
  '--hvy-table-header': 'Table Header Background',
  '--hvy-table-row-bg-1': 'Odd Table Row Background',
  '--hvy-table-row-bg-2': 'Even Table Row Background',
  '--hvy-icon-muted': 'Muted Icon Color',
  '--hvy-shadow': 'Small Shadow Color',
  '--hvy-shadow-md': 'Medium Shadow Color',
  '--hvy-shadow-lg': 'Large Shadow Color',
  '--hvy-overlay': 'Modal and Sidebar Backdrop',
  '--hvy-danger': 'Danger Action and Error Text',
  '--hvy-warning': 'Warning Accent',
  '--hvy-warning-bg': 'Warning Background',
  '--hvy-warning-border': 'Warning Border',
  '--hvy-warning-text': 'Warning Text',
  '--hvy-success': 'Success Text',
  '--hvy-success-bg': 'Success Background',
  '--hvy-success-border': 'Success Border',
  '--hvy-code-bg': 'Code Block Background',
  '--hvy-code-text': 'Code Block Base Text',
  '--hvy-code-muted': 'Code Comment and Muted Text',
  '--hvy-code-string': 'Code String Text',
  '--hvy-code-builtin': 'Code Built-In Function Text',
  '--hvy-code-keyword': 'Code Keyword Text',
  '--hvy-code-number': 'Code Number and Literal Text',
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
  const allowExternal = isExternalCssAllowed();
  for (const [key, value] of Object.entries(theme.colors)) {
    if (!allowExternal && cssFragmentTriggersNetwork(value)) {
      continue;
    }
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
