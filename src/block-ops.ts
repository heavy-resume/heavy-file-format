import type { TableRow, VisualBlock } from './editor/types';
import type { ComponentRenderHelpers } from './editor/component-helpers';
import type { TagRenderOptions } from './editor/tag-editor';
import { parseTags, serializeTags } from './editor/tag-editor';
import { state, getRefreshReaderPanels, getRenderApp } from './state';
import { getReusableNameFromSectionKey, getComponentDefs, renderComponentOptions } from './component-defs';
import { findSectionByKey, findBlockContainerById, moveBlockInVisualSequence } from './section-ops';
import { getReusableTemplateByName, ensureContainerBlocks, ensureComponentListBlocks, ensureGridItems, applyComponentDefaults, instantiateReusableBlock, coerceAlign, coerceSlot } from './document-factory';
import { syncReusableTemplateForBlock } from './reusable';
import { normalizeXrefTarget, getXrefTargetOptions, isXrefTargetValid } from './xref-ops';
import { getTableColumns, setTableColumns } from './table-ops';
import { coerceGridColumns } from './grid-ops';
import { normalizeEditorMarkdownWhitespace, normalizeMarkdownLists, markdownToEditorHtml, turndown } from './markdown';
import { renderAddComponentPicker } from './editor/component-picker';
import { escapeAttr, escapeHtml, getInlineEditableText, renderOption } from './utils';
import { recordHistory } from './history';
import { getDocumentComponentDefaultCss } from './document-component-defaults';
import { resetDbTableViewState } from './plugins/db-table';
import { handleInlineCheckboxBackspace } from './editor/inline-checkbox';

export function findBlockByIds(sectionKey: string, blockId: string): VisualBlock | null {
  const sqliteRowComponentBlock = findSqliteRowComponentBlock(sectionKey, blockId);
  if (sqliteRowComponentBlock) {
    return sqliteRowComponentBlock;
  }
  const reusableName = getReusableNameFromSectionKey(sectionKey);
  if (reusableName) {
    const template = getReusableTemplateByName(reusableName);
    return template ? findBlockInList([template], blockId) : null;
  }
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section) {
    return null;
  }
  return findBlockInList(section.blocks, blockId);
}

function findSqliteRowComponentBlock(sectionKey: string, blockId: string): VisualBlock | null {
  const modal = state.sqliteRowComponentModal;
  if (!modal || modal.sectionKey !== sectionKey) {
    return null;
  }
  return findBlockInList(modal.blocks, blockId);
}

export function findBlockInList(blocks: VisualBlock[], blockId: string): VisualBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }
    const nestedContainer = findBlockInList(block.schema.containerBlocks ?? [], blockId);
    if (nestedContainer) {
      return nestedContainer;
    }
    const nestedComponentList = findBlockInList(block.schema.componentListBlocks ?? [], blockId);
    if (nestedComponentList) {
      return nestedComponentList;
    }
    const nestedExpandableStub = findBlockInList(block.schema.expandableStubBlocks?.children ?? [], blockId);
    if (nestedExpandableStub) {
      return nestedExpandableStub;
    }
    const nestedExpandableContent = findBlockInList(block.schema.expandableContentBlocks?.children ?? [], blockId);
    if (nestedExpandableContent) {
      return nestedExpandableContent;
    }
    for (const item of block.schema.gridItems ?? []) {
      const nestedGridBlock = findBlockInList([item.block], blockId);
      if (nestedGridBlock) {
        return nestedGridBlock;
      }
    }
  }
  return null;
}

function findBlockPathInList(blocks: VisualBlock[], blockId: string): string[] | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return [block.id];
    }
    const nestedBlocks = [
      ...(block.schema.containerBlocks ?? []),
      ...(block.schema.componentListBlocks ?? []),
      ...((block.schema.gridItems ?? []).map((item) => item.block)),
      ...(block.schema.expandableStubBlocks?.children ?? []),
      ...(block.schema.expandableContentBlocks?.children ?? []),
    ];
    const nestedPath = findBlockPathInList(nestedBlocks, blockId);
    if (nestedPath) {
      return [block.id, ...nestedPath];
    }
  }
  return null;
}

function getEditorBlockPathIds(sectionKey: string, blockId: string): string[] | null {
  const sqliteRowComponentModal = state.sqliteRowComponentModal;
  if (sqliteRowComponentModal?.sectionKey === sectionKey) {
    return findBlockPathInList(sqliteRowComponentModal.blocks, blockId);
  }
  const reusableName = getReusableNameFromSectionKey(sectionKey);
  if (reusableName) {
    const template = getReusableTemplateByName(reusableName);
    return template ? findBlockPathInList([template], blockId) : null;
  }
  const section = findSectionByKey(state.document.sections, sectionKey);
  return section ? findBlockPathInList(section.blocks, blockId) : null;
}

export function removeBlockFromList(blocks: VisualBlock[], blockId: string): boolean {
  const index = blocks.findIndex((candidate) => candidate.id === blockId);
  if (index >= 0) {
    blocks.splice(index, 1);
    return true;
  }
  for (const block of blocks) {
    if (removeBlockFromList(block.schema.containerBlocks ?? [], blockId)) {
      return true;
    }
    if (removeBlockFromList(block.schema.componentListBlocks ?? [], blockId)) {
      return true;
    }
    if (removeBlockFromList(block.schema.expandableStubBlocks?.children ?? [], blockId)) {
      return true;
    }
    if (removeBlockFromList(block.schema.expandableContentBlocks?.children ?? [], blockId)) {
      return true;
    }
    for (const item of block.schema.gridItems ?? []) {
      if (removeBlockFromList([item.block], blockId)) {
        return true;
      }
    }
  }
  return false;
}

export function resolveBlockContext(target: HTMLElement): { block: VisualBlock; row: TableRow | null } | null {
  const blockId = target.dataset.blockId;
  const sectionKey = target.dataset.sectionKey;
  if (!blockId || !sectionKey) {
    return null;
  }
  const block = findBlockByIds(sectionKey, blockId);
  return block ? { block, row: null } : null;
}

