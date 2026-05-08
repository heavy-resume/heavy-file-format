import { state, incrementInputEventCount, getRenderApp, getRefreshReaderPanels, handleTagEditorInput, findSectionByKey, getReusableNameFromSectionKey, resolveBlockContext, handleBlockFieldInput, refreshRichToolbarState, recordHistory, syncReusableTemplateForBlock, sanitizeOptionalId, tagStateHelpers } from './_imports';
import { SCRIPTING_PLUGIN_ID } from '../../plugins/registry';
import { SCRIPTING_PLUGIN_VERSION } from '../../plugins/scripting/version';

export function bindInputMisc(app: HTMLElement): void {
  app.addEventListener('input', (event) => {
    const rawTarget = event.target as HTMLElement;
    const target = rawTarget.dataset.field ? rawTarget : rawTarget.closest<HTMLElement>('[data-field]') ?? rawTarget;
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
    if (field === 'empty-section-heading-level' && target instanceof HTMLSelectElement) {
      state.addComponentBySection[`empty-heading:${sectionKey}`] = target.value;
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

    if (field === 'block-schema-id' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      block.schema.id = sanitizeOptionalId(target.value);
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

    if (field === 'block-component-list-item-label' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.componentListItemLabel = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRenderApp()();
      return;
    }

    if (field === 'block-sort-keys' && target instanceof HTMLTextAreaElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const parsed = parseJsonObjectQuietly(target.value);
      if (!parsed) {
        return;
      }
      context.block.schema.sortKeys = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
          context.block.schema.sortKeys[key] = value;
        }
      }
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-sort-key-name' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const oldName = target.dataset.sortKeyName ?? '';
      const newName = target.value.trim();
      if (oldName && oldName !== newName) {
        const oldValue = context.block.schema.sortKeys[oldName];
        delete context.block.schema.sortKeys[oldName];
        if (newName) {
          context.block.schema.sortKeys[newName] = oldValue ?? '';
        }
        target.dataset.sortKeyName = newName;
      } else if (!oldName && newName) {
        context.block.schema.sortKeys[newName] = '';
        target.dataset.sortKeyName = newName;
        const valueInput = target.parentElement?.querySelector<HTMLInputElement>('[data-field="block-sort-key-value"]');
        if (valueInput) {
          valueInput.dataset.sortKeyName = newName;
        }
      } else if (oldName && !newName) {
        delete context.block.schema.sortKeys[oldName];
        target.dataset.sortKeyName = '';
      }
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-sort-key-value' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const name = target.dataset.sortKeyName ?? '';
      if (!name) {
        return;
      }
      context.block.schema.sortKeys[name] = parseSortKeyValue(target.value);
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-container-title' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.containerTitle = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-container-collapsed-preview-rem' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const value = Number.parseFloat(target.value);
      if (Number.isFinite(value) && value > 0) {
        context.block.schema.containerCollapsedPreviewRem = value;
        syncReusableTemplateForBlock(sectionKey, context.block.id);
        getRefreshReaderPanels()();
      }
      return;
    }

    if (field === 'block-container-expanded' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.containerExpanded = target.checked;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-component-list-default-view' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.componentListDefaultView = target.value.trim();
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-component-list-views' && target instanceof HTMLTextAreaElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const parsed = parseJsonArrayQuietly(target.value);
      if (!parsed) {
        return;
      }
      context.block.schema.componentListViews = parsed
        .map((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
          }
          const view = value as Record<string, unknown>;
          const id = typeof view.id === 'string' ? view.id.trim() : '';
          const sortKey = typeof view.sortKey === 'string' ? view.sortKey : '';
          if (!id || !sortKey) {
            return null;
          }
          const direction = view.direction === 'desc' ? 'desc' : 'asc';
          return {
            id,
            label: typeof view.label === 'string' && view.label.trim() ? view.label : id,
            sortKey,
            direction,
            groupKey: typeof view.groupKey === 'string' ? view.groupKey : '',
            groupDirection: view.groupDirection === 'asc' || view.groupDirection === 'desc' ? view.groupDirection : direction,
            groupCollapsedPreviewRem:
              typeof view.groupCollapsedPreviewRem === 'number' && Number.isFinite(view.groupCollapsedPreviewRem) && view.groupCollapsedPreviewRem > 0
                ? view.groupCollapsedPreviewRem
                : 3,
          };
        })
        .filter((view): view is typeof context.block.schema.componentListViews[number] => view !== null);
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
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
      context.block.schema.css = target.value;
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
      if (field === 'block-rich' || field === 'block-grid-rich' || field === 'table-details-rich' || field === 'table-cell' || field === 'table-column') {
        refreshRichToolbarState(target);
      }
      console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)), handledBy: 'block-field' });
      return;
    }
    console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)), handledBy: 'none' });
  });
}

function parseJsonObjectQuietly(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseJsonArrayQuietly(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseSortKeyValue(value: string): string | number {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return value;
}
