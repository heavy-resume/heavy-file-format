import { state, getRenderApp, getRefreshReaderPanels, getThemeConfig, applyTheme, writeThemeConfig, colorValueToAlpha, colorValueToPickerHex, getThemeResetColor, mergeAlphaIntoCssColor, getComponentDefs, getSectionDefs, resolveBlockContext, recordHistory, persistChatSettings, getRawEditorDiagnostics } from './_imports';
import { applyThemeModalFilter } from '../../theme-modal-filter';
import {
  TEXT_LINE_STYLE_NAME_PATTERN,
  formatTextLineStyleCssLines,
  getTextLineStylePreviewCss,
  getTextLineStyleSpacing,
  getTextLineStylesFromMeta,
  getTextLineStyleLabel,
  replaceTextLineStyleMarkerName,
  sanitizeTextLineStyleCss,
  updateTextLineStyleSpacingCss,
  writeTextLineStylesToMeta,
} from '../../text-line-styles';
import { visitBlocks } from '../../section-ops';

export function bindInputBlock(app: HTMLElement): void {
    app.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    const field = target.dataset.field;
    if (!field) {
      return;
    }

    if (field === 'template-value' && target instanceof HTMLInputElement) {
      const key = target.dataset.templateField;
      if (!key) {
        return;
      }
      recordHistory(`template:${key}`);
      state.templateValues[key] = target.value;
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'meta-title' && target instanceof HTMLInputElement) {
      recordHistory('meta:title');
      state.document.meta.title = target.value;
      return;
    }

    if (field === 'chat-model' && target instanceof HTMLInputElement) {
      state.chat.settings.model = target.value;
      persistChatSettings(state.chat.settings);
      state.chat.error = null;
      return;
    }

    if (field === 'chat-compaction-model' && target instanceof HTMLInputElement) {
      state.chat.settings.compactionModel = target.value;
      persistChatSettings(state.chat.settings);
      state.chat.error = null;
      return;
    }

    if (field === 'ai-model' && target instanceof HTMLInputElement) {
      state.chat.settings.model = target.value;
      persistChatSettings(state.chat.settings);
      state.aiEdit.error = null;
      return;
    }

    if (field === 'chat-input' && target instanceof HTMLTextAreaElement) {
      state.chat.draft = target.value;
      state.chat.error = null;
      console.debug('[hvy:chat-input] draft updated', {
        draftLength: state.chat.draft.length,
        trimmedDraftLength: state.chat.draft.trim().length,
      });
      return;
    }

    if (field === 'ai-edit-input' && target instanceof HTMLTextAreaElement) {
      state.aiEdit.draft = target.value;
      state.aiEdit.error = null;
      return;
    }

    if (field === 'meta-sidebar-label' && target instanceof HTMLInputElement) {
      recordHistory('meta:sidebar-label');
      if (target.value.trim().length > 0) {
        state.document.meta.sidebar_label = target.value;
      } else {
        delete state.document.meta.sidebar_label;
      }
      return;
    }

    if (field === 'meta-reader-max-width' && target instanceof HTMLInputElement) {
      recordHistory('meta:reader-max-width');
      if (target.value.trim().length > 0) {
        state.document.meta.reader_max_width = target.value;
      } else {
        delete state.document.meta.reader_max_width;
      }
      const editorTreeBody = target.ownerDocument.querySelector<HTMLElement>('.editor-tree-body');
      if (editorTreeBody) {
        editorTreeBody.style.maxWidth = target.value.trim();
      }
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'meta-ai-context' && target instanceof HTMLTextAreaElement) {
      recordHistory('meta:ai-context');
      if (target.value.trim().length > 0) {
        state.document.meta['ai-context'] = target.value;
      } else {
        delete state.document.meta['ai-context'];
      }
      return;
    }

    if (field === 'text-line-style-name' && target instanceof HTMLInputElement) {
      const oldName = target.dataset.styleName ?? '';
      const newName = target.value.trim();
      if (!oldName || !newName || oldName === newName || !TEXT_LINE_STYLE_NAME_PATTERN.test(newName)) return;
      const styles = getTextLineStylesFromMeta(state.document.meta);
      if (styles[newName]) return;
      recordHistory(`meta:text-line-style:rename:${oldName}`);
      styles[newName] = styles[oldName] ?? { label: '', css: '' };
      delete styles[oldName];
      writeTextLineStylesToMeta(state.document.meta, styles);
      visitBlocks(state.document.sections, (block) => {
        block.text = replaceTextLineStyleMarkerName(block.text, oldName, newName);
      });
      target.dataset.styleName = newName;
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }

    if (field === 'text-line-style-label' && target instanceof HTMLInputElement) {
      const name = target.dataset.styleName ?? '';
      if (!name) return;
      recordHistory(`meta:text-line-style:label:${name}`);
      const styles = getTextLineStylesFromMeta(state.document.meta);
      styles[name] = { ...(styles[name] ?? { label: '', css: '' }), label: target.value };
      writeTextLineStylesToMeta(state.document.meta, styles);
      refreshTextLineStyleLabelUi(app, name, getTextLineStyleLabel(name, styles[name]));
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'text-line-style-css' && target instanceof HTMLTextAreaElement) {
      const name = target.dataset.styleName ?? '';
      if (!name) return;
      recordHistory(`meta:text-line-style:css:${name}`);
      const styles = getTextLineStylesFromMeta(state.document.meta);
      styles[name] = { ...(styles[name] ?? { label: '', css: '' }), css: sanitizeTextLineStyleCss(target.value) };
      writeTextLineStylesToMeta(state.document.meta, styles);
      refreshTextLineStyleEditingUi(app, name, styles[name]?.css ?? '');
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'text-line-style-spacing' && target instanceof HTMLInputElement) {
      const name = target.dataset.styleName ?? '';
      const property = target.dataset.cssProperty ?? '';
      if (!name || !property) return;
      recordHistory(`meta:text-line-style:spacing:${name}:${property}`);
      const styles = getTextLineStylesFromMeta(state.document.meta);
      const nextCss = updateTextLineStyleSpacingCss(styles[name]?.css ?? '', property, target.value);
      styles[name] = { ...(styles[name] ?? { label: '', css: '' }), css: nextCss };
      writeTextLineStylesToMeta(state.document.meta, styles);
      refreshTextLineStyleEditingUi(app, name, nextCss);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'theme-color-picker' && target instanceof HTMLInputElement) {
      const name = target.dataset.colorName ?? '';
      if (!name) return;
      recordHistory(`meta:theme-color:${name}`);
      const resetValue = getThemeResetColor(name);
      const theme = getThemeConfig();
      const nextValue = mergePickerHexIntoCssColor(target.value, theme.colors[name] ?? '');
      theme.colors[name] = nextValue;
      writeThemeConfig(theme);
      applyTheme();
      const row = target.closest<HTMLElement>('.theme-color-row');
      const valueInput = row?.querySelector<HTMLInputElement>('.theme-color-value');
      if (valueInput) {
        valueInput.value = nextValue;
      }
      syncThemeAlphaControl(row, nextValue);
      markThemeRowOverridden(row, name, resetValue);
      return;
    }

    if (field === 'theme-color-filter' && target instanceof HTMLInputElement) {
      applyThemeModalFilter(app, target.value);
      return;
    }

    if (field === 'theme-color-value' && target instanceof HTMLInputElement) {
      const name = target.dataset.colorName ?? '';
      if (!name) return;
      recordHistory(`meta:theme-color:${name}`);
      const resetValue = getThemeResetColor(name);
      const theme = getThemeConfig();
      theme.colors[name] = target.value;
      writeThemeConfig(theme);
      applyTheme();
      const row = target.closest<HTMLElement>('.theme-color-row');
      const pickerInput = row?.querySelector<HTMLInputElement>('.theme-color-picker');
      if (pickerInput) {
        pickerInput.value = colorValueToPickerHex(target.value);
      }
      syncThemeAlphaControl(row, target.value);
      markThemeRowOverridden(row, name, resetValue);
      return;
    }

    if (field === 'theme-color-alpha' && target instanceof HTMLInputElement) {
      const name = target.dataset.colorName ?? '';
      if (!name) return;
      recordHistory(`meta:theme-color:${name}:alpha`);
      const resetValue = getThemeResetColor(name);
      const row = target.closest<HTMLElement>('.theme-color-row');
      const valueInput = row?.querySelector<HTMLInputElement>('.theme-color-value');
      const currentValue = valueInput?.value ?? getThemeConfig().colors[name] ?? '';
      const nextValue = mergeAlphaIntoCssColor(currentValue, Number.parseFloat(target.value));
      const theme = getThemeConfig();
      theme.colors[name] = nextValue;
      writeThemeConfig(theme);
      applyTheme();
      if (valueInput) {
        valueInput.value = nextValue;
      }
      syncThemeAlphaControl(row, nextValue);
      markThemeRowOverridden(row, name, resetValue);
      return;
    }

    if (field === 'theme-color-name' && target instanceof HTMLInputElement) {
      const oldName = target.dataset.colorName ?? '';
      const newName = target.value.trim();
      if (!oldName || !newName || oldName === newName) return;
      recordHistory(`meta:theme-color-rename:${oldName}`);
      const theme = getThemeConfig();
      if (newName in theme.colors) return;
      theme.colors[newName] = theme.colors[oldName];
      delete theme.colors[oldName];
      target.dataset.colorName = newName;
      writeThemeConfig(theme);
      applyTheme();
      return;
    }

    if (field === 'def-name' && target instanceof HTMLInputElement) {
      const idx = Number.parseInt(target.dataset.defIndex ?? '', 10);
      const defs = getComponentDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`def:${idx}:name`);
        defs[idx].name = target.value;
        state.document.meta.component_defs = defs;
      }
      return;
    }

    if (field === 'def-base' && target instanceof HTMLSelectElement) {
      const idx = Number.parseInt(target.dataset.defIndex ?? '', 10);
      const defs = getComponentDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`def:${idx}:base`);
        defs[idx].baseType = target.value;
        state.document.meta.component_defs = defs;
      }
      return;
    }

    if (field === 'def-tags' && target instanceof HTMLInputElement) {
      const idx = Number.parseInt(target.dataset.defIndex ?? '', 10);
      const defs = getComponentDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`def:${idx}:tags`);
        defs[idx].tags = target.value;
        state.document.meta.component_defs = defs;
      }
      return;
    }

    if (field === 'def-description' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const idx = Number.parseInt(target.dataset.defIndex ?? '', 10);
      const defs = getComponentDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`def:${idx}:description`);
        defs[idx].description = target.value;
        state.document.meta.component_defs = defs;
      }
      return;
    }

    if (field === 'section-def-name' && target instanceof HTMLInputElement) {
      const idx = Number.parseInt(target.dataset.sectionDefIndex ?? '', 10);
      const defs = getSectionDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`section-def:${idx}:name`);
        defs[idx].name = target.value;
        state.document.meta.section_defs = defs;
      }
      return;
    }

    if (field === 'row-details-new-component-type' && target instanceof HTMLSelectElement) {
      const key = target.dataset.rowDetailsKey;
      if (key) {
        state.addComponentBySection[key] = target.value;
      }
      return;
    }

    if (field === 'container-new-component-type' && target instanceof HTMLSelectElement) {
      const key = target.dataset.containerKey;
      if (key) {
        state.addComponentBySection[key] = target.value;
      }
      return;
    }

    if (field === 'expandable-stub-new-component-type' && target instanceof HTMLSelectElement) {
      const key = target.dataset.expandableKey;
      if (key) {
        state.addComponentBySection[key] = target.value;
      }
      return;
    }

    if (field === 'expandable-content-new-component-type' && target instanceof HTMLSelectElement) {
      const key = target.dataset.expandableKey;
      if (key) {
        state.addComponentBySection[key] = target.value;
      }
      return;
    }

    if (field === 'reusable-section-type' && target instanceof HTMLSelectElement) {
      const key = target.dataset.sectionKey;
      if (key) {
        state.addComponentBySection[key] = target.value;
      }
      return;
    }

    if (field === 'empty-section-heading-level' && target instanceof HTMLSelectElement) {
      const key = target.dataset.sectionKey;
      if (key) {
        state.addComponentBySection[`empty-heading:${key}`] = target.value;
      }
      return;
    }

    if (field === 'raw-editor-text' && target instanceof HTMLTextAreaElement) {
      recordHistory('raw-editor:text');
      state.rawEditorText = target.value;
      state.rawEditorError = null;
      state.rawEditorDiagnostics = getRawEditorDiagnostics(target.value, state.filename);
      return;
    }

    if (target.id === 'cliInput' && target instanceof HTMLInputElement) {
      state.cliDraft = target.value;
      return;
    }

    if (field === 'image-alt' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const block = resolveBlockContext(target)?.block ?? null;
      if (!block) return;
      recordHistory(`image-alt:${block.id}`);
      block.schema.imageAlt = target.value;
      getRefreshReaderPanels()();
      return;
    }
  });
}

