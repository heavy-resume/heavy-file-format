import { recordHistory } from '../../history';
import { applyTheme } from '../../theme';
import { state, getRenderApp } from '../../state';
import { showTransientNotice } from '../../transient-notice';
import { applyPdfStylePresetToMeta, findPdfStylePreset } from '../../pdf-style-presets';
import type { AppActionHandler } from './types';

const applyPdfStylePreset: AppActionHandler = ({ app, actionButton }) => {
  const picker = actionButton
    .closest<HTMLElement>('.meta-pdf-preset-picker')
    ?.querySelector<HTMLSelectElement>('select[data-field="meta-pdf-style-preset"]')
    ?? app.querySelector<HTMLSelectElement>('select[data-field="meta-pdf-style-preset"]');
  const presetId = picker?.value ?? '';
  const preset = findPdfStylePreset(state.pdfStylePresets, presetId);
  if (!preset) {
    return;
  }
  state.pdfStylePresetId = preset.id;
  recordHistory(`meta:pdf-style-preset:${preset.id}`);
  applyPdfStylePresetToMeta(state.document.meta, preset);
  applyTheme();
  showTransientNotice(`Applied PDF preset: ${preset.label}`);
  getRenderApp()();
};

export const pdfStylePresetActions: Record<string, AppActionHandler> = {
  'apply-pdf-style-preset': applyPdfStylePreset,
};
