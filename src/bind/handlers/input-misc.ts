import { state, incrementInputEventCount, getRenderApp, getRefreshReaderPanels, handleTagEditorInput, findSectionByKey, getReusableNameFromSectionKey, resolveBlockContext, handleBlockFieldInput, recordHistory, syncReusableTemplateForBlock, sanitizeOptionalId, tagStateHelpers } from './_imports';
import { SCRIPTING_PLUGIN_ID } from '../../plugins/registry';
import { SCRIPTING_PLUGIN_VERSION } from '../../plugins/scripting/version';

export function bindInputMisc(app: HTMLElement): void {
  app.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (handleTagEditorInput(target, tagStateHelpers)) {
      return;
    }
    const sectionKey = target.dataset.sectionKey;
    if (!sectionKey) {
      return;
    }
    const eventId = incrementInputEventCount();
    const startedAt = performance.now();
    const reusableName = getReusableNameFromSectionKey(sectionKey);

    const field = target.dataset.field;
    console.debug('[hvy:perf] input:start', {
      eventId,
      field,
      sectionKey,
      blockId: target.dataset.blockId ?? null,
      targetType: target.tagName.toLowerCase(),
      advanced: state.showAdvancedEditor,
    });
    if (field === 'new-component-type' && target instanceof HTMLSelectElement) {
      state.addComponentBySection[sectionKey] = target.value;
      console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)) });
      return;
    }
    if (field === 'new-grid-component-type' && target instanceof HTMLSelectElement) {
      const blockId = target.dataset.blockId;
      if (!blockId) {
        console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)), skipped: 'missing-block-id' });
        return;
      }
      state.gridAddComponentByBlock[blockId] = target.value;
      console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)) });
      return;
    }

    const section = reusableName ? null : findSectionByKey(state.document.sections, sectionKey);
    if (!section && !reusableName) {
      return;
    }

    const blockIdForHistory = target.dataset.blockId ?? '';
    if (field && field !== 'new-component-type' && field !== 'table-cell' && field !== 'table-column') {
      recordHistory(`input:${sectionKey}:${blockIdForHistory}:${field}`);
    }

    if (field === 'section-title' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.title = target.value;
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'section-custom-id' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.customId = sanitizeOptionalId(target.value);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'section-description' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      if (!section) {
        return;
      }
      section.description = target.value;
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'section-lock' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.lock = target.checked;
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }

    if (field === 'new-component-type' && target instanceof HTMLSelectElement) {
      if (!section) {
        return;
      }
      state.addComponentBySection[section.key] = target.value;
      return;
    }

    if (field === 'section-highlight' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.highlight = target.checked;
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'section-contained' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.contained = target.checked;
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'section-expanded' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.expanded = target.checked;
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-tags' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      block.schema.tags = target.value;
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-placeholder' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.placeholder = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRenderApp()();
      return;
    }

    if (field === 'block-description' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      block.schema.description = target.value;
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-plugin-scripting-version' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      if (block.schema.component !== 'plugin' || block.schema.plugin !== SCRIPTING_PLUGIN_ID) {
        return;
      }
      block.schema.pluginConfig = {
        ...block.schema.pluginConfig,
        version: target.value.trim() || SCRIPTING_PLUGIN_VERSION,
      };
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-custom-css' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.customCss = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-expandable-stub-css' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.expandableStubCss = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-expandable-content-css' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.expandableContentCss = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-meta-open' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      block.schema.metaOpen = target.checked;
      getRenderApp()();
      return;
    }

    if (handleBlockFieldInput(target)) {
      console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)), handledBy: 'block-field' });
      return;
    }
    console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)), handledBy: 'none' });
  });
}
