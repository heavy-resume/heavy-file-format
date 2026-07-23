import { state, incrementInputEventCount, getRenderApp, getRefreshReaderPanels, refreshReaderPanelsOutsideActiveEditor, handleTagEditorInput, findSectionByKey, getReusableNameFromSectionKey, resolveBlockContext, handleBlockFieldInput, refreshRichToolbarState, recordHistory, syncReusableTemplateForBlock, sanitizeOptionalId, tagStateHelpers, assignSectionTitleAndGeneratedId } from './_imports';
import { SCRIPTING_PLUGIN_ID } from '../../plugins/registry';
import { SCRIPTING_PLUGIN_VERSION } from '../../plugins/scripting/version';
import { SCRIPTING_LIBRARY_OPTIONS } from '../../plugins/scripting/wrapper';
import { addDefaultContainerBorderCss, removeDefaultContainerBorderCss } from '../../editor/components/container/container-css';
import { refreshSearchFilterButton, submitSearch } from '../../search/actions';
import { clearHideIfUnmodifiedForSectionPath } from '../../template-hide';
import { saveSessionState } from '../../state-persistence';
import { isPdfAllowedComponent, isPdfDocument } from '../../pdf-document-capabilities';
import { clearNextUndoTargetsDocument } from '../../edit-command-routing';
import { rememberEmptySectionHeadingLevel } from '../../section-heading-memory';
import { clearSortValueValidation } from '../../sort-value-validation';

const runButtonVisibilityScripts = async (root: ParentNode): Promise<void> => {
  const actions = await import('../../editor/components/button/button-actions');
  await actions.runButtonVisibilityScripts(root);
};

function isSearchQueryControl(target: HTMLElement): target is HTMLInputElement | HTMLTextAreaElement {
  return target.dataset.field === 'search-query'
    && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement);
}

