import bundledResumeThvy from '../examples/resume.thvy?raw';
import bundledResumeHvy from '../examples/resume.hvy?raw';
import {
  state, appEventsBound, shortcutsBound,
  setAppEventsBound, setShortcutsBound,
  setDraggedSectionKey, setDraggedTableItem,
  draggedSectionKey, draggedTableItem,
  incrementInputEventCount, getRenderApp, getRefreshReaderPanels,
} from './state';
import {
  commitTagEditorDraft,
  handleRemoveTag,
  handleTagEditorInput,
  handleTagEditorKeydown,
} from './editor/tag-editor';
import { getThemeConfig, applyTheme, writeThemeConfig } from './theme';
import { findSectionByKey, getSectionId, isDefaultUntitledSectionTitle } from './section-ops';
import { getComponentDefs, getSectionDefs, getReusableNameFromSectionKey, isBuiltinComponent, resolveBaseComponent } from './component-defs';
import {
  findBlockByIds, resolveBlockContext, handleBlockFieldInput, commitInlineTableEdit,
  setActiveEditorBlock, clearActiveEditorBlock, deactivateEditorBlock,
  applyRichAction, moveBlockByOffset,
  getTagState, setTagState, getTagRenderOptions,
} from './block-ops';
import {
  createEmptyBlock, createEmptySection, createDefaultTableRow, instantiateReusableSection,
  ensureContainerBlocks, ensureComponentListBlocks, ensureExpandableBlocks, ensureGridItems,
  coerceAlign,
} from './document-factory';
import { recordHistory, undoState, redoState } from './history';
import { navigateToSection, setSidebarOpen, setEditorSidebarOpen, closeModal, closeModalIfTarget, resetTransientUiState, resetToBlankDocument } from './navigation';
import { deserializeDocument } from './serialization';
import { serializeDocument } from './serialization';
import { syncReusableTemplateForBlock, revertReusableComponent, findReusableOwner } from './reusable';
import { addTableColumn, removeTableColumn, getTableColumns, moveTableColumn, moveTableRow } from './table-ops';
import { coerceGridColumns, coerceGridColumn, createGridItem } from './grid-ops';
import { detectExtension, normalizeFilename, downloadTextFile, sanitizeOptionalId, moveItem } from './utils';
import { moveSectionRelative, moveSectionByOffset, removeSectionByKey, findBlockContainerById } from './section-ops';
import { bindModal } from './bind-modal';
import { bindLinkInlineModal, openLinkInlineModal } from './bind-link-modal';
import { removeBlockFromList, findBlockInList } from './block-ops';
import { getReusableTemplateByName } from './document-factory';