function mergePickerHexIntoCssColor(hex: string, currentValue: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return hex;
  }
  const alpha = extractCssAlpha(currentValue);
  if (alpha === null) {
    return hex;
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }
  const value = match[1];
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function extractCssAlpha(value: string): string | null {
  const match = value.trim().match(/^rgba?\(\s*(?:\d{1,3})\s*[,\s]\s*(?:\d{1,3})\s*[,\s]\s*(?:\d{1,3})(?:\s*[,/]\s*([\d.]+)\s*)\)$/i);
  return match?.[1] ?? null;
}

function markThemeRowOverridden(row: HTMLElement | null | undefined, name: string, resetValue: string): void {
  if (!row) return;
  row.classList.add('theme-color-row--override');
  const defaultLabel = row.querySelector<HTMLElement>('.theme-color-default');
  if (!defaultLabel) return;
  defaultLabel.outerHTML = `<span class="theme-color-reset-group">
    <button type="button" class="ghost theme-color-action" data-action="theme-reset-color" data-color-name="${escapeAttr(name)}" title="Reset to default">Reset</button>
    <span class="theme-color-reset-swatch" style="${resetValue ? `background: ${escapeAttr(resetValue)};` : ''}" title="${escapeAttr(`Reset value: ${resetValue}`)}" aria-hidden="true"></span>
  </span>`;
}