export function handleBlockFieldInput(target: HTMLElement): boolean {
  const field = target.dataset.field;
  if (!field) {
    return false;
  }
  const startedAt = performance.now();

  const context = resolveBlockContext(target);
  const blockId = target.dataset.blockId;
  if (!context || !blockId) {
    console.debug('[hvy:perf] handleBlockFieldInput', {
      field,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      skipped: context ? 'missing-block-id' : 'missing-context',
    });
    return false;
  }
  const block = context.block;

  if (field === 'block-rich') {
    let turndownMs = 0;
    let syncMs = 0;
    let refreshMs = 0;
    let stepStartedAt = performance.now();
    normalizeEditableListDom(target);
    block.text = normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(turndown.turndown(target.innerHTML)));
    turndownMs = performance.now() - stepStartedAt;
    syncEditableTaskListMarkup(target, block.text);
    stepStartedAt = performance.now();
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    syncMs = performance.now() - stepStartedAt;
    stepStartedAt = performance.now();
    getRefreshReaderPanels()();
    refreshMs = performance.now() - stepStartedAt;
    console.debug('[hvy:perf] handleBlockFieldInput', {
      field,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      turndownMs: Number(turndownMs.toFixed(2)),
      syncMs: Number(syncMs.toFixed(2)),
      refreshMs: Number(refreshMs.toFixed(2)),
      textLength: block.text.length,
    });
    return true;
  }

  if (field === 'block-component' && target instanceof HTMLSelectElement) {
    const reusableInstance = instantiateReusableBlock(target.value);
    if (reusableInstance) {
      block.text = reusableInstance.text;
      block.schema = reusableInstance.schema;
      block.schema.component = target.value;
    } else {
      block.schema.component = target.value;
      applyComponentDefaults(block.schema, target.value);
    }
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    getRenderApp()();
    return true;
  }

  if (field === 'block-plugin-db-table' && target instanceof HTMLInputElement) {
    block.schema.pluginConfig = {
      ...block.schema.pluginConfig,
      source: 'with-file',
      table: target.value,
    };
    resetDbTableViewState(target.dataset.sectionKey ?? '', block.id);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    getRenderApp()();
    return true;
  }

  if (field === 'block-plugin-query' && target instanceof HTMLTextAreaElement) {
    block.text = target.value;
    resetDbTableViewState(target.dataset.sectionKey ?? '', block.id);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    getRenderApp()();
    return true;
  }

  if (field === 'block-xref-title') {
    block.schema.xrefTitle = target instanceof HTMLInputElement ? target.value : getInlineEditableText(target);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    return true;
  }

  if (field === 'block-xref-detail') {
    block.schema.xrefDetail = target instanceof HTMLInputElement ? target.value : getInlineEditableText(target);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    return true;
  }

  if (field === 'block-xref-target' && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
    block.schema.xrefTarget = normalizeXrefTarget(target.value);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    return true;
  }



  if (field === 'block-component-list-component' && target instanceof HTMLSelectElement) {
    block.schema.componentListComponent = target.value;
    ensureComponentListBlocks(block);
    block.schema.componentListBlocks.forEach((itemBlock) => {
      itemBlock.schema.component = target.value;
      applyComponentDefaults(itemBlock.schema, target.value);
    });
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    getRenderApp()();
    return true;
  }

  if (field === 'block-grid-columns' && target instanceof HTMLInputElement) {
    block.schema.gridColumns = coerceGridColumns(target.value);
    ensureGridItems(block.schema);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    return true;
  }

  if (field === 'block-grid-item-component' && target instanceof HTMLSelectElement) {
    const gridItemId = target.dataset.gridItemId;
    if (!gridItemId) {
      return true;
    }
    ensureGridItems(block.schema);
    const item = block.schema.gridItems.find((candidate) => candidate.id === gridItemId);
    if (!item) {
      return true;
    }
    const reusableInstance = instantiateReusableBlock(target.value);
    if (reusableInstance) {
      item.block = reusableInstance;
      item.block.schema.component = target.value;
    } else {
      item.block.schema.component = target.value;
      applyComponentDefaults(item.block.schema, target.value);
    }
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    getRenderApp()();
    return true;
  }

  if (field === 'block-grid-rich') {
    let turndownMs = 0;
    let syncMs = 0;
    let refreshMs = 0;
    const gridItemId = target.dataset.gridItemId;
    if (!gridItemId) {
      return true;
    }
    ensureGridItems(block.schema);
    const item = block.schema.gridItems.find((candidate) => candidate.id === gridItemId);
    if (!item) {
      return true;
    }
    let stepStartedAt = performance.now();
    normalizeEditableListDom(target);
    item.block.text = normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(turndown.turndown(target.innerHTML)));
    turndownMs = performance.now() - stepStartedAt;
    syncEditableTaskListMarkup(target, item.block.text);
    stepStartedAt = performance.now();
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    syncMs = performance.now() - stepStartedAt;
    stepStartedAt = performance.now();
    getRefreshReaderPanels()();
    refreshMs = performance.now() - stepStartedAt;
    console.debug('[hvy:perf] handleBlockFieldInput', {
      field,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      turndownMs: Number(turndownMs.toFixed(2)),
      syncMs: Number(syncMs.toFixed(2)),
      refreshMs: Number(refreshMs.toFixed(2)),
      textLength: item.block.text.length,
    });
    return true;
  }

  if (field === 'block-code-language' && target instanceof HTMLInputElement) {
    block.schema.codeLanguage = target.value;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    return true;
  }

  if (field === 'block-code' && target instanceof HTMLTextAreaElement) {
    block.text = target.value;
    getRefreshReaderPanels()();
    return true;
  }

  if (field === 'block-expandable-always' && target instanceof HTMLInputElement) {
    block.schema.expandableAlwaysShowStub = target.checked;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    return true;
  }

  if (field === 'table-show-header' && target instanceof HTMLInputElement) {
    block.schema.tableShowHeader = target.checked;
    getRefreshReaderPanels()();
    return true;
  }

  if (field === 'table-column') {
    const columnIndex = Number.parseInt(target.dataset.columnIndex ?? '', 10);
    if (!Number.isNaN(columnIndex)) {
      const columns = getTableColumns(block.schema);
      columns[columnIndex] = getInlineEditableText(target);
      setTableColumns(block.schema, columns);
    }
    console.debug('[hvy:perf] handleBlockFieldInput', {
      field,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      columnIndex,
    });
    return true;
  }

  if (field === 'table-cell') {
    const rowIndex = Number.parseInt(target.dataset.rowIndex ?? '', 10);
    const cellIndex = Number.parseInt(target.dataset.cellIndex ?? '', 10);
    const row = block.schema.tableRows[rowIndex];
    if (row && !Number.isNaN(cellIndex)) {
      row.cells[cellIndex] = getInlineEditableText(target);
    }
    console.debug('[hvy:perf] handleBlockFieldInput', {
      field,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      rowIndex,
      cellIndex,
    });
    return true;
  }

  if (field === 'block-align' && target instanceof HTMLSelectElement) {
    block.schema.align = coerceAlign(target.value);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    return true;
  }

  if (field === 'block-slot' && target instanceof HTMLSelectElement) {
    block.schema.slot = coerceSlot(target.value);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    return true;
  }

  return false;
}

export function commitInlineTableEdit(target: HTMLElement): void {
  const field = target.dataset.field;
  if (field !== 'table-cell' && field !== 'table-column') {
    return;
  }
  const context = resolveBlockContext(target);
  if (!context) {
    return;
  }
  syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', context.block.id);
  getRefreshReaderPanels()();
}

