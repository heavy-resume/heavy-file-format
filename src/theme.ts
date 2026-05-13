import './theme.css';
import { state } from './state';
import type { ThemeConfig } from './types';
import type { JsonObject } from './hvy/types';
import { cssFragmentTriggersNetwork } from './css-sanitizer';
import { isExternalCssAllowed } from './reference-config';
import { getPaletteById } from './palettes/palette-registry';

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
  '--hvy-link-hover-color',
  '--hvy-accent-1',
  '--hvy-accent-1-alt',
  '--hvy-accent-1-text',
  '--hvy-accent-2',
  '--hvy-accent-2-alt',
  '--hvy-button-bg',
  '--hvy-button-hover-bg',
  '--hvy-button-text',
  '--hvy-button-hover-text',
  '--hvy-highlight-1',
  '--hvy-highlight-2',
  '--hvy-border',
  '--hvy-border-alt',
  '--hvy-border-input',
  '--hvy-border-translucent',
  '--hvy-ghost-border',
  '--hvy-xref-card-bg',
  '--hvy-xref-card-hover-bg',
  '--hvy-table-header',
  '--hvy-table-row-bg-1',
  '--hvy-table-row-bg-2',
  '--hvy-icon-muted',
  '--hvy-focus',
  '--hvy-focus-ring',
  '--hvy-focus-glow',
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
  '--hvy-code-function',
  '--hvy-code-number',
];

const HOST_OVERRIDE_CSS_VARIABLES = new Set([
  '--hvy-modal-root-z',
  '--hvy-modal-overlay-z',
  '--hvy-modal-panel-z',
]);

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
  '--hvy-link-hover-color': 'Inline Link Hover Text',
  '--hvy-accent-1': 'Primary Accent Fill',
  '--hvy-accent-1-alt': 'Primary Accent Border',
  '--hvy-accent-1-text': 'Text on Primary Accent',
  '--hvy-accent-2': 'Secondary Accent Fill',
  '--hvy-accent-2-alt': 'Secondary Accent Border',
  '--hvy-button-bg': 'Primary Button Background',
  '--hvy-button-hover-bg': 'Primary Button Hover Background',
  '--hvy-button-text': 'Primary Button Text',
  '--hvy-button-hover-text': 'Primary Button Hover Text',
  '--hvy-highlight-1': 'Soft Content Highlight',
  '--hvy-highlight-2': 'Strong Content Highlight',
  '--hvy-border': 'Default Panel Border',
  '--hvy-border-alt': 'Emphasized Border',
  '--hvy-border-input': 'Form Field and Table Border',
  '--hvy-border-translucent': 'Floating Toolbar Border',
  '--hvy-ghost-border': 'Ghost Input Border',
  '--hvy-xref-card-bg': 'Cross-Reference Card Background',
  '--hvy-xref-card-hover-bg': 'Cross-Reference Card Hover Background',
  '--hvy-table-header': 'Table Header Background',
  '--hvy-table-row-bg-1': 'Odd Table Row Background',
  '--hvy-table-row-bg-2': 'Even Table Row Background',
  '--hvy-icon-muted': 'Muted Icon Color',
  '--hvy-focus': 'Focus Border',
  '--hvy-focus-ring': 'Focus Ring',
  '--hvy-focus-glow': 'Focus Glow',
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
  '--hvy-code-function': 'Code Function and Title Text',
  '--hvy-code-number': 'Code Number and Literal Text',
};

let colorModeMediaQuery: MediaQueryList | null = null;
let colorModeListener: ((event: MediaQueryListEvent) => void) | null = null;
let themeRoot: HTMLElement | null = null;

export function setThemeRoot(root: HTMLElement | null): void {
  themeRoot = root;
}

function getThemeRoot(): HTMLElement {
  return themeRoot ?? document.documentElement;
}