export function bindInputMisc(app: HTMLElement): void {
  app.addEventListener('focusout', (event) => {
    const target = event.target as HTMLElement;
    if (!isSearchQueryControl(target)) {
      return;
    }
    window.setTimeout(() => {
      if (!state.search.open || state.search.resultsCollapsed) {
        return;
      }
      if (state.search.queryDraft.trim() === state.search.submittedQuery.trim()) {
        return;
      }
      if (state.search.activeTab === 'filter' && state.search.filterQueryMode === 'semantic') {
        return;
      }
      void submitSearch(app);
    }, 120);
  });

  app.addEventListener('input', (event) => {
    const rawTarget = event.target as HTMLElement;
    const target = rawTarget.dataset.field ? rawTarget : rawTarget.closest<HTMLElement>('[data-field]') ?? rawTarget;
    const validationBlock = rawTarget.closest<HTMLElement>('.editor-block');
    if (validationBlock && rawTarget.closest('[data-hvy-sort-value="true"]')) {
      clearSortValueValidation(validationBlock);
    }
    if (isSearchQueryControl(target)) {
      const hadFocus = document.activeElement === target;
      state.search.queryDraft = target.value;
      state.search.resultsCollapsed = false;
      if (state.search.isLoading || state.search.abortController) {
        state.search.abortController?.abort();
        state.search.abortController = null;
        state.search.requestNonce += 1;
        state.search.isLoading = false;
      }
      state.search.semanticProgress = null;
      app.querySelector<HTMLElement>('.search-semantic-progress')?.remove();
      const semanticStatus = app.querySelector<HTMLElement>('.search-filter-panel .search-status');
      if (semanticStatus && state.search.activeTab === 'filter' && state.search.filterQueryMode === 'semantic') {
        semanticStatus.textContent = '';
        semanticStatus.classList.remove('is-error', 'is-empty');
      }
      refreshSearchFilterButton(app);
      if (hadFocus && document.activeElement !== target) {
        target.focus({ preventScroll: true });
      }
      return;
    }
    if (handleTagEditorInput(target, tagStateHelpers)) {
      if (target.dataset.field === 'search-exclude-tags-input') {
        refreshSearchFilterButton(app);
      }
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
      if (isPdfDocument(state.document) && !isPdfAllowedComponent(target.value, state.document.meta)) {
        return;
      }
      state.addComponentBySection[sectionKey] = target.value;
      console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)) });
      return;
    }
    if (field === 'empty-section-heading-level' && target instanceof HTMLSelectElement) {
      rememberEmptySectionHeadingLevel(sectionKey, target.value);
      console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)) });
      return;
    }
    if (field === 'new-grid-component-type' && target instanceof HTMLSelectElement) {
      if (isPdfDocument(state.document) && !isPdfAllowedComponent(target.value, state.document.meta)) {
        return;
      }
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
      clearHideIfUnmodifiedForSectionPath(state.document.sections, sectionKey);
    }

    if (field === 'section-title' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      assignSectionTitleAndGeneratedId(state.document.sections, section, target.value);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'section-custom-id' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.customId = sanitizeOptionalId(target.value);
      section.customIdGenerated = false;
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'section-description' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      if (!section) {
        return;
      }
      section.description = target.value;
      syncGenerateDescriptionButton(target, 'generate-section-description', {
        sectionKey,
      });
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

    if (field === 'section-priority' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.priority = target.checked;
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'section-editor-only' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.editorOnly = target.checked;
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }

    if (field === 'section-exclude-from-import' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.exclude_from_import = target.checked;
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
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-show-copy' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.showCopy = target.checked;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-lock' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.lock = target.checked;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
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

    if (field === 'component-list-group-preview-rem' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const value = Number.parseFloat(target.value);
      if (Number.isFinite(value) && value > 0) {
        context.block.schema.componentListGroupCollapsedPreviewRem = value;
        syncReusableTemplateForBlock(sectionKey, context.block.id);
        getRefreshReaderPanels()();
      }
      return;
    }

    if (field === 'component-list-groups-expanded' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.componentListGroupsExpanded = target.checked;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
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
      const keyMap = target.dataset.displayKeyKind === 'group' ? context.block.schema.groupKeys : context.block.schema.sortKeys;
      const oldName = target.dataset.sortKeyName ?? '';
      const newName = target.value.trim();
      const hasOldKey = oldName && Object.prototype.hasOwnProperty.call(keyMap, oldName);
      if (hasOldKey && newName && oldName !== newName) {
        const oldValue = keyMap[oldName];
        delete keyMap[oldName];
        keyMap[newName] = oldValue ?? '';
        target.dataset.sortKeyName = newName;
        target.dataset.sortKeyPresent = 'true';
        updateSortKeyRowName(target, newName);
      } else if (!hasOldKey && newName) {
        target.dataset.sortKeyName = newName;
        updateSortKeyRowName(target, newName);
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
      const isGroupKey = target.dataset.displayKeyKind === 'group';
      const keyMap = isGroupKey ? context.block.schema.groupKeys : context.block.schema.sortKeys;
      const name = target.dataset.sortKeyName ?? '';
      if (!name) {
        return;
      }
      keyMap[name] = isGroupKey ? target.value : parseSortKeyValue(target.value);
      const nameInput = target.parentElement?.querySelector<HTMLInputElement>('[data-field="block-sort-key-name"]');
      if (nameInput) {
        nameInput.dataset.sortKeyPresent = 'true';
      }
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
      refreshReaderPanelsOutsideActiveEditor(target);
      return;
    }

    if (field === 'block-container-border' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.css = target.checked
        ? addDefaultContainerBorderCss(context.block.schema.css)
        : removeDefaultContainerBorderCss(context.block.schema.css);
      if (!target.checked) {
        context.block.schema.containerExpanded = false;
      }
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      getRenderApp()();
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
        refreshReaderPanelsOutsideActiveEditor(target);
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
      refreshReaderPanelsOutsideActiveEditor(target);
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
      syncGenerateDescriptionButton(target, 'generate-block-description', {
        sectionKey,
        blockId: block.id,
      });
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
      refreshReaderPanelsOutsideActiveEditor(target);
      return;
    }

    if (field === 'block-plugin-scripting-max-steps' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      if (block.schema.component !== 'plugin' || block.schema.plugin !== SCRIPTING_PLUGIN_ID) {
        return;
      }
      const parsed = Number.parseInt(target.value, 10);
      block.schema.pluginConfig = {
        ...block.schema.pluginConfig,
        maxSteps: Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 100_000,
      };
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-plugin-scripting-library' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      if (block.schema.component !== 'plugin' || block.schema.plugin !== SCRIPTING_PLUGIN_ID) {
        return;
      }
      const library = target.dataset.library ?? '';
      if (!(SCRIPTING_LIBRARY_OPTIONS as readonly string[]).includes(library)) {
        return;
      }
      const current = Array.isArray(block.schema.pluginConfig.libraries)
        ? block.schema.pluginConfig.libraries.filter((item): item is string => typeof item === 'string')
        : [];
      const next = new Set(current);
      if (target.checked) {
        next.add(library);
      } else {
        next.delete(library);
      }
      block.schema.pluginConfig = {
        ...block.schema.pluginConfig,
        libraries: SCRIPTING_LIBRARY_OPTIONS.filter((name) => next.has(name)),
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

    if (field === 'block-visible-script' && target instanceof HTMLTextAreaElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.visibleScript = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      void runButtonVisibilityScripts(app);
      return;
    }

    if (field === 'block-hide-if-yes' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.hideIfYes = target.checked ? 'yes' : '';
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'block-editor-only' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.editorOnly = target.checked;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }

    if (field?.startsWith('block-button-') && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      if (field === 'block-button-label') block.schema.buttonLabel = target.value;
      if (field === 'block-button-position-target-id') block.schema.buttonPositionTargetId = target.value;
      if (field === 'block-button-css') block.schema.buttonCss = target.value;
      if (field === 'block-button-visible-script') block.schema.buttonVisibleScript = target.value;
      if (field === 'block-button-source-script') block.schema.buttonSourceScript = target.value;
      if (field === 'block-button-prompt') block.schema.buttonPrompt = target.value;
      if (field === 'block-button-target-script') block.schema.buttonTargetScript = target.value;
      if (field === 'block-button-input-char-limit') {
        const value = Number.parseInt(target.value, 10);
        if (Number.isFinite(value) && value > 0) block.schema.buttonInputCharLimit = value;
      }
      if (field === 'block-button-output-char-limit') {
        const value = Number.parseInt(target.value, 10);
        if (Number.isFinite(value) && value > 0) block.schema.buttonOutputCharLimit = value;
      }
      syncReusableTemplateForBlock(sectionKey, block.id);
      refreshReaderPanelsOutsideActiveEditor(target);
      void runButtonVisibilityScripts(app);
      return;
    }

    if (field === 'block-expandable-stub-css' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.expandableStubCss = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      refreshReaderPanelsOutsideActiveEditor(target);
      return;
    }

    if (field === 'block-expandable-stub-description' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.expandableStubDescription = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      syncGenerateDescriptionButton(target, 'generate-expandable-pane-description', {
        sectionKey,
        blockId: context.block.id,
        expandablePane: 'stub',
      });
      return;
    }

    if (field === 'block-expandable-content-css' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.expandableContentCss = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      refreshReaderPanelsOutsideActiveEditor(target);
      return;
    }

    if (field === 'block-expandable-content-description' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.expandableContentDescription = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      syncGenerateDescriptionButton(target, 'generate-expandable-pane-description', {
        sectionKey,
        blockId: context.block.id,
        expandablePane: 'expanded',
      });
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
      clearNextUndoTargetsDocument();
      saveSessionState(state);
      if (field === 'block-rich' || field === 'text-fill-in-rich' || field === 'block-grid-rich' || field === 'table-details-rich' || field === 'caption-rich' || field === 'table-cell' || field === 'table-column') {
        refreshRichToolbarState(target);
      }
      void runButtonVisibilityScripts(app);
      console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)), handledBy: 'block-field' });
      return;
    }
    console.debug('[hvy:perf] input:end', { eventId, field, elapsedMs: Number((performance.now() - startedAt).toFixed(2)), handledBy: 'none' });
  });
}