export function getTagState(target: HTMLElement): string[] {
  const rawField = target.dataset.field ?? target.dataset.tagField;
  const field = rawField === 'block-tags-input' || rawField === 'block-tags' ? 'block-tags' : rawField === 'section-tags-input' || rawField === 'section-tags' ? 'section-tags' : 'def-tags';
  if (field === 'block-tags') {
    const context = resolveBlockContext(target);
    return context ? parseTags(context.block.schema.tags) : [];
  }
  if (field === 'section-tags') {
    const sectionKey = target.dataset.sectionKey;
    const section = sectionKey ? findSectionByKey(state.document.sections, sectionKey) : null;
    return section ? parseTags(section.tags) : [];
  }
  const defIndex = Number.parseInt(target.dataset.defIndex ?? '', 10);
  const defs = getComponentDefs();
  if (Number.isNaN(defIndex) || !defs[defIndex]) {
    return [];
  }
  return parseTags(defs[defIndex].tags ?? '');
}

export function setTagState(target: HTMLElement, tags: string[]): void {
  const value = serializeTags(tags);
  const rawField = target.dataset.field ?? target.dataset.tagField;
  const field = rawField === 'block-tags-input' || rawField === 'block-tags' ? 'block-tags' : rawField === 'section-tags-input' || rawField === 'section-tags' ? 'section-tags' : 'def-tags';
  if (field === 'block-tags') {
    const context = resolveBlockContext(target);
    if (!context) {
      return;
    }
    recordHistory(`tags:${context.block.id}`);
    context.block.schema.tags = value;
    getRefreshReaderPanels()();
    return;
  }
  if (field === 'section-tags') {
    const sectionKey = target.dataset.sectionKey;
    const section = sectionKey ? findSectionByKey(state.document.sections, sectionKey) : null;
    if (!section) {
      return;
    }
    recordHistory(`tags:${sectionKey}`);
    section.tags = value;
    getRefreshReaderPanels()();
    return;
  }
  const defIndex = Number.parseInt(target.dataset.defIndex ?? '', 10);
  const defs = getComponentDefs();
  if (Number.isNaN(defIndex) || !defs[defIndex]) {
    return;
  }
  recordHistory(`def:${defIndex}:tags`);
  defs[defIndex].tags = value;
  state.document.meta.component_defs = defs;
}

export function getTagRenderOptions(target: HTMLElement): Omit<TagRenderOptions, 'placeholder'> {
  return {
    sectionKey: target.dataset.sectionKey,
    blockId: target.dataset.blockId,
    defIndex: target.dataset.defIndex ? Number.parseInt(target.dataset.defIndex, 10) : undefined,
  };
}

export function isActiveEditorBlock(sectionKey: string, blockId: string): boolean {
  return state.activeEditorBlock?.sectionKey === sectionKey && state.activeEditorBlock.blockId === blockId;
}

export function setActiveEditorBlock(sectionKey: string, blockId: string): void {
  const currentActiveBlock = state.activeEditorBlock;
  const currentPath = currentActiveBlock?.sectionKey === sectionKey
    ? getEditorBlockPathIds(sectionKey, currentActiveBlock.blockId)
    : null;
  const nextPath = getEditorBlockPathIds(sectionKey, blockId);
  state.activeEditorBlock = { sectionKey, blockId };
  state.pendingEditorActivation = shouldRevealEditorActivationPath(currentPath, nextPath)
    ? { sectionKey, blockId }
    : null;
}

function shouldRevealEditorActivationPath(currentPath: string[] | null, nextPath: string[] | null): boolean {
  if (!nextPath) {
    return true;
  }
  if (!currentPath) {
    return true;
  }
  const sharedPathLength = nextPath.findIndex((blockId, index) => currentPath[index] !== blockId);
  const commonLength = sharedPathLength === -1 ? Math.min(currentPath.length, nextPath.length) : sharedPathLength;
  return commonLength < nextPath.length - 1;
}

export function clearActiveEditorBlock(blockId?: string): void {
  if (!state.activeEditorBlock) {
    return;
  }
  if (!blockId || state.activeEditorBlock.blockId === blockId) {
    state.activeEditorBlock = null;
  }
}

export function deactivateEditorBlock(sectionKey: string, blockId: string): void {
  const activeBlockId = state.activeEditorBlock?.blockId ?? null;
  if (!activeBlockId) {
    return;
  }
  const clickedBlock = findBlockByIds(sectionKey, blockId);
  const shouldDeactivate =
    activeBlockId === blockId || (clickedBlock ? blockContainsBlockId(clickedBlock, activeBlockId) : false);
  if (!shouldDeactivate) {
    return;
  }
  const parentId = findBlockContainerById(state.document.sections, sectionKey, blockId)?.ownerBlockId ?? null;
  state.activeEditorBlock = parentId ? { sectionKey, blockId: parentId } : null;
}

export function blockContainsBlockId(block: VisualBlock, blockId: string): boolean {
  return Boolean(
    findBlockInList(block.schema.containerBlocks ?? [], blockId)
      || findBlockInList(block.schema.componentListBlocks ?? [], blockId)
      || findBlockInList((block.schema.gridItems ?? []).map((item) => item.block), blockId)
      || findBlockInList(block.schema.expandableStubBlocks?.children ?? [], blockId)
      || findBlockInList(block.schema.expandableContentBlocks?.children ?? [], blockId)
  );
}

export function isActiveEditorSectionTitle(sectionKey: string): boolean {
  return state.activeEditorSectionTitleKey === sectionKey;
}

export function getComponentRenderHelpers(editorRenderer: {
  renderRichToolbar: ComponentRenderHelpers['renderRichToolbar'];
  renderEditorBlock: (sectionKey: string, block: VisualBlock, sections: import('./editor/types').VisualSection[], parentLocked?: boolean) => string;
  renderPassiveEditorBlock: (sectionKey: string, block: VisualBlock, sections: import('./editor/types').VisualSection[]) => string;
  renderComponentFragment: ComponentRenderHelpers['renderComponentFragment'];
  renderComponentPlacementTarget: ComponentRenderHelpers['renderComponentPlacementTarget'];
}, readerRenderer: { renderReaderBlock: ComponentRenderHelpers['renderReaderBlock'] }): ComponentRenderHelpers {
  return {
    escapeAttr,
    escapeHtml,
    markdownToEditorHtml,
    renderRichToolbar: editorRenderer.renderRichToolbar,
    renderEditorBlock: (sectionKey, block, parentLocked) => editorRenderer.renderEditorBlock(sectionKey, block, state.document.sections, parentLocked),
    renderPassiveEditorBlock: (sectionKey, block) => editorRenderer.renderPassiveEditorBlock(sectionKey, block, state.document.sections),
    renderReaderBlock: readerRenderer.renderReaderBlock,
    renderComponentFragment: editorRenderer.renderComponentFragment,
    renderComponentOptions,
    renderAddComponentPicker: (options) => renderAddComponentPicker(options, { escapeAttr, escapeHtml, getComponentDefs }),
    renderComponentPlacementTarget: (options) => editorRenderer.renderComponentPlacementTarget(options),
    renderOption,
    getDocumentComponentCss: (componentName: string) => getDocumentComponentDefaultCss(state.document.meta, componentName),
    getXrefTargetOptions,
    isXrefTargetValid,
    getTableColumns,
    ensureContainerBlocks,
    ensureComponentListBlocks,
    getSelectedAddComponent: (key: string, fallback: string) => state.addComponentBySection[key] ?? fallback,
    isExpandableEditorPanelOpen: (sectionKey, blockId, panel, fallback) =>
      state.expandableEditorPanels[`${sectionKey}:${blockId}`]?.[panel === 'stub' ? 'stubOpen' : 'expandedOpen'] ?? fallback,
  };
}