function syncThemeAlphaControl(row: HTMLElement | null | undefined, value: string): void {
  if (!row) return;
  const alpha = colorValueToAlpha(value);
  const alphaInput = row.querySelector<HTMLInputElement>('[data-field="theme-color-alpha"]');
  const alphaOutput = row.querySelector<HTMLOutputElement>('.theme-alpha-control output');
  if (alphaInput) {
    alphaInput.value = String(alpha);
  }
  if (alphaOutput) {
    alphaOutput.value = String(Math.round(alpha * 100));
    alphaOutput.textContent = alphaOutput.value;
  }
}

function refreshTextLineStyleEditingUi(app: HTMLElement, name: string, css: string): void {
  const previewCss = getTextLineStylePreviewCss(css);
  const spacing = getTextLineStyleSpacing(css);
  app.querySelectorAll<HTMLElement>(`[data-text-line-style-name="${cssEscape(name)}"] .text-line-style-sample`).forEach((sample) => {
    sample.setAttribute('style', previewCss);
  });
  app.querySelectorAll<HTMLElement>(`[data-text-line-style-name="${cssEscape(name)}"] .text-line-style-pill-sample`).forEach((sample) => {
    sample.setAttribute('style', previewCss);
  });
  app.querySelectorAll<HTMLTextAreaElement>(`textarea[data-field="text-line-style-css"][data-style-name="${cssEscape(name)}"]`).forEach((textarea) => {
    if (document.activeElement !== textarea) {
      textarea.value = formatTextLineStyleCssLines(css);
    }
  });
  Object.entries(spacing).forEach(([property, value]) => {
    app.querySelectorAll<HTMLInputElement>(`input[data-field="text-line-style-spacing"][data-style-name="${cssEscape(name)}"][data-css-property="${cssEscape(property)}"]`).forEach((input) => {
      if (document.activeElement !== input) {
        input.value = value;
      }
    });
  });
}

function refreshTextLineStyleLabelUi(app: HTMLElement, name: string, label: string): void {
  app.querySelectorAll<HTMLElement>(`[data-text-line-style-name="${cssEscape(name)}"] [data-text-line-style-sample-label]`).forEach((sampleLabel) => {
    sampleLabel.textContent = label;
  });
  app.querySelectorAll<HTMLElement>(`[data-text-line-style-name="${cssEscape(name)}"] .text-line-style-pill-sample`).forEach((sample) => {
    sample.textContent = label;
  });
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