function syncGenerateDescriptionButton(
  input: HTMLInputElement | HTMLTextAreaElement,
  action: string,
  dataset: { sectionKey: string; blockId?: string; expandablePane?: string }
): void {
  const label = input.closest('label');
  const labelText = label?.querySelector<HTMLElement>('.description-label-with-action');
  if (!labelText) {
    return;
  }
  const existingButton = labelText.querySelector<HTMLButtonElement>('.inline-generate-description');
  if (input.value.trim()) {
    existingButton?.remove();
    return;
  }
  if (existingButton) {
    existingButton.textContent = 'Generate';
    existingButton.disabled = false;
    existingButton.removeAttribute('title');
    return;
  }
  labelText.append(' ');
  const button = input.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'ghost inline-generate-description';
  button.dataset.action = action;
  button.dataset.sectionKey = dataset.sectionKey;
  if (dataset.blockId) {
    button.dataset.blockId = dataset.blockId;
  }
  if (dataset.expandablePane) {
    button.dataset.expandablePane = dataset.expandablePane;
  }
  button.textContent = 'Generate';
  labelText.append(button);
}

function parseJsonObjectQuietly(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
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

function updateSortKeyRowName(target: HTMLInputElement, name: string): void {
  const valueInput = target.parentElement?.querySelector<HTMLInputElement>('[data-field="block-sort-key-value"]');
  if (valueInput) {
    valueInput.dataset.sortKeyName = name;
  }
  const removeButton = target.parentElement?.querySelector<HTMLElement>('[data-action="remove-block-display-key"]');
  if (removeButton) {
    removeButton.dataset.sortKeyName = name;
  }
}