export function applyRichAction(action: string, editable: HTMLElement, value?: string): void {
  if (action === 'bold') {
    applyInlineRichAction(editable, 'strong', 'bold');
  } else if (action === 'italic') {
    applyInlineRichAction(editable, 'em', 'italic');
  } else if (action === 'underline') {
    applyInlineRichAction(editable, 'u', 'underline');
  } else if (action === 'strikethrough') {
    applyInlineRichAction(editable, 's', 'strikethrough');
  } else if (action === 'paragraph') {
    formatSelectionBlock(editable, 'p');
  } else if (action.startsWith('heading-')) {
    const level = action.split('-')[1] ?? '2';
    const currentBlock = getSelectionBlockElement(editable);
    const nextBlock = currentBlock?.tagName.toLowerCase() === `h${level}` ? 'p' : `h${level}`;
    formatSelectionBlock(editable, nextBlock);
  } else if (action === 'list') {
    toggleSelectionList(editable);
  } else if (action === 'checklist') {
    insertInlineCheckboxAtSelection(editable);
  } else if (action === 'quote') {
    const currentBlock = getSelectionBlockElement(editable);
    formatSelectionBlock(editable, currentBlock?.tagName.toLowerCase() === 'blockquote' ? 'p' : 'blockquote');
  } else if (action === 'code-block') {
    if (shouldApplyInlineCodeFromCodeButton(editable)) {
      applyInlineRichAction(editable, 'code', 'code');
    } else if (isSelectionInsideCodeBlock(editable)) {
      convertSelectionCodeBlockToParagraph(editable);
    } else {
      insertCodeBlockAtSelection(editable);
    }
  } else if (action === 'link') {
    const url = (value ?? '').trim();
    if (!url) {
      return;
    }
    applyInlineRichAction(editable, 'a', 'link', url);
  }

  updateRichToolbarState(editable);
  const inputEvent = new InputEvent('input', { bubbles: true });
  editable.dispatchEvent(inputEvent);
}

function applyInlineRichAction(editable: HTMLElement, tagName: InlineRichTag, action: InlineRichAction, href?: string): void {
  const range = getEditableSelectionRange(editable);
  if (!range) {
    return;
  }
  const selection = window.getSelection();
  const existing = getInlineAncestor(range, editable, tagName);
  if (range.collapsed) {
    if (existing) {
      if (tagName === 'a' && href) {
        existing.setAttribute('href', href);
        return;
      }
      moveCollapsedCaretOutsideInline(existing, range);
      setPendingInlineAction(editable, action, false);
      setSuppressedInlineAction(editable, action, true);
      return;
    }
    if (tagName !== 'a') {
      const nextActive = !getPendingInlineActions(editable).has(action);
      setPendingInlineAction(editable, action, nextActive);
      setSuppressedInlineAction(editable, action, !nextActive);
    }
    return;
  }
  if (existing) {
    if (tagName === 'a' && href) {
      existing.setAttribute('href', href);
      return;
    }
    unwrapInlineElement(existing);
    return;
  }
  const wrapper = document.createElement(tagName);
  if (tagName === 'a' && href) {
    wrapper.setAttribute('href', href);
  }
  const fragment = range.extractContents();
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);
  selection?.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  selection?.addRange(nextRange);
  setPendingInlineAction(editable, action, false);
}

type InlineRichAction = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'link' | 'code';
type InlineRichTag = 'strong' | 'em' | 'u' | 's' | 'a' | 'code';

const inlineActionTagByAction: Record<InlineRichAction, InlineRichTag> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strikethrough: 's',
  link: 'a',
  code: 'code',
};

function getPendingInlineActions(editable: HTMLElement): Set<InlineRichAction> {
  return new Set(
    (editable.dataset.pendingInlineActions ?? '')
      .split(/\s+/)
      .filter((action): action is InlineRichAction => isInlineRichAction(action))
  );
}

function setPendingInlineAction(editable: HTMLElement, action: InlineRichAction, active: boolean): void {
  const actions = getPendingInlineActions(editable);
  if (active) {
    actions.add(action);
  } else {
    actions.delete(action);
  }
  editable.dataset.pendingInlineActions = Array.from(actions).join(' ');
}

function getSuppressedInlineActions(editable: HTMLElement): Set<InlineRichAction> {
  return new Set(
    (editable.dataset.suppressedInlineActions ?? '')
      .split(/\s+/)
      .filter((action): action is InlineRichAction => isInlineRichAction(action))
  );
}

function setSuppressedInlineAction(editable: HTMLElement, action: InlineRichAction, active: boolean): void {
  const actions = getSuppressedInlineActions(editable);
  if (active) {
    actions.add(action);
  } else {
    actions.delete(action);
  }
  editable.dataset.suppressedInlineActions = Array.from(actions).join(' ');
}

function isInlineRichAction(action: string): action is InlineRichAction {
  return action === 'bold' || action === 'italic' || action === 'underline' || action === 'strikethrough' || action === 'link' || action === 'code';
}

function shouldApplyInlineCodeFromCodeButton(editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range || range.collapsed || range.toString().length === 0) {
    return false;
  }
  const startBlock = getBlockElementContaining(editable, range.startContainer);
  const endBlock = getBlockElementContaining(editable, range.endContainer);
  return !!startBlock && startBlock !== editable && startBlock === endBlock && startBlock.tagName !== 'PRE';
}

function getEditableSelectionRange(editable: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  const range = selection.getRangeAt(0);
  return editable.contains(range.commonAncestorContainer) || range.commonAncestorContainer === editable ? range : null;
}

function getInlineAncestor(range: Range, editable: HTMLElement, tagName: string): HTMLElement | null {
  const candidates = [range.startContainer, range.endContainer, range.commonAncestorContainer];
  for (const node of candidates) {
    const element = node instanceof Element ? node : node.parentElement;
    const match = element?.closest(tagName);
    if (match instanceof HTMLElement && editable.contains(match)) {
      return match;
    }
  }
  return null;
}

