import { state } from './state';
import type { ThemeConfig } from './types';
import type { JsonObject } from './hvy/types';

export type { ThemeConfig };

export function applyTheme(): void {
  const theme = getThemeConfig();
  const root = document.documentElement;
  root.style.setProperty('--hvy-bg', theme.background);
  root.style.setProperty('--hvy-surface', theme.surface);
  root.style.setProperty('--hvy-text', theme.text);
  root.style.setProperty('--hvy-accent', theme.accent);
  root.classList.toggle('theme-dark', theme.mode === 'dark');
}

export function getThemeConfig(): ThemeConfig {
  const themeRaw = state.document.meta.theme;
  const fallback: ThemeConfig = {
    mode: 'light',
    background: '#f5f9ff',
    surface: '#ffffff',
    text: '#1a2530',
    accent: '#325f6e',
  };
  if (!themeRaw || typeof themeRaw !== 'object') {
    state.document.meta.theme = fallback;
    return fallback;
  }
  const theme = themeRaw as JsonObject;
  return {
    mode: theme.mode === 'dark' ? 'dark' : 'light',
    background: typeof theme.background === 'string' ? theme.background : fallback.background,
    surface: typeof theme.surface === 'string' ? theme.surface : fallback.surface,
    text: typeof theme.text === 'string' ? theme.text : fallback.text,
    accent: typeof theme.accent === 'string' ? theme.accent : fallback.accent,
  };
}