export function bindUi(app: HTMLElement): void {
  const newBtn = app.querySelector<HTMLButtonElement>('#newBtn');
  const fileInput = app.querySelector<HTMLInputElement>('#fileInput');
  const downloadBtn = app.querySelector<HTMLButtonElement>('#downloadBtn');
  const downloadName = app.querySelector<HTMLInputElement>('#downloadName');
  const readerDocument = app.querySelector<HTMLDivElement>('#readerDocument');
  const readerSidebarSections = app.querySelector<HTMLDivElement>('#readerSidebarSections');
  const readerNav = app.querySelector<HTMLDivElement>('#readerNav');

  if (!newBtn || !fileInput || !downloadBtn || !downloadName) {
    throw new Error('Missing UI elements for binding.');
  }

  const tagStateHelpers = {
    getTagState,
    setTagState,
    getRenderOptions: getTagRenderOptions,
  };

  newBtn.addEventListener('click', () => {
    resetToBlankDocument();
  });

  const resumeTemplateBtn = app.querySelector<HTMLButtonElement>('#resumeTemplateBtn');
  resumeTemplateBtn?.addEventListener('click', () => {
    state.document = deserializeDocument(bundledResumeThvy, '.thvy');
    state.filename = 'resume.thvy';
    state.history = [];
    state.future = [];
    resetTransientUiState();
    getRenderApp()();
  });

  const resumeExampleBtn = app.querySelector<HTMLButtonElement>('#resumeExampleBtn');
  resumeExampleBtn?.addEventListener('click', () => {
    state.document = deserializeDocument(bundledResumeHvy, '.hvy');
    state.filename = 'resume.hvy';
    state.history = [];
    state.future = [];
    resetTransientUiState();
    getRenderApp()();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    state.filename = file.name;
    state.document = deserializeDocument(text, detectExtension(file.name, text));
    closeModal();
    resetTransientUiState();
    getRenderApp()();
  });

  downloadName.addEventListener('input', () => {
    state.filename = downloadName.value;
  });

  downloadBtn.addEventListener('click', () => {
    const normalized = normalizeFilename(state.filename || 'document.hvy');
    state.filename = normalized;
    const text = serializeDocument(state.document);
    downloadTextFile(normalized, text);
    getRenderApp()();
  });

  if (!appEventsBound) {
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

    if (field === 'meta-sidebar-label' && target instanceof HTMLInputElement) {
      recordHistory('meta:sidebar-label');
      if (target.value.trim().length > 0) {
        state.document.meta.sidebar_label = target.value;
      } else {
        delete state.document.meta.sidebar_label;
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
  });

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>('[data-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    if (!action) {
      return;
    }
    const sectionKey = actionButton.dataset.sectionKey ?? '';
    const blockId = actionButton.dataset.blockId ?? '';

    if (action === 'undo') {
      undoState();
      return;
    }

    if (action === 'switch-view') {
      const view = actionButton.dataset.view === 'viewer' ? 'viewer' : 'editor';
      state.currentView = view;
      getRenderApp()();
      return;
    }

    if (action === 'set-editor-mode') {
      state.showAdvancedEditor = actionButton.dataset.editorMode === 'advanced';
      if (!state.showAdvancedEditor) {
        state.metaPanelOpen = false;
      }
      state.activeEditorSectionTitleKey = null;
      getRenderApp()();
      return;
    }

    if (action === 'toggle-document-meta') {
      state.metaPanelOpen = !state.metaPanelOpen;
      getRenderApp()();
      return;
    }

    if (action === 'open-theme-modal') {
      state.themeModalOpen = true;
      getRenderApp()();
      return;
    }

    if (action === 'theme-add-color') {
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
      return;
    }

    if (action === 'theme-remove-color') {
      const name = actionButton.dataset.colorName ?? '';
      if (!name) return;
      recordHistory(`meta:theme-color-remove:${name}`);
      const theme = getThemeConfig();
      delete theme.colors[name];
      writeThemeConfig(theme);
      applyTheme();
      getRenderApp()();
      return;
    }

    if (action === 'theme-reset-color') {
      const name = actionButton.dataset.colorName ?? '';
      if (!name) return;
      recordHistory(`meta:theme-color-reset:${name}`);
      const theme = getThemeConfig();
      delete theme.colors[name];
      writeThemeConfig(theme);
      applyTheme();
      getRenderApp()();
      return;
    }

    if (action === 'toggle-viewer-sidebar') {
      setSidebarOpen(app, !state.viewerSidebarOpen);
      return;
    }

    if (action === 'toggle-editor-sidebar') {
      setEditorSidebarOpen(app, !state.editorSidebarOpen);
      return;
    }

    if (action === 'activate-block' && blockId) {
      event.stopPropagation();
      setActiveEditorBlock(sectionKey, blockId);
      getRenderApp()();
      return;
    }

    if (action === 'activate-section-title' && sectionKey) {
      event.stopPropagation();
      state.activeEditorSectionTitleKey = sectionKey;
      const section = findSectionByKey(state.document.sections, sectionKey);
      state.clearSectionTitleOnFocusKey = section && isDefaultUntitledSectionTitle(section.title) ? sectionKey : null;
      getRenderApp()();
      return;
    }

    if (action === 'deactivate-block' && blockId) {
      event.stopPropagation();
      deactivateEditorBlock(sectionKey, blockId);
      getRenderApp()();
      return;
    }

    if (action === 'toggle-editor-expandable' && sectionKey && blockId) {
      event.stopPropagation();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      block.schema.expandableExpanded = !block.schema.expandableExpanded;
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }

    if (action === 'toggle-expandable-editor-panel' && sectionKey && blockId) {
      event.stopPropagation();
      const panel = actionButton.dataset.expandablePanel === 'stub' ? 'stub' : 'expanded';
      const key = `${sectionKey}:${blockId}`;
      const current = state.expandableEditorPanels[key] ?? { stubOpen: false, expandedOpen: false };
      state.expandableEditorPanels[key] = {
        ...current,
        [panel === 'stub' ? 'stubOpen' : 'expandedOpen']: !current[panel === 'stub' ? 'stubOpen' : 'expandedOpen'],
      };
      getRenderApp()();
      return;
    }

    if (action === 'redo') {
      redoState();
      return;
    }

    if (action === 'add-component-def') {
      recordHistory();
      const defs = getComponentDefs();
      defs.push({
        name: `component-${defs.length + 1}`,
        baseType: 'text',
        tags: '',
        description: '',
      });
      state.document.meta.component_defs = defs;
      getRenderApp()();
      return;
    }

    if (action === 'remove-component-def') {
      recordHistory();
      const defIndex = Number.parseInt(actionButton.dataset.defIndex ?? '', 10);
      if (Number.isNaN(defIndex)) {
        return;
      }
      const defs = getComponentDefs();
      const [removed] = defs.splice(defIndex, 1);
      if (removed) {
        revertReusableComponent(removed);
      }
      state.document.meta.component_defs = defs;
      if (state.selectedReusableComponentName === removed?.name) {
        state.selectedReusableComponentName = defs[0]?.name ?? null;
      }
      getRenderApp()();
      return;
    }

    if (action === 'remove-section-def') {
      recordHistory();
      const defIndex = Number.parseInt(actionButton.dataset.sectionDefIndex ?? '', 10);
      if (Number.isNaN(defIndex)) {
        return;
      }
      const defs = getSectionDefs();
      if (!defs[defIndex]) {
        return;
      }
      defs.splice(defIndex, 1);
      state.document.meta.section_defs = defs;
      getRenderApp()();
      return;
    }

    if (action === 'open-save-component-def') {
      const sectionKey = actionButton.dataset.sectionKey;
      const blockId = actionButton.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      state.reusableSaveModal = {
        kind: 'component',
        sectionKey,
        blockId,
        draftName: isBuiltinComponent(block.schema.component) ? '' : block.schema.component,
      };
      getRenderApp()();
      return;
    }

    if (action === 'open-save-section-def') {
      const sectionKey = actionButton.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      if (!section) {
        return;
      }
      state.reusableSaveModal = {
        kind: 'section',
        sectionKey,
        draftName: isDefaultUntitledSectionTitle(section.title) ? '' : section.title.trim(),
      };
      getRenderApp()();
      return;
    }

    if (action === 'focus-schema-component') {
      if (target.closest('select, input, button, textarea, label')) {
        return;
      }
      const select = actionButton.querySelector<HTMLSelectElement>('[data-field="block-component"]');
      select?.focus();
      select?.click();
      return;
    }

    if (action === 'remove-tag') {
      handleRemoveTag(actionButton, tagStateHelpers);
      return;
    }

    if (action === 'add-template-field') {
      recordHistory();
      const field = actionButton.dataset.templateField;
      if (!field) {
        return;
      }
      const newSection = createEmptySection(1, 'text');
      newSection.title = field;
      if (newSection.blocks[0]) {
        newSection.blocks[0].text = `{{${field}}}`;
        setActiveEditorBlock(newSection.key, newSection.blocks[0].id);
      }
      state.document.sections.push(newSection);
      getRenderApp()();
      return;
    }

  });

  if (!shortcutsBound) {
    window.addEventListener('keydown', (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoState();
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redoState();
      }
    });
    setShortcutsBound(true);
  }

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('select') || target.closest('input')) {
      return;
    }

    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    if (richButton) {
      event.preventDefault();
      const sectionKey = richButton.dataset.sectionKey;
      const blockId = richButton.dataset.blockId;
      const action = richButton.dataset.richAction;
      const richField = richButton.dataset.richField ?? 'block-rich';
      const gridItemId = richButton.dataset.gridItemId;
      const rowIndex = richButton.dataset.rowIndex;
      if (sectionKey && blockId && action) {
        const selectorBase = `[data-section-key="${sectionKey}"][data-block-id="${blockId}"][data-field="${richField}"]`;
        const editable = rowIndex
          ? app.querySelector<HTMLElement>(`${selectorBase}[data-row-index="${rowIndex}"]`)
          : gridItemId
          ? app.querySelector<HTMLElement>(`${selectorBase}[data-grid-item-id="${gridItemId}"]`)
          : app.querySelector<HTMLElement>(selectorBase);
        if (editable) {
          if (action === 'link') {
            openLinkInlineModal(app, editable);
            return;
          }
          editable.focus();
          applyRichAction(action, editable);
        }
      }
      return;
    }

    const actionButton = target.closest<HTMLElement>('[data-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    const sectionKey = actionButton.dataset.sectionKey;
    const blockId = actionButton.dataset.blockId;

    if (!action) {
      return;
    }

    if (action === 'add-top-level-section') {
      recordHistory();
      const starter = state.addComponentBySection.__top_level__ ?? 'blank';
      const section = starter === 'blank' ? createEmptySection(1, '', false) : instantiateReusableSection(starter, 1);
      if (!section) {
        return;
      }
      state.document.sections.push(section);
      if (section.blocks[0]) {
        setActiveEditorBlock(section.key, section.blocks[0].id);
      } else {
        state.activeEditorSectionTitleKey = section.key;
        state.clearSectionTitleOnFocusKey = isDefaultUntitledSectionTitle(section.title) ? section.key : null;
      }
      getRenderApp()();
      return;
    }

    if (!sectionKey) {
      return;
    }

    const reusableName = getReusableNameFromSectionKey(sectionKey);
    const section = reusableName ? null : findSectionByKey(state.document.sections, sectionKey);
    if (!section && !reusableName) {
      return;
    }

    if (action === 'spawn-child-ghost') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      getRenderApp()();
      return;
    }

    if (action === 'spawn-block-ghost') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      getRenderApp()();
      return;
    }

    if (action === 'add-subsection') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const starter = state.addComponentBySection[`subsection:${section.key}`] ?? 'blank';
      const child =
        starter === 'blank' ? createEmptySection(Math.min(section.level + 1, 6), '', false) : instantiateReusableSection(starter, Math.min(section.level + 1, 6));
      if (!child) {
        return;
      }
      section.children.push(child);
      if (child.blocks[0]) {
        setActiveEditorBlock(child.key, child.blocks[0].id);
      } else {
        state.activeEditorSectionTitleKey = child.key;
        state.clearSectionTitleOnFocusKey = isDefaultUntitledSectionTitle(child.title) ? child.key : null;
      }
      getRenderApp()();
      return;
    }

    if (action === 'toggle-section-location') {
      if (!section) {
        return;
      }
      recordHistory();
      section.location = section.location === 'sidebar' ? 'main' : 'sidebar';
      getRenderApp()();
      return;
    }

    if (action === 'remove-section') {
      if (!section) {
        return;
      }
      recordHistory();
      removeSectionByKey(state.document.sections, sectionKey);
      closeModalIfTarget(sectionKey);
      if (state.activeEditorSectionTitleKey === sectionKey) {
        state.activeEditorSectionTitleKey = null;
      }
      if (state.activeEditorBlock?.sectionKey === sectionKey) {
        state.activeEditorBlock = null;
      }
      getRenderApp()();
      return;
    }

    if (action === 'move-section-up') {
      if (!section) {
        return;
      }
      recordHistory();
      if (moveSectionByOffset(state.document.sections, sectionKey, -1)) {
        getRenderApp()();
      }
      return;
    }

    if (action === 'move-section-down') {
      if (!section) {
        return;
      }
      recordHistory();
      if (moveSectionByOffset(state.document.sections, sectionKey, 1)) {
        getRenderApp()();
      }
      return;
    }

    if (action === 'add-child') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, true);
      section.children.push(child);
      if (child.blocks[0]) {
        setActiveEditorBlock(child.key, child.blocks[0].id);
      }
      getRenderApp()();
      return;
    }

    if (action === 'add-block') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = (state.addComponentBySection[section.key] ?? 'text').trim() || 'text';
      const newBlock = createEmptyBlock(component);
      section.blocks.push(newBlock);
      setActiveEditorBlock(section.key, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-component-list-item' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      ensureComponentListBlocks(block);
      const newBlock = createEmptyBlock(block.schema.componentListComponent || 'text');
      block.schema.componentListBlocks.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-container-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      ensureContainerBlocks(block);
      const addKey = `container:${sectionKey}:${blockId}`;
      const newBlock = createEmptyBlock(state.addComponentBySection[addKey] ?? 'text');
      block.schema.containerBlocks.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-expandable-stub-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.expandableStubBlocks.lock) {
        return;
      }
      ensureExpandableBlocks(block);
      const addKey = `expandable-stub:${sectionKey}:${blockId}`;
      const newBlock = createEmptyBlock(state.addComponentBySection[addKey] ?? 'container');
      block.schema.expandableStubBlocks.children.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-expandable-content-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.expandableContentBlocks.lock) {
        return;
      }
      ensureExpandableBlocks(block);
      const addKey = `expandable-content:${sectionKey}:${blockId}`;
      const newBlock = createEmptyBlock(state.addComponentBySection[addKey] ?? 'container');
      block.schema.expandableContentBlocks.children.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'toggle-schema' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      if (!block) {
        return;
      }
      block.schemaMode = !block.schemaMode;
      getRenderApp()();
      return;
    }

    if (action === 'set-block-align' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      if (!block) {
        return;
      }
      block.schema.align = coerceAlign(actionButton.dataset.alignValue ?? 'left');
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }

    if (action === 'remove-block' && blockId) {
      recordHistory();
      const reusableOwnerId = findReusableOwner(sectionKey, blockId)?.id ?? null;
      // Find parent before removal so we can restore edit mode if the deleted block
      // was the active one OR contained the active one (otherwise deletion would
      // exit edit mode entirely when removing a parent while a child is active).
      const activeBlockId = state.activeEditorBlock?.sectionKey === sectionKey
        ? (state.activeEditorBlock?.blockId ?? null)
        : null;
      const removedBlock = activeBlockId ? findBlockByIds(sectionKey, blockId) : null;
      const activeIsAffected = activeBlockId !== null && (
        activeBlockId === blockId ||
        (removedBlock !== null && findBlockInList([removedBlock], activeBlockId) !== null)
      );
      const parentId = activeIsAffected
        ? findBlockContainerById(state.document.sections, sectionKey, blockId)?.ownerBlockId ?? null
        : null;
      if (section) {
        removeBlockFromList(section.blocks, blockId);
      } else {
        const template = reusableName ? getReusableTemplateByName(reusableName) : null;
        if (template) {
          removeBlockFromList([template], blockId);
        }
      }
      syncReusableTemplateForBlock(sectionKey, reusableOwnerId ?? blockId);
      if (activeIsAffected && activeBlockId) {
        clearActiveEditorBlock(activeBlockId);
      }
      if (parentId) {
        setActiveEditorBlock(sectionKey, parentId);
      }
      getRenderApp()();
      return;
    }

    if (action === 'move-block-up' && blockId) {
      recordHistory();
      if (moveBlockByOffset(sectionKey, blockId, -1)) {
        getRenderApp()();
      }
      return;
    }

    if (action === 'move-block-down' && blockId) {
      recordHistory();
      if (moveBlockByOffset(sectionKey, blockId, 1)) {
        getRenderApp()();
      }
      return;
    }

    if (action === 'add-table-row' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      const columnCount = getTableColumns(block.schema).length;
      block.schema.tableRows.push(createDefaultTableRow(columnCount));
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-table-column' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      addTableColumn(block.schema);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'remove-table-column' && blockId) {
      recordHistory();
      const columnIndex = Number.parseInt(actionButton.dataset.columnIndex ?? '', 10);
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock || Number.isNaN(columnIndex)) {
        return;
      }
      removeTableColumn(block.schema, columnIndex);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'remove-table-row' && blockId) {
      recordHistory();
      const rowIndex = Number.parseInt(actionButton.dataset.rowIndex ?? '', 10);
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || Number.isNaN(rowIndex)) {
        return;
      }
      block.schema.tableRows.splice(rowIndex, 1);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'focus-modal') {
      state.modalSectionKey = sectionKey;
      getRenderApp()();
      return;
    }

    if (action === 'open-component-meta' && blockId) {
      state.componentMetaModal = { sectionKey, blockId };
      getRenderApp()();
      return;
    }

    if (action === 'add-grid-item' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      if (!block || block.schema.lock) {
        return;
      }
      ensureGridItems(block.schema);
      const item = createGridItem(block.schema.gridItems.length, block.schema.gridColumns, (c, _s) => createEmptyBlock(c, true));
      item.block = createEmptyBlock(state.gridAddComponentByBlock[blockId] ?? 'text');
      block.schema.gridItems.push(item);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'remove-grid-item' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      const gridItemId = actionButton.dataset.gridItemId;
      if (!block || !gridItemId) {
        return;
      }
      block.schema.gridItems = block.schema.gridItems.filter((item) => item.id !== gridItemId);
      syncReusableTemplateForBlock(sectionKey, block.id);
      ensureGridItems(block.schema);
      getRenderApp()();
      return;
    }

    if ((action === 'move-grid-item-up' || action === 'move-grid-item-down') && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      const gridItemId = actionButton.dataset.gridItemId;
      if (!block || !gridItemId) {
        return;
      }
      const currentIndex = block.schema.gridItems.findIndex((item) => item.id === gridItemId);
      if (currentIndex < 0) {
        return;
      }
      const nextIndex = action === 'move-grid-item-up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= block.schema.gridItems.length) {
        return;
      }
      block.schema.gridItems = moveItem(block.schema.gridItems, currentIndex, nextIndex);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'realize-ghost') {
      if (!section) {
        return;
      }
      recordHistory();
      section.isGhost = false;
      getRenderApp()();
      return;
    }

    if (action === 'jump-to-reader') {
      if (!section) {
        return;
      }
      navigateToSection(getSectionId(section), app);
    }
  });

  app.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && handleTagEditorKeydown(event, target, tagStateHelpers)) {
      return;
    }
    if (target.dataset.inlineText === 'true' && event.key === 'Enter') {
      event.preventDefault();
      return;
    }

    if (
      target.dataset.field !== 'block-rich' &&
      target.dataset.field !== 'block-grid-rich' &&
      target.dataset.field !== 'table-details-rich'
    ) {
      return;
    }

    const meta = event.metaKey || event.ctrlKey;
    if (!meta) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      applyRichAction('bold', target);
      return;
    }

    if (key === 'i') {
      event.preventDefault();
      applyRichAction('italic', target);
      return;
    }

    if (key === 'k') {
      event.preventDefault();
      openLinkInlineModal(app, target);
    }
  });

  app.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest<HTMLAnchorElement>('.rich-editor a[href]');
    if (!anchor) {
      return;
    }
    const editable = anchor.closest<HTMLElement>('.rich-editor');
    if (!editable) {
      return;
    }
    event.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(anchor);
    openLinkInlineModal(app, editable, anchor.getAttribute('href') ?? '', range, anchor);
  });

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

  app.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.field !== 'table-cell' && target.dataset.field !== 'table-column') {
      return;
    }
    const sectionKey = target.dataset.sectionKey ?? '';
    const blockId = target.dataset.blockId ?? '';
    const rowIndex = target.dataset.rowIndex ?? '';
    const cellIndex = target.dataset.cellIndex ?? '';
    const columnIndex = target.dataset.columnIndex ?? '';
    recordHistory(`table-edit:${sectionKey}:${blockId}:${rowIndex}:${cellIndex}:${columnIndex}`);
  });

  app.addEventListener('focusout', (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.field === 'table-cell' || target.dataset.field === 'table-column') {
      commitInlineTableEdit(target);
    }
    if (target instanceof HTMLInputElement) {
      commitTagEditorDraft(target, tagStateHelpers);
      if (target.dataset.field === 'section-title') {
        const sectionKey = target.dataset.sectionKey;
        const section = sectionKey ? findSectionByKey(state.document.sections, sectionKey) : null;
        if (section && target.value.trim().length === 0) {
          section.title = 'Unnamed Section';
        }
        state.activeEditorSectionTitleKey = null;
        state.clearSectionTitleOnFocusKey = null;
        getRenderApp()();
      }
    }
  });

  app.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement;
    const sectionHandle = target.closest<HTMLElement>('[data-drag-handle="section"]');
    if (sectionHandle) {
      setDraggedSectionKey(sectionHandle.dataset.sectionKey ?? null);
      event.dataTransfer?.setData('text/plain', draggedSectionKey ?? '');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
      return;
    }

    const tableRowHandle = target.closest<HTMLElement>('[data-drag-handle="table-row"]');
    if (tableRowHandle) {
      const sectionKey = tableRowHandle.dataset.sectionKey;
      const blockId = tableRowHandle.dataset.blockId;
      const index = Number.parseInt(tableRowHandle.dataset.rowIndex ?? '', 10);
      if (!sectionKey || !blockId || Number.isNaN(index)) {
        return;
      }
      setDraggedTableItem({ kind: 'row', sectionKey, blockId, index });
      event.dataTransfer?.setData('text/plain', `${blockId}:${index}`);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
      return;
    }

    const tableColumnHandle = target.closest<HTMLElement>('[data-drag-handle="table-column"]');
    if (tableColumnHandle) {
      const sectionKey = tableColumnHandle.dataset.sectionKey;
      const blockId = tableColumnHandle.dataset.blockId;
      const index = Number.parseInt(tableColumnHandle.dataset.columnIndex ?? '', 10);
      if (!sectionKey || !blockId || Number.isNaN(index)) {
        return;
      }
      setDraggedTableItem({ kind: 'column', sectionKey, blockId, index });
      event.dataTransfer?.setData('text/plain', `${blockId}:${index}`);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    }
  });

  app.addEventListener('dragover', (event) => {
    const target = event.target as HTMLElement;
    if (draggedSectionKey && target.closest<HTMLElement>('[data-editor-section]')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      return;
    }

    if (draggedTableItem?.kind === 'row' && target.closest<HTMLElement>('[data-table-row-drop]')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      return;
    }

    if (draggedTableItem?.kind === 'column' && target.closest<HTMLElement>('[data-table-column-drop]')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    }
  });

  app.addEventListener('drop', (event) => {
    const target = event.target as HTMLElement;

    if (draggedSectionKey) {
      const sectionCard = target.closest<HTMLElement>('[data-editor-section]');
      const targetKey = sectionCard?.dataset.editorSection;
      if (!sectionCard || !targetKey) {
        setDraggedSectionKey(null);
        return;
      }
      event.preventDefault();
      const bounds = sectionCard.getBoundingClientRect();
      const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
      recordHistory();
      if (moveSectionRelative(state.document.sections, draggedSectionKey, targetKey, position)) {
        getRenderApp()();
      }
      setDraggedSectionKey(null);
      return;
    }

    const activeTableDrag = draggedTableItem;
    if (!activeTableDrag) {
      return;
    }

    const section = findSectionByKey(state.document.sections, activeTableDrag.sectionKey);
    const block = section?.blocks.find((candidate) => candidate.id === activeTableDrag.blockId);
    if (!block) {
      setDraggedTableItem(null);
      return;
    }

    if (activeTableDrag.kind === 'row') {
      const rowDrop = target.closest<HTMLElement>('[data-table-row-drop]');
      const rowIndex = Number.parseInt(rowDrop?.dataset.rowIndex ?? '', 10);
      if (rowDrop && !Number.isNaN(rowIndex)) {
        event.preventDefault();
        recordHistory();
        moveTableRow(block.schema, activeTableDrag.index, rowIndex);
        getRenderApp()();
      }
      setDraggedTableItem(null);
      return;
    }

    const columnDrop = target.closest<HTMLElement>('[data-table-column-drop]');
    const columnIndex = Number.parseInt(columnDrop?.dataset.columnIndex ?? '', 10);
    if (columnDrop && !Number.isNaN(columnIndex)) {
      event.preventDefault();
      recordHistory();
      moveTableColumn(block.schema, activeTableDrag.index, columnIndex);
      getRenderApp()();
    }
    setDraggedTableItem(null);
  });

  app.addEventListener('dragend', () => {
    setDraggedSectionKey(null);
    setDraggedTableItem(null);
  });
  setAppEventsBound(true);
  }

  const handleReaderAreaClick = (event: Event) => {
    const target = event.target as HTMLElement;

    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      event.preventDefault();
      const id = anchor.getAttribute('href')?.slice(1) ?? '';
      navigateToSection(id, app);
      return;
    }

    const toggle = target.closest<HTMLElement>('[data-reader-action="toggle-expand"]');
    if (toggle) {
      event.stopPropagation();
      const sectionKey = toggle.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      if (!section) {
        return;
      }
      section.expanded = !section.expanded;
      getRefreshReaderPanels()();
      return;
    }

    const expandable = target.closest<HTMLElement>('[data-reader-action="toggle-expandable"]');
    if (expandable) {
      // When clicking inside the content area, guard against interactive descendants
      if (expandable.dataset.expandableContent === 'true' && target.closest('a, button, input, select, textarea')) {
        return;
      }
      event.stopPropagation();
      const sectionKey = expandable.dataset.sectionKey;
      const blockId = expandable.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      const willCollapse = block.schema.expandableExpanded;
      if (willCollapse) {
        // Animate collapse before re-rendering
        const readerEl = app.querySelector<HTMLElement>(`[data-expandable-id="${CSS.escape(blockId)}"]`);
        readerEl?.classList.add('is-collapsing');
        window.setTimeout(() => {
          block.schema.expandableExpanded = false;
          getRefreshReaderPanels()();
        }, 160);
      } else {
        block.schema.expandableExpanded = true;
        getRefreshReaderPanels()();
      }
    }
  };

  readerDocument?.addEventListener('click', handleReaderAreaClick);
  readerSidebarSections?.addEventListener('click', handleReaderAreaClick);

  readerNav?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const nav = target.closest<HTMLElement>('[data-nav-id]');
    if (!nav) {
      return;
    }
    const sectionId = nav.dataset.navId;
    if (!sectionId) {
      return;
    }
    navigateToSection(sectionId, app);
  });

  bindModal(app);
  bindLinkInlineModal(app);
}