function unwrapInlineElement(element: HTMLElement): void {
  const parent = element.parentNode;
  if (!parent) {
    return;
  }
  const firstChild = element.firstChild;
  const lastChild = element.lastChild;
  const fragment = document.createDocumentFragment();
  while (element.firstChild) {
    fragment.appendChild(element.firstChild);
  }
  parent.replaceChild(fragment, element);
  if (!firstChild || !lastChild) {
    return;
  }
  const range = document.createRange();
  range.setStartBefore(firstChild);
  range.setEndAfter(lastChild);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function moveCollapsedCaretOutsideInline(element: HTMLElement, range: Range): void {
  const selection = window.getSelection();
  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(element);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const suffixRange = document.createRange();
  suffixRange.selectNodeContents(element);
  suffixRange.setStart(range.startContainer, range.startOffset);
  const nextRange = document.createRange();
  const parent = element.parentNode;
  if (!parent) {
    return;
  }
  if (prefixRange.toString().length === 0) {
    const boundary = document.createTextNode('');
    parent.insertBefore(boundary, element);
    nextRange.setStart(boundary, 0);
  } else if (suffixRange.toString().length === 0) {
    const boundary = document.createTextNode('');
    parent.insertBefore(boundary, element.nextSibling);
    nextRange.setStart(boundary, 0);
  } else {
    const trailingRange = range.cloneRange();
    trailingRange.setEndAfter(element);
    const trailing = trailingRange.extractContents();
    const boundary = document.createTextNode('');
    parent.insertBefore(boundary, element.nextSibling);
    parent.insertBefore(trailing, boundary.nextSibling);
    nextRange.setStart(boundary, 0);
  }
  nextRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
}

function formatSelectionBlock(editable: HTMLElement, tagName: string): void {
  const block = getSelectionBlockElement(editable);
  if (!block || block.tagName === 'LI' || block.tagName === 'PRE') {
    return;
  }
  const selection = window.getSelection();
  const previousRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const previousTextSelection =
    previousRange && isRangeInsideElement(block, previousRange)
      ? {
          start: getTextOffset(block, previousRange.startContainer, previousRange.startOffset),
          end: getTextOffset(block, previousRange.endContainer, previousRange.endOffset),
        }
      : null;
  const replacement = document.createElement(tagName);
  while (block.firstChild) {
    replacement.appendChild(block.firstChild);
  }
  const needsTypingAnchor = tagName !== 'p' && (!replacement.textContent || replacement.textContent === '\u200b');
  if (!replacement.firstChild || (replacement.childNodes.length === 1 && replacement.firstChild instanceof HTMLBRElement)) {
    replacement.replaceChildren(document.createTextNode(needsTypingAnchor ? '\u200b' : ''));
  }
  if (block === editable) {
    editable.replaceChildren(replacement);
  } else {
    block.replaceWith(replacement);
  }
  if (needsTypingAnchor && replacement.firstChild) {
    placeCaretAtEnd(replacement);
  } else if (
    previousTextSelection &&
    previousTextSelection.start !== null &&
    previousTextSelection.end !== null &&
    restoreSelectionByTextOffsets(replacement, previousTextSelection.start, previousTextSelection.end)
  ) {
    return;
  } else if (
    previousRange &&
    replacement.contains(previousRange.startContainer) &&
    replacement.contains(previousRange.endContainer)
  ) {
    selection?.removeAllRanges();
    selection?.addRange(previousRange);
  } else {
    placeCaretInside(replacement);
  }
}

export function refreshRichToolbarState(editable: HTMLElement): void {
  updateRichToolbarState(editable);
}

export function handleRichEditorClick(event: MouseEvent, editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range) {
    return false;
  }
  const code = getInlineAncestor(range, editable, 'code');
  if (!code) {
    return false;
  }
  const rect = code.getBoundingClientRect();
  if (event.clientX <= rect.right) {
    return false;
  }
  moveCollapsedCaretOutsideInline(code, range);
  updateRichToolbarState(editable);
  return true;
}

function updateRichToolbarState(editable: HTMLElement): void {
  const toolbar = editable.closest('.editor-block')?.querySelector<HTMLElement>('.rich-toolbar');
  if (!toolbar) {
    return;
  }
  const selectedStyle = getSelectedRichBlockStyle(editable);
  const selectedInlineActions = getSelectedInlineRichActions(editable);
  toolbar.querySelectorAll<HTMLButtonElement>('[data-rich-action]').forEach((button) => {
    const action = button.dataset.richAction ?? '';
    const selected =
      action === selectedStyle ||
      (selectedStyle === 'paragraph' && action === 'paragraph') ||
      (isInlineRichAction(action) && selectedInlineActions.has(action));
    if (!/^(paragraph|heading-[1-4]|quote|code-block|list|checklist)$/.test(action) && !isInlineRichAction(action)) {
      return;
    }
    button.classList.toggle('secondary', selected);
    button.classList.toggle('is-selected', selected);
    button.classList.toggle('ghost', !selected);
  });
}

function getSelectedInlineRichActions(editable: HTMLElement): Set<InlineRichAction> {
  const actions = getPendingInlineActions(editable);
  const range = getEditableSelectionRange(editable);
  if (!range) {
    return actions;
  }
  for (const action of Object.keys(inlineActionTagByAction) as InlineRichAction[]) {
    if (getInlineAncestor(range, editable, inlineActionTagByAction[action])) {
      actions.add(action);
    }
  }
  return actions;
}

function getSelectedRichBlockStyle(editable: HTMLElement): string {
  const block = getSelectionBlockElement(editable);
  const tagName = block?.tagName.toLowerCase() ?? '';
  if (/^h[1-4]$/.test(tagName)) {
    return `heading-${tagName.slice(1)}`;
  }
  if (tagName === 'blockquote') {
    return 'quote';
  }
  if (tagName === 'pre') {
    return 'code-block';
  }
  if (block?.closest('li')) {
    const text = block.textContent ?? '';
    return /^\s*(☐|☑|\[[ xX]\])/.test(text) ? 'checklist' : 'list';
  }
  return 'paragraph';
}

