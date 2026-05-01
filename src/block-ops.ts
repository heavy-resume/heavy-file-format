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
import { escapeAttr, escapeHtml, getInlineEditableText, renderOption } from './utils';
import { recordHistory } from './history';
import { getDocumentComponentDefaultCss } from './document-component-defaults';
import { resetDbTableViewState } from './plugins/db-table';

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
  state.activeEditorBlock = { sectionKey, blockId };
  state.pendingEditorActivation = { sectionKey, blockId };
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
    document.execCommand('bold');
  } else if (action === 'italic') {
    document.execCommand('italic');
  } else if (action === 'paragraph') {
    document.execCommand('formatBlock', false, 'p');
  } else if (action.startsWith('heading-')) {
    const level = action.split('-')[1] ?? '2';
    document.execCommand('formatBlock', false, `h${level}`);
  } else if (action === 'list') {
    document.execCommand('insertUnorderedList');
  } else if (action === 'checklist') {
    insertInlineCheckboxAtSelection(editable);
  } else if (action === 'quote') {
    document.execCommand('formatBlock', false, 'blockquote');
  } else if (action === 'code-block') {
    insertCodeBlockAtSelection(editable);
  } else if (action === 'link') {
    const url = (value ?? '').trim();
    if (!url) {
      return;
    }
    document.execCommand('createLink', false, url);
  }

  const inputEvent = new InputEvent('input', { bubbles: true });
  editable.dispatchEvent(inputEvent);
}

export function handleRichEditorKeydown(event: KeyboardEvent, editable: HTMLElement): boolean {
  if (event.key === 'Tab' && isSelectionInsideEditableList(editable)) {
    event.preventDefault();
    document.execCommand(event.shiftKey ? 'outdent' : 'indent');
    normalizeEditableListDom(editable);
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }

  if ((event.key === 'Backspace' || event.key === 'Delete') && removeEmptyCodeBlockAtSelection(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
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

function isSelectionInsideEditableList(editable: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return false;
  }
  const node = selection.getRangeAt(0).startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest('li') && editable.contains(element));
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

function convertMarkdownQuoteShortcut(editable: HTMLElement): boolean {
  if (getCurrentLineShortcut(editable, /^>$/) === null) {
    return false;
  }
  replaceCurrentLineText(editable, '');
  document.execCommand('formatBlock', false, 'blockquote');
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
  pre.dataset.codeLanguage = 'text';
  pre.setAttribute('contenteditable', 'false');
  code.setAttribute('contenteditable', 'true');
  code.appendChild(document.createTextNode(''));
  pre.appendChild(code);
  editable.focus();
  insertNodeAtSelection(pre);
  placeCaretInside(code);
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
  let node: Node | null = selection.getRangeAt(0).startContainer;
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

function placeCaretAtEnd(editable: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
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
