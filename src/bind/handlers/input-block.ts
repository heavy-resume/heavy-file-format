import { state, getRenderApp, getRefreshReaderPanels, getThemeConfig, applyTheme, writeThemeConfig, colorValueToPickerHex, getComponentDefs, getSectionDefs, resolveBlockContext, recordHistory, persistChatSettings, getRawEditorDiagnostics } from './_imports';

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

    if (field === 'ai-model' && target instanceof HTMLInputElement) {
      state.chat.settings.model = target.value;
      persistChatSettings(state.chat.settings);
      state.aiEdit.error = null;
      return;
    }

    if (field === 'chat-input' && target instanceof HTMLTextAreaElement) {
      state.chat.draft = target.value;
      state.chat.error = null;
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
      getRenderApp()();
      return;
    }

    if (field === 'theme-color-picker' && target instanceof HTMLInputElement) {
      const name = target.dataset.colorName ?? '';
      if (!name) return;
      recordHistory(`meta:theme-color:${name}`);
      const theme = getThemeConfig();
      theme.colors[name] = target.value;
      writeThemeConfig(theme);
      applyTheme();
      const row = target.closest<HTMLElement>('.theme-color-row');
      const valueInput = row?.querySelector<HTMLInputElement>('.theme-color-value');
      const swatch = row?.querySelector<HTMLElement>('.theme-color-swatch');
      if (valueInput) {
        valueInput.value = target.value;
      }
      if (swatch) {
        swatch.style.background = target.value;
      }
      return;
    }

    if (field === 'theme-color-value' && target instanceof HTMLInputElement) {
      const name = target.dataset.colorName ?? '';
      if (!name) return;
      recordHistory(`meta:theme-color:${name}`);
      const theme = getThemeConfig();
      theme.colors[name] = target.value;
      writeThemeConfig(theme);
      applyTheme();
      const row = target.closest<HTMLElement>('.theme-color-row');
      const pickerInput = row?.querySelector<HTMLInputElement>('.theme-color-picker');
      const swatch = row?.querySelector<HTMLElement>('.theme-color-swatch');
      if (pickerInput) {
        pickerInput.value = colorValueToPickerHex(target.value);
      }
      if (swatch) {
        swatch.style.background = target.value;
      }
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

    if (field === 'raw-editor-text' && target instanceof HTMLTextAreaElement) {
      recordHistory('raw-editor:text');
      state.rawEditorText = target.value;
      state.rawEditorError = null;
      state.rawEditorDiagnostics = getRawEditorDiagnostics(target.value, state.filename);
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