export function handleRichEditorKeydown(event: KeyboardEvent, editable: HTMLElement): boolean {
  if (event.key === 'ArrowRight' && exitInlineCodeAtEnd(editable)) {
    event.preventDefault();
    updateRichToolbarState(editable);
    return true;
  }

  if ((event.key === 'Backspace' || event.key === 'Delete') && clearFullEditableSelection(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if ((event.key === 'Backspace' || event.key === 'Delete') && clearSelectedStyledBlock(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.key === 'Tab' && isSelectionInsideEditableList(editable)) {
    event.preventDefault();
    moveSelectionListItemNesting(editable, event.shiftKey ? 'outdent' : 'indent');
    normalizeEditableListDom(editable);
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }

  if ((event.key === 'Backspace' || event.key === 'Delete') && removeEmptyCodeBlockAtSelection(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.key === 'Backspace' && reenterPreviousCodeBlock(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.key === 'Backspace' && exitEmptyQuoteAtSelection(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.key === 'Enter' && isSelectionInsideCodeBlock(editable)) {
    event.preventDefault();
    if (event.shiftKey) {
      exitCodeBlockBelowSelection(editable);
    } else {
      insertTextInSelectionCodeBlock(editable, '\n');
    }
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  if (isSelectionInsideCodeBlock(editable)) {
    return false;
  }

  if (event.key === ' ' && convertMarkdownQuoteShortcut(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }

  if (event.key === 'Enter') {
    if (exitBlockStyleAtSelection(editable)) {
      event.preventDefault();
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      updateRichToolbarState(editable);
      return true;
    }

    const codeLanguage = getCurrentLineShortcut(editable, /^```([\w-]*)$/);
    if (codeLanguage !== null) {
      event.preventDefault();
      replaceCurrentLineWithCodeBlock(editable, codeLanguage);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    }

    if (convertMarkdownQuoteShortcut(editable)) {
      event.preventDefault();
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    }
  }

  return false;
}

export function handleRichEditorBeforeInput(event: InputEvent, editable: HTMLElement): boolean {
  if (event.inputType === 'deleteContentBackward') {
    if (!handleInlineCheckboxBackspace(editable)) {
      return false;
    }
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }

  if (event.inputType !== 'insertText' || !event.data) {
    return false;
  }

  if (isSelectionInsideCodeBlock(editable)) {
    insertTextInSelectionCodeBlock(editable, event.data);
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }

  if (event.data === '`' && convertInlineCodeShortcut(editable)) {
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  const pendingActions = getPendingInlineActions(editable);
  const suppressedActions = getSuppressedInlineActions(editable);
  const shouldPreserveVisibleSpace = event.data === ' ';
  if (pendingActions.size === 0 && suppressedActions.size === 0 && !shouldPreserveVisibleSpace) {
    return false;
  }

  const range = getEditableSelectionRange(editable);
  if (!range) {
    return false;
  }

  for (const action of suppressedActions) {
    const existing = getInlineAncestor(range, editable, inlineActionTagByAction[action]);
    if (existing) {
      moveCollapsedCaretOutsideInline(existing, range);
    }
  }
  const insertionRange = getEditableSelectionRange(editable) ?? range;
  insertionRange.deleteContents();
  const text = document.createTextNode(shouldPreserveVisibleSpace ? '\u00a0' : event.data);
  let node: Node = text;
  for (const action of ['strikethrough', 'underline', 'italic', 'bold'] as InlineRichAction[]) {
    if (!pendingActions.has(action) || getInlineAncestor(insertionRange, editable, inlineActionTagByAction[action])) {
      continue;
    }
    const wrapper = document.createElement(inlineActionTagByAction[action]);
    wrapper.appendChild(node);
    node = wrapper;
  }
  insertionRange.insertNode(node);
  const nextRange = document.createRange();
  nextRange.setStart(text, text.textContent?.length ?? 0);
  nextRange.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  updateRichToolbarState(editable);
  editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return true;
}

function isSelectionInsideEditableList(editable: HTMLElement): boolean {
  return getSelectionListItem(editable) !== null;
}

function normalizeEditableListDom(editable: HTMLElement): void {
  editable.querySelectorAll<HTMLElement>('ul, ol').forEach((list) => {
    Array.from(list.children).forEach((child) => {
      if (child instanceof HTMLElement && /^(UL|OL)$/.test(child.tagName)) {
        const previousItem = child.previousElementSibling;
        if (previousItem instanceof HTMLLIElement) {
          previousItem.appendChild(child);
        }
      }
    });
  });
}

function toggleSelectionList(editable: HTMLElement): void {
  const item = getSelectionListItem(editable);
  if (item) {
    unwrapListItem(item);
    return;
  }

  const block = getSelectionBlockElement(editable);
  if (!block || block === editable || block.tagName === 'PRE') {
    return;
  }
  const previousRange = getEditableSelectionRange(editable)?.cloneRange() ?? null;
  const previousTextSelection =
    previousRange && isRangeInsideElement(block, previousRange)
      ? {
          start: getTextOffset(block, previousRange.startContainer, previousRange.startOffset),
          end: getTextOffset(block, previousRange.endContainer, previousRange.endOffset),
        }
      : null;
  const list = document.createElement('ul');
  const listItem = document.createElement('li');
  while (block.firstChild) {
    listItem.appendChild(block.firstChild);
  }
  if (!listItem.firstChild) {
    listItem.appendChild(document.createTextNode('\u200b'));
  }
  list.appendChild(listItem);
  block.replaceWith(list);
  if (
    previousTextSelection &&
    previousTextSelection.start !== null &&
    previousTextSelection.end !== null &&
    restoreSelectionByTextOffsets(listItem, previousTextSelection.start, previousTextSelection.end)
  ) {
    return;
  }
  placeCaretAtEnd(listItem);
}

function unwrapListItem(item: HTMLLIElement): void {
  const list = item.parentElement;
  if (!(list instanceof HTMLUListElement || list instanceof HTMLOListElement)) {
    return;
  }
  const paragraph = document.createElement('p');
  while (item.firstChild) {
    if (item.firstChild instanceof HTMLUListElement || item.firstChild instanceof HTMLOListElement) {
      item.firstChild.remove();
      continue;
    }
    paragraph.appendChild(item.firstChild);
  }
  if (!paragraph.firstChild) {
    paragraph.appendChild(document.createElement('br'));
  }
  list.parentNode?.insertBefore(paragraph, list);
  item.remove();
  if (list.children.length === 0) {
    list.remove();
  }
  placeCaretAtEnd(paragraph);
}

function moveSelectionListItemNesting(editable: HTMLElement, direction: 'indent' | 'outdent'): void {
  const item = getSelectionListItem(editable);
  if (!item) {
    return;
  }
  if (direction === 'indent') {
    indentListItem(item);
  } else {
    outdentListItem(item);
  }
}

function indentListItem(item: HTMLLIElement): void {
  const previousItem = item.previousElementSibling;
  if (!(previousItem instanceof HTMLLIElement)) {
    return;
  }
  let nestedList = Array.from(previousItem.children).find((child): child is HTMLUListElement => child instanceof HTMLUListElement);
  if (!nestedList) {
    nestedList = document.createElement('ul');
    previousItem.appendChild(nestedList);
  }
  nestedList.appendChild(item);
}

function outdentListItem(item: HTMLLIElement): void {
  const list = item.parentElement;
  const parentItem = list?.parentElement;
  if (!(list instanceof HTMLUListElement || list instanceof HTMLOListElement) || !(parentItem instanceof HTMLLIElement)) {
    return;
  }
  parentItem.parentNode?.insertBefore(item, parentItem.nextSibling);
  if (list.children.length === 0) {
    list.remove();
  }
}

function getSelectionListItem(editable: HTMLElement): HTMLLIElement | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  const node = selection.getRangeAt(0).startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const item = element?.closest('li');
  return item instanceof HTMLLIElement && editable.contains(item) ? item : null;
}

function convertMarkdownQuoteShortcut(editable: HTMLElement): boolean {
  if (getCurrentLineShortcut(editable, /^>$/) === null) {
    return false;
  }
  replaceCurrentLineText(editable, '');
  formatSelectionBlock(editable, 'blockquote');
  return true;
}

function convertInlineCodeShortcut(editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range || !range.collapsed) {
    return false;
  }
  const block = getSelectionBlockElement(editable);
  if (!block || block === editable || /^(PRE|CODE)$/.test(block.tagName) || getInlineAncestor(range, editable, 'code')) {
    return false;
  }

  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(block);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const prefix = prefixRange.toString();
  const openingTickIndex = prefix.lastIndexOf('`');
  if (openingTickIndex < 0) {
    return false;
  }
  const codeText = prefix.slice(openingTickIndex + 1);
  if (codeText.length === 0 || /[\r\n]/.test(codeText)) {
    return false;
  }

  const start = getTextPositionAtOffset(block, openingTickIndex);
  if (!start) {
    return false;
  }

  const replaceRange = document.createRange();
  replaceRange.setStart(start.node, start.offset);
  replaceRange.setEnd(range.startContainer, range.startOffset);
  replaceRange.deleteContents();

  const code = document.createElement('code');
  code.textContent = codeText;
  const boundary = document.createTextNode('');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(code);
  fragment.appendChild(boundary);
  replaceRange.insertNode(fragment);

  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.setStart(boundary, 0);
  nextRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  return true;
}

function exitInlineCodeAtEnd(editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range || !range.collapsed) {
    return false;
  }
  const code = getInlineAncestor(range, editable, 'code');
  if (!code || !isCollapsedSelectionAtEndOf(code)) {
    return false;
  }
  moveCollapsedCaretOutsideInline(code, range);
  return true;
}

function getTextPositionAtOffset(root: HTMLElement, targetOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = targetOffset;
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      const length = current.textContent?.length ?? 0;
      if (remaining <= length) {
        return { node: current, offset: remaining };
      }
      remaining -= length;
    }
    current = walker.nextNode();
  }
  return null;
}

function getTextOffset(root: HTMLElement, container: Node, offset: number): number | null {
  if (container !== root && !root.contains(container)) {
    return null;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(container, offset);
  } catch {
    return null;
  }
  return range.toString().length;
}

function restoreSelectionByTextOffsets(root: HTMLElement, startOffset: number, endOffset: number): boolean {
  const start = getTextPositionAtOffset(root, startOffset);
  const end = getTextPositionAtOffset(root, endOffset);
  if (!start || !end) {
    return false;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function isRangeInsideElement(element: HTMLElement, range: Range): boolean {
  return (
    (range.startContainer === element || element.contains(range.startContainer)) &&
    (range.endContainer === element || element.contains(range.endContainer))
  );
}

function exitBlockStyleAtSelection(editable: HTMLElement): boolean {
  const block = getSelectionBlockElement(editable);
  if (!block || !/^(H[1-4]|BLOCKQUOTE)$/.test(block.tagName) || !isCollapsedSelectionAtEndOf(block)) {
    return false;
  }
  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createTextNode('\u200b'));
  block.parentNode?.insertBefore(paragraph, block.nextSibling);
  placeCaretAtEnd(paragraph);
  return true;
}

function exitEmptyQuoteAtSelection(editable: HTMLElement): boolean {
  const block = getSelectionBlockElement(editable);
  if (!(block instanceof HTMLQuoteElement) || block.textContent?.trim()) {
    return false;
  }
  if (!isCollapsedSelectionAtStartOf(block)) {
    return false;
  }
  formatSelectionBlock(editable, 'p');
  return true;
}

function getCurrentLineShortcut(editable: HTMLElement, pattern: RegExp): string | null {
  const block = getSelectionBlockElement(editable);
  const text = (block?.textContent ?? '').trim();
  const match = text.match(pattern);
  if (!match) {
    return null;
  }
  return match[1] ?? '';
}

function replaceCurrentLineWithCodeBlock(editable: HTMLElement, language: string): void {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  const normalizedLanguage = language.trim().toLowerCase();
  pre.dataset.codeLanguage = normalizedLanguage || 'text';
  pre.setAttribute('contenteditable', 'false');
  if (normalizedLanguage) {
    code.className = `language-${normalizedLanguage}`;
    code.dataset.language = normalizedLanguage;
  }
  code.setAttribute('contenteditable', 'true');
  code.appendChild(document.createTextNode(''));
  pre.appendChild(code);
  replaceCurrentLineElement(editable, pre);
  placeCaretInside(code);
}

function insertCodeBlockAtSelection(editable: HTMLElement): void {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  pre.dataset.codeLanguage = '';
  pre.setAttribute('contenteditable', 'false');
  code.setAttribute('contenteditable', 'true');
  code.appendChild(document.createTextNode(''));
  pre.appendChild(code);
  editable.focus();
  insertNodeAtSelection(pre);
  placeCaretInside(code);
}

function convertSelectionCodeBlockToParagraph(editable: HTMLElement): void {
  const pre = getSelectionCodeBlock(editable);
  if (!pre) {
    return;
  }
  const code = pre.querySelector('code');
  const range = getEditableSelectionRange(editable);
  const caretOffset = range && code instanceof HTMLElement ? getTextOffset(code, range.startContainer, range.startOffset) : null;
  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createTextNode((code?.textContent ?? pre.textContent ?? '').replace(/\u200b/g, '')));
  if (!paragraph.firstChild || paragraph.textContent === '') {
    paragraph.replaceChildren(document.createElement('br'));
  }
  pre.replaceWith(paragraph);
  if (caretOffset !== null && paragraph.firstChild instanceof Text) {
    const selection = window.getSelection();
    const nextRange = document.createRange();
    nextRange.setStart(paragraph.firstChild, Math.min(caretOffset, paragraph.firstChild.data.length));
    nextRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(nextRange);
    return;
  }
  placeCaretAtEnd(paragraph);
}

function insertTextInSelectionCodeBlock(editable: HTMLElement, text: string): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return;
  }
  const code = getSelectionCodeBlock(editable)?.querySelector('code');
  if (!(code instanceof HTMLElement)) {
    return;
  }
  const range = selection.getRangeAt(0);
  const startOffset = getTextOffset(code, range.startContainer, range.startOffset);
  const endOffset = getTextOffset(code, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null) {
    return;
  }
  const value = code.textContent ?? '';
  const normalizedStartOffset = startOffset - countCodeCaretAnchors(value.slice(0, startOffset));
  const normalizedEndOffset = endOffset - countCodeCaretAnchors(value.slice(0, endOffset));
  const normalizedValue = value.replace(/\u200b/g, '');
  const insertedText = text === '\n' ? '\n\u200b' : text;
  const nextValue = `${normalizedValue.slice(0, normalizedStartOffset)}${insertedText}${normalizedValue.slice(normalizedEndOffset)}`;
  code.textContent = nextValue;
  const textNode = code.firstChild instanceof Text ? code.firstChild : code.appendChild(document.createTextNode(''));
  const nextOffset = normalizedStartOffset + insertedText.length;
  range.setStart(textNode, nextOffset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function countCodeCaretAnchors(value: string): number {
  return (value.match(/\u200b/g) ?? []).length;
}

function exitCodeBlockBelowSelection(editable: HTMLElement): void {
  const pre = getSelectionCodeBlock(editable);
  if (!pre) {
    return;
  }
  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createTextNode('\u200b'));
  pre.parentNode?.insertBefore(paragraph, pre.nextSibling);
  placeCaretAtEnd(paragraph);
}

function reenterPreviousCodeBlock(editable: HTMLElement): boolean {
  const block = getSelectionBlockElement(editable);
  if (!block || block === editable || !isCollapsedSelectionAtStartOf(block)) {
    return false;
  }
  const previous = block.previousElementSibling;
  if (!(previous instanceof HTMLPreElement)) {
    return false;
  }
  const code = previous.querySelector<HTMLElement>('code');
  if (!code) {
    return false;
  }
  if (isEffectivelyEmptyBlock(block)) {
    block.remove();
  }
  placeCaretAtEnd(code);
  return true;
}

function clearFullEditableSelection(editable: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (
    !isRangeInsideElement(editable, range) ||
    (!doesRangeCoverElementContents(editable, range) && !doesRangeCoverElementText(editable, range))
  ) {
    return false;
  }
  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createElement('br'));
  editable.replaceChildren(paragraph);
  placeCaretInside(paragraph);
  return true;
}

function clearSelectedStyledBlock(editable: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const block = getSelectionBlockElement(editable);
  if (!(block instanceof HTMLQuoteElement) || !isRangeInsideElement(block, range)) {
    return false;
  }
  if (!doesRangeCoverElementContents(block, range) && !doesRangeCoverElementText(block, range)) {
    return false;
  }
  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createElement('br'));
  block.replaceWith(paragraph);
  placeCaretInside(paragraph);
  return true;
}

function doesRangeCoverElementContents(element: HTMLElement, range: Range): boolean {
  const fullRange = document.createRange();
  fullRange.selectNodeContents(element);
  return range.compareBoundaryPoints(Range.START_TO_START, fullRange) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, fullRange) >= 0;
}

function doesRangeCoverElementText(element: HTMLElement, range: Range): boolean {
  const startOffset = getTextOffset(element, range.startContainer, range.startOffset);
  const endOffset = getTextOffset(element, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null) {
    return false;
  }
  return startOffset <= 0 && endOffset >= element.textContent!.length;
}

function isEffectivelyEmptyBlock(block: HTMLElement): boolean {
  return (block.textContent ?? '').replace(/\u200b/g, '').trim().length === 0;
}

function removeEmptyCodeBlockAtSelection(editable: HTMLElement): boolean {
  const pre = getSelectionCodeBlock(editable);
  if (!pre) {
    return false;
  }
  const code = pre.querySelector('code');
  if ((code?.textContent ?? pre.textContent ?? '').trim().length > 0) {
    return false;
  }
  if (!code || !isCollapsedSelectionAtStartOf(code)) {
    return false;
  }

  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createElement('br'));
  pre.replaceWith(paragraph);
  placeCaretAtStart(paragraph);
  return true;
}