export function getPreferredColorMode(): ColorMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyColorMode(mode: ColorMode = getPreferredColorMode()): void {
  getThemeRoot().classList.toggle('theme-dark', mode === 'dark');
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
  const root = getThemeRoot();

  applyColorMode();

  // Remove all previously applied user override inline properties.
  const stale: string[] = [];
  for (let i = 0; i < root.style.length; i++) {
    const prop = root.style.item(i);
    if (prop.startsWith('--hvy-') && !HOST_OVERRIDE_CSS_VARIABLES.has(prop)) {
      stale.push(prop);
    }
  }
  stale.forEach((prop) => root.style.removeProperty(prop));

  root.classList.add('no-transitions');
  const allowExternal = isExternalCssAllowed();

  // Layer 1: local user palette override. This is intentionally not serialized
  // into the document, so it survives file switches and refreshes separately.
  const palette = state.paletteOverrideId ? getPaletteById(state.paletteOverrideId) : null;
  if (palette && hasFullConventionalThemeOverride(theme.colors)) {
    for (const name of THEME_COLOR_NAMES) {
      delete theme.colors[name];
    }
    writeThemeConfig(theme);
  }
  if (palette) {
    for (const [key, value] of Object.entries(palette.colors)) {
      if (!allowExternal && cssFragmentTriggersNetwork(value)) {
        continue;
      }
      root.style.setProperty(key, value);
    }
  }

  // Layer 2: document-specified theme overrides from the HVY/THVY file.
  // Document theme colors should only affect the app when the local palette
  // override is cleared via "Document Theme".
  if (!palette) {
    for (const [key, value] of Object.entries(theme.colors)) {
      if (!allowExternal && cssFragmentTriggersNetwork(value)) {
        continue;
      }
      root.style.setProperty(key, value);
    }
  }
  // Force a reflow so changes take effect before re-enabling transitions.
  void root.offsetHeight;
  root.classList.remove('no-transitions');
}

function hasFullConventionalThemeOverride(colors: Record<string, string>): boolean {
  let conventionalCount = 0;
  for (const name of THEME_COLOR_NAMES) {
    if (colors[name]) {
      conventionalCount += 1;
    }
  }
  return conventionalCount >= Math.floor(THEME_COLOR_NAMES.length * 0.8);
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
  return getComputedStyle(getThemeRoot()).getPropertyValue(name).trim() || getThemeConfig().colors[name] || '';
}

export function getThemeResetColor(name: string): string {
  const palette = state.paletteOverrideId ? getPaletteById(state.paletteOverrideId) : null;
  const paletteValue = palette?.colors[name];
  if (paletteValue) {
    return paletteValue;
  }
  if (typeof window === 'undefined') {
    return '';
  }
  const root = getThemeRoot();
  const currentInline = root.style.getPropertyValue(name);
  const currentPriority = root.style.getPropertyPriority(name);
  root.style.removeProperty(name);
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  if (currentInline) {
    root.style.setProperty(name, currentInline, currentPriority);
  }
  return value;
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

export function colorValueToAlpha(value: string): number {
  const alpha = extractCssAlpha(value);
  return alpha === null ? 1 : alpha;
}

export function mergeAlphaIntoCssColor(value: string, alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const rgb = parseCssRgb(value) ?? parseHexRgb(colorValueToPickerHex(value));
  if (!rgb) {
    return value;
  }
  if (clampedAlpha >= 1) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${formatAlpha(clampedAlpha)})`;
}

function extractCssAlpha(value: string): number | null {
  const match = value.trim().match(/^rgba?\(\s*(?:\d{1,3})\s*[,\s]\s*(?:\d{1,3})\s*[,\s]\s*(?:\d{1,3})(?:\s*[,/]\s*([\d.]+)\s*)\)$/i);
  if (!match?.[1]) {
    return null;
  }
  const alpha = Number.parseFloat(match[1]);
  return Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : null;
}

function parseCssRgb(value: string): { r: number; g: number; b: number } | null {
  const match = value.trim().match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+\s*)?\)$/i);
  if (!match) {
    return null;
  }
  const [r, g, b] = match.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number.parseInt(part, 10))));
  return { r, g, b };
}

function parseHexRgb(value: string): { r: number; g: number; b: number } | null {
  const match = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }
  const hex = match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function formatAlpha(alpha: number): string {
  return alpha.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
