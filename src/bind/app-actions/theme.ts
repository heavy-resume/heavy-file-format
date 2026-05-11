import { state, getRenderApp } from '../../state';
import { recordHistory } from '../../history';
import { getThemeConfig, applyTheme, writeThemeConfig } from '../../theme';
import { getPaletteById } from '../../palettes/palette-registry';
import { savePaletteOverrideId } from '../../palettes/palette-preferences';
import { setThemeModalFilter } from '../../theme-modal-filter';
import type { AppActionHandler } from './types';

const openThemeModal: AppActionHandler = () => {
  state.themeModalOpen = true;
  getRenderApp()();
};

const themeAddColor: AppActionHandler = () => {
  recordHistory('meta:theme-color-add');
  const theme = getThemeConfig();
  let i = 1;
  let name = `color-${i}`;
  while (name in theme.colors) {
    i += 1;
    name = `color-${i}`;
  }
  theme.colors[name] = '#000000';
  writeThemeConfig(theme);
  applyTheme();
  getRenderApp()();
};

const themeRemoveOrResetColor = (label: string): AppActionHandler => ({ actionButton }) => {
  const name = actionButton.dataset.colorName ?? '';
  if (!name) return;
  recordHistory(`meta:theme-color-${label}:${name}`);
  const theme = getThemeConfig();
  delete theme.colors[name];
  writeThemeConfig(theme);
  applyTheme();
  getRenderApp()();
};

const themeApplyPalette: AppActionHandler = ({ actionButton }) => {
  const paletteId = actionButton.dataset.paletteId ?? '';
  const palette = getPaletteById(paletteId);
  if (!palette) return;
  state.paletteOverrideId = palette.id;
  savePaletteOverrideId(palette.id);
  applyTheme();
  getRenderApp()();
};

const themeClearPaletteOverride: AppActionHandler = () => {
  state.paletteOverrideId = null;
  savePaletteOverrideId(null);
  applyTheme();
  getRenderApp()();
};

const themeFilterToColors: AppActionHandler = ({ app, actionButton }) => {
  setThemeModalFilter(app, actionButton.dataset.themeFilter ?? '');
};

export const themeActions: Record<string, AppActionHandler> = {
  'open-theme-modal': openThemeModal,
  'theme-add-color': themeAddColor,
  'theme-remove-color': themeRemoveOrResetColor('remove'),
  'theme-reset-color': themeRemoveOrResetColor('reset'),
  'theme-apply-palette': themeApplyPalette,
  'theme-clear-palette-override': themeClearPaletteOverride,
  'theme-filter-to-colors': themeFilterToColors,
};