function isCollapsedSelectionAtStartOf(container: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) && range.startContainer !== container) {
    return false;
  }
  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(container);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  return prefixRange.toString().length === 0;
}

function isCollapsedSelectionAtEndOf(container: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) && range.startContainer !== container) {
    return false;
  }
  const suffixRange = document.createRange();
  suffixRange.selectNodeContents(container);
  suffixRange.setStart(range.startContainer, range.startOffset);
  return suffixRange.toString().length === 0;
}

function isSelectionInsideCodeBlock(editable: HTMLElement): boolean {
  return getSelectionCodeBlock(editable) !== null;
}

function getSelectionCodeBlock(editable: HTMLElement): HTMLPreElement | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  const node = selection.getRangeAt(0).startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const pre = element?.closest('pre');
  return pre instanceof HTMLPreElement && editable.contains(pre) ? pre : null;
}

function replaceCurrentLineText(editable: HTMLElement, text: string): void {
  const block = getSelectionBlockElement(editable);
  if (!block) {
    return;
  }
  block.textContent = text;
}

function replaceCurrentLineElement(editable: HTMLElement, replacement: HTMLElement): void {
  const block = getSelectionBlockElement(editable);
  if (block && block !== editable) {
    block.replaceWith(replacement);
    return;
  }
  insertNodeAtSelection(replacement);
}

