import { state, getRenderApp } from '../../state';
import { recordHistory } from '../../history';
import { getThemeConfig, applyTheme, writeThemeConfig, colorValueToAlpha, colorValueToPickerHex, getResolvedThemeColor, THEME_COLOR_NAMES } from '../../theme';
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
  if (label === 'reset') {
    updateResetThemeRow(actionButton, name);
    return;
  }
  getRenderApp()();
};

const themeApplyPalette: AppActionHandler = ({ actionButton }) => {
  const paletteId = actionButton.dataset.paletteId ?? '';
  const palette = getPaletteById(paletteId);
  if (!palette) return;
  recordHistory(`meta:theme-palette:${palette.id}`);
  const theme = getThemeConfig();
  for (const name of THEME_COLOR_NAMES) {
    delete theme.colors[name];
  }
  writeThemeConfig(theme);
  state.paletteOverrideId = palette.id;
  savePaletteOverrideId(palette.id);
  applyTheme();
  getRenderApp()();
};

const themeClearPaletteOverride: AppActionHandler = () => {
  recordHistory('meta:theme-palette:clear');
  state.paletteOverrideId = null;
  savePaletteOverrideId(null);
  applyTheme();
  getRenderApp()();
};

const themeFilterToColors: AppActionHandler = ({ app, actionButton, event }) => {
  event.preventDefault();
  setThemeModalFilter(app, actionButton.dataset.themeFilter ?? '');
};

const themePreviewSelectComponent: AppActionHandler = ({ app, actionButton }) => {
  const component = actionButton.dataset.themeComponent ?? '';
  if (!component) return;
  app.querySelectorAll<HTMLElement>('.theme-component-picker-button').forEach((button) => {
    button.classList.toggle('is-active', button === actionButton);
  });
  app.querySelectorAll<HTMLElement>('[data-theme-preview-component]').forEach((preview) => {
    preview.classList.toggle('is-active', preview.dataset.themePreviewComponent === component);
  });
};

const themePreviewSetState: AppActionHandler = ({ app, actionButton, event }) => {
  event.preventDefault();
  const preview = actionButton.closest<HTMLElement>('[data-theme-preview-component]');
  const stateName = actionButton.dataset.themeState ?? '';
  if (!preview || !stateName) return;
  preview.dataset.themePreviewState = stateName;
  preview.querySelectorAll<HTMLElement>('.theme-preview-state-button').forEach((button) => {
    button.classList.toggle('is-active', button === actionButton);
  });
  syncThemePreviewStateDecorations(preview, stateName);
  setThemeModalFilter(app, actionButton.dataset.themeFilter ?? '');
};

function syncThemePreviewStateDecorations(preview: HTMLElement, stateName: string): void {
  const allColorsButton = preview.querySelector<HTMLElement>('.theme-preview-all');
  if (!allColorsButton || !preview.classList.contains('theme-preview-button-card')) return;
  if (stateName === 'hover') {
    allColorsButton.style.setProperty('border-color', 'var(--hvy-focus)', 'important');
    allColorsButton.style.setProperty('background', 'var(--hvy-button-hover-bg)', 'important');
    allColorsButton.style.setProperty('background-color', 'var(--hvy-button-hover-bg)', 'important');
    allColorsButton.style.setProperty('background-image', 'none', 'important');
    allColorsButton.style.setProperty('color', 'var(--hvy-button-hover-text)', 'important');
    allColorsButton.style.setProperty('box-shadow', 'inset 0 0 0 1px color-mix(in srgb, var(--hvy-focus) 30%, transparent), 0 8px 18px var(--hvy-shadow-md)', 'important');
    return;
  }
  allColorsButton.style.removeProperty('border-color');
  allColorsButton.style.removeProperty('background');
  allColorsButton.style.removeProperty('background-color');
  allColorsButton.style.removeProperty('background-image');
  allColorsButton.style.removeProperty('color');
  allColorsButton.style.removeProperty('box-shadow');
}

function updateResetThemeRow(actionButton: HTMLElement, name: string): void {
  const row = actionButton.closest<HTMLElement>('.theme-color-row');
  if (!row) return;
  const value = getResolvedThemeColor(name);
  row.classList.remove('theme-color-row--override');
  row.dataset.themeSearch = `${name} ${row.querySelector('strong')?.textContent ?? ''} ${value}`;
  const valueInput = row.querySelector<HTMLInputElement>('[data-field="theme-color-value"]');
  const pickerInput = row.querySelector<HTMLInputElement>('[data-field="theme-color-picker"]');
  if (valueInput) {
    valueInput.value = value;
  }
  if (pickerInput) {
    pickerInput.value = colorValueToPickerHex(value);
  }
  syncResetThemeAlphaControl(row, value);
  const resetGroup = actionButton.closest<HTMLElement>('.theme-color-reset-group');
  if (resetGroup) {
    resetGroup.outerHTML = '<span class="theme-color-action theme-color-default muted">default</span>';
  }
}

function syncResetThemeAlphaControl(row: HTMLElement, value: string): void {
  const alphaInput = row.querySelector<HTMLInputElement>('[data-field="theme-color-alpha"]');
  const alphaOutput = row.querySelector<HTMLOutputElement>('.theme-alpha-control output');
  const alpha = colorValueToAlpha(value);
  if (alphaInput) {
    alphaInput.value = String(alpha);
  }
  if (alphaOutput) {
    alphaOutput.value = String(Math.round(alpha * 100));
    alphaOutput.textContent = String(Math.round(alpha * 100));
  }
}

export const themeActions: Record<string, AppActionHandler> = {
  'open-theme-modal': openThemeModal,
  'theme-add-color': themeAddColor,
  'theme-remove-color': themeRemoveOrResetColor('remove'),
  'theme-reset-color': themeRemoveOrResetColor('reset'),
  'theme-apply-palette': themeApplyPalette,
  'theme-clear-palette-override': themeClearPaletteOverride,
  'theme-filter-to-colors': themeFilterToColors,
  'theme-preview-select-component': themePreviewSelectComponent,
  'theme-preview-set-state': themePreviewSetState,
};
