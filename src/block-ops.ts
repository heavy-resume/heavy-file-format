import type { TableRow, VisualBlock } from './editor/types';
import type { ComponentRenderHelpers } from './editor/component-helpers';
import type { TagRenderOptions } from './editor/tag-editor';
import { parseTags, serializeTags } from './editor/tag-editor';
import { state, getRefreshReaderPanels, getRenderApp } from './state';
import { getReusableNameFromSectionKey, getComponentDefs, isBuiltinComponent, renderComponentOptions, resolveBaseComponent } from './component-defs';
import { findSectionByKey, findBlockContainerById } from './section-ops';
import { getReusableTemplateByName, ensureContainerBlocks, ensureComponentListBlocks, ensureExpandableBlocks, ensureGridItems, applyComponentDefaults, createEmptyBlock, instantiateReusableBlock, coerceAlign, coerceSlot } from './document-factory';
import { syncReusableTemplateForBlock } from './reusable';
import { normalizeXrefTarget, getXrefTargetOptions, isXrefTargetValid } from './xref-ops';
import { getTableColumns, setTableColumns } from './table-ops';
import { coerceGridColumns, coerceGridColumn } from './grid-ops';
import { normalizeMarkdownLists, markdownToEditorHtml, turndown } from './markdown';
import { escapeAttr, escapeHtml, getInlineEditableText, renderOption } from './utils';
import { recordHistory } from './history';
import type { Align } from './editor/types';

export function findBlockByIds(sectionKey: string, blockId: string): VisualBlock | null {
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
    const nestedExpandableStub = findBlockInList(block.schema.expandableStubBlocks ?? [], blockId);
    if (nestedExpandableStub) {
      return nestedExpandableStub;
    }
    const nestedExpandableContent = findBlockInList(block.schema.expandableContentBlocks ?? [], blockId);
    if (nestedExpandableContent) {
      return nestedExpandableContent;
    }
    for (const item of block.schema.gridItems ?? []) {
      const nestedGridBlock = findBlockInList([item.block], blockId);
      if (nestedGridBlock) {
        return nestedGridBlock;
      }
    }
    for (const row of block.schema.tableRows ?? []) {
      const nestedDetails = findBlockInList(row.detailsBlocks ?? [], blockId);
      if (nestedDetails) {
        return nestedDetails;
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
    if (removeBlockFromList(block.schema.expandableStubBlocks ?? [], blockId)) {
      return true;
    }
    if (removeBlockFromList(block.schema.expandableContentBlocks ?? [], blockId)) {
      return true;
    }
    for (const row of block.schema.tableRows ?? []) {
      if (removeBlockFromList(row.detailsBlocks ?? [], blockId)) {
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
    block.text = normalizeMarkdownLists(turndown.turndown(target.innerHTML));
    turndownMs = performance.now() - stepStartedAt;
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

  if (field === 'block-plugin-url' && target instanceof HTMLInputElement) {
    block.schema.pluginUrl = target.value;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
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

  if (field === 'block-container-title' && target instanceof HTMLInputElement) {
    block.schema.containerTitle = target.value;
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

  if (field === 'block-grid-item-column' && target instanceof HTMLSelectElement) {
    const gridItemId = target.dataset.gridItemId;
    if (!gridItemId) {
      return true;
    }
    ensureGridItems(block.schema);
    const item = block.schema.gridItems.find((candidate) => candidate.id === gridItemId);
    if (!item) {
      return true;
    }
    item.column = coerceGridColumn(target.value, block.schema.gridColumns);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
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
    item.block.text = normalizeMarkdownLists(turndown.turndown(target.innerHTML));
    turndownMs = performance.now() - stepStartedAt;
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
  const field = target.dataset.field === 'block-tags-input' || target.dataset.tagField === 'block-tags' ? 'block-tags' : 'def-tags';
  if (field === 'block-tags') {
    const context = resolveBlockContext(target);
    return context ? parseTags(context.block.schema.tags) : [];
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
  const field = target.dataset.field === 'block-tags-input' || target.dataset.tagField === 'block-tags' ? 'block-tags' : 'def-tags';
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
      || findBlockInList(block.schema.expandableStubBlocks ?? [], blockId)
      || findBlockInList(block.schema.expandableContentBlocks ?? [], blockId)
      || (block.schema.tableRows ?? []).some((row) => findBlockInList(row.detailsBlocks ?? [], blockId))
  );
}

export function isActiveEditorSectionTitle(sectionKey: string): boolean {
  return state.activeEditorSectionTitleKey === sectionKey;
}

export function getComponentRenderHelpers(editorRenderer: { renderRichToolbar: ComponentRenderHelpers['renderRichToolbar']; renderEditorBlock: (sectionKey: string, block: VisualBlock, sections: import('./editor/types').VisualSection[]) => string; renderComponentFragment: ComponentRenderHelpers['renderComponentFragment'] }, readerRenderer: { renderReaderBlock: ComponentRenderHelpers['renderReaderBlock'] }): ComponentRenderHelpers {
  return {
    escapeAttr,
    escapeHtml,
    markdownToEditorHtml,
    renderRichToolbar: editorRenderer.renderRichToolbar,
    renderEditorBlock: (sectionKey, block) => editorRenderer.renderEditorBlock(sectionKey, block, state.document.sections),
    renderReaderBlock: readerRenderer.renderReaderBlock,
    renderComponentFragment: editorRenderer.renderComponentFragment,
    renderComponentOptions,
    renderOption,
    getXrefTargetOptions,
    isXrefTargetValid,
    getTableColumns,
    ensureContainerBlocks,
    ensureComponentListBlocks,
    getSelectedAddComponent: (key: string, fallback: string) => state.addComponentBySection[key] ?? fallback,
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

export function moveBlockByOffset(sectionKey: string, blockId: string, offset: -1 | 1): boolean {
  const location = findBlockContainerById(state.document.sections, sectionKey, blockId);
  if (!location) {
    return false;
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
