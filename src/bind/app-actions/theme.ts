import { state, getRenderApp } from '../../state';
import { recordHistory } from '../../history';
import { getThemeConfig, applyTheme, writeThemeConfig } from '../../theme';
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

export const themeActions: Record<string, AppActionHandler> = {
  'open-theme-modal': openThemeModal,
  'theme-add-color': themeAddColor,
  'theme-remove-color': themeRemoveOrResetColor('remove'),
  'theme-reset-color': themeRemoveOrResetColor('reset'),
};