function insertNodeAtSelection(node: Node): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
}

function getSelectionBlockElement(editable: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  return getBlockElementContaining(editable, selection.getRangeAt(0).startContainer);
}

function getBlockElementContaining(editable: HTMLElement, container: Node): HTMLElement | null {
  let node: Node | null = container;
  while (node && node !== editable) {
    if (node instanceof HTMLElement && /^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6])$/.test(node.tagName)) {
      return node;
    }
    node = node.parentNode;
  }
  return editable;
}

function placeCaretInside(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  if (!element.firstChild) {
    element.appendChild(document.createTextNode(''));
  }
  range.setStart(element.firstChild ?? element, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtEnd(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  if (!element.firstChild) {
    element.appendChild(document.createTextNode(''));
  }
  const textNode = element.firstChild instanceof Text ? element.firstChild : null;
  if (textNode) {
    range.setStart(textNode, textNode.textContent?.length ?? 0);
  } else {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtStart(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertInlineCheckboxAtSelection(editable: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  const normalizedRange = range.cloneRange();
  normalizedRange.deleteContents();
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.setAttribute('contenteditable', 'false');
  const spacer = document.createTextNode(' ');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(checkbox);
  fragment.appendChild(spacer);
  normalizedRange.insertNode(fragment);
  placeCaretAfterInlineCheckbox(spacer, editable);
}

export function syncEditableTaskListMarkup(editable: HTMLElement, markdown: string): void {
  if (!/(^|[^\\])\[( |x|X)\]/.test(markdown)) {
    return;
  }

  if (!hasRawCheckboxMarkerText(editable)) {
    return;
  }

  editable.innerHTML = markdownToEditorHtml(markdown);
  placeCaretAtEnd(editable);
}

function hasRawCheckboxMarkerText(editable: HTMLElement): boolean {
  const text = editable.textContent ?? '';
  return /(^|[^\\])\[( |x|X)\]/.test(text);
}

function placeCaretAfterInlineCheckbox(spacer: Text, editable: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  editable.focus();
  const range = document.createRange();
  const nextNode = spacer.nextSibling;
  if (nextNode instanceof Text) {
    range.setStart(nextNode, 0);
  } else if (nextNode) {
    range.setStartBefore(nextNode);
  } else {
    range.setStart(spacer, spacer.data.length);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function moveBlockByOffset(sectionKey: string, blockId: string, offset: -1 | 1): boolean {
  const location = findBlockContainerById(state.document.sections, sectionKey, blockId);
  if (!location) {
    return false;
  }
  if (location.ownerBlockId === null) {
    // Section-level block: walk the interleaved blocks/subsections sequence so
    // arrows can swap with adjacent subsections by repositioning their anchors.
    const ok = moveBlockInVisualSequence(state.document.sections, sectionKey, blockId, offset);
    if (ok) {
      syncReusableTemplateForBlock(sectionKey, blockId);
    }
    return ok;
  }
  const targetIndex = location.index + offset;
  if (targetIndex < 0 || targetIndex >= location.container.length) {
    return false;
  }
  const [block] = location.container.splice(location.index, 1);
  if (!block) {
    return false;
  }
  location.container.splice(targetIndex, 0, block);
  syncReusableTemplateForBlock(sectionKey, location.ownerBlockId ?? blockId);
  return true;
}
