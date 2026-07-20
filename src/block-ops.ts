import type { TableRow, VisualBlock } from './editor/types';
import type { ComponentRenderHelpers } from './editor/component-helpers';
import type { TagRenderOptions } from './editor/tag-editor';
import type { AppState, SortValueType } from './types';
import { parseTags, serializeTags } from './editor/tag-editor';
import { state, getCachedComponentRenderHelpers, getRefreshReaderPanels, getRenderApp, type ReaderPanelRefreshSurface } from './state';
import { getReusableNameFromSectionKey, getComponentDefs, renderComponentOptions, resolveBaseComponent } from './component-defs';
import { findSectionByKey, findBlockContainerById, moveBlockInVisualSequence } from './section-ops';
import { getReusableTemplateByName, ensureContainerBlocks, ensureComponentListBlocks, ensureGridItems, applyComponentDefaults, instantiateReusableBlock, coerceAlign, coerceSlot, createEmptyBlock } from './document-factory';
import { findReusableOwner, syncReusableTemplateForBlock } from './reusable';
import { normalizeXrefTarget, getXrefTargetOptions, isXrefTargetValid, applyXrefTargetDefaults, getEffectiveXrefTargetTagFilter } from './xref-ops';
import { getTableColumns, isEmptyTableRow, pruneEmptyKeyboardInsertedTableRows, setTableColumns } from './table-ops';
import { coerceGridColumns, coerceGridStackWidth, DEFAULT_GRID_STACK_WIDTH } from './grid-ops';
import { applyMobileAltAdjustment, getRichEditorSerializableHtml, normalizeEditorMarkdownWhitespace, normalizeMarkdownLists, markdownToEditorHtml as renderMarkdownToEditorHtml, removeNonTextContentFromRichEditor, turndown } from './markdown';
import { applyCodeIndentation } from './code-indentation';
import { renderAddComponentPicker } from './editor/component-picker';
import { escapeAttr, escapeHtml, getInlineEditableText, renderOption } from './utils';
import { recordHistory } from './history';
import { routeNextUndoToDocument } from './edit-command-routing';
import { getDocumentComponentDefaultCss } from './document-component-defaults';
import { resetDbTableViewState } from './plugins/db-table-model';
import { handleInlineCheckboxBackspace } from './editor/inline-checkbox';
import { createTextFillInMarker, hasTextFillInMarker, prepareTextFillIn } from './text-fill-in';
import { getTextLineStylesFromMeta, sanitizeTextLineStyleCss } from './text-line-styles';
import { isPdfAllowedComponent, isPdfAllowedComponentInstance, isPdfDocument } from './pdf-document-capabilities';
import { inferComponentListItemLabel } from './editor/components/component-list/component-list-labels';
import { normalizeTextCaption, renderTextCaptionHtml, updateTextCaptionText } from './caption';
import type { TextCaptionPayload } from './editor/types';
import { findSortValueOwnerBlock, syncSortValuesForDocument, syncSortValuesForListItem } from './sort-values';
import { highlightSearchHtml } from './search/highlight';

const completedMultiSlotFillInBlurTimers = new WeakMap<HTMLElement, number>();
const HVY_RICH_CLIPBOARD_TYPE = 'application/x-hvy-rich-html';
const CODE_BLOCK_ENTER_SUPPRESS_MS = 300;

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

export function findBlockInList(blocks: VisualBlock[], blockId: string, seen = new Set<VisualBlock>()): VisualBlock | null {
  for (const block of blocks) {
    if (seen.has(block)) {
      continue;
    }
    seen.add(block);
    if (block.id === blockId) {
      return block;
    }
    const nestedContainer = findBlockInList(block.schema.containerBlocks ?? [], blockId, seen);
    if (nestedContainer) {
      return nestedContainer;
    }
    const nestedComponentList = findBlockInList(block.schema.componentListBlocks ?? [], blockId, seen);
    if (nestedComponentList) {
      return nestedComponentList;
    }
    const nestedExpandableStub = findBlockInList(block.schema.expandableStubBlocks?.children ?? [], blockId, seen);
    if (nestedExpandableStub) {
      return nestedExpandableStub;
    }
    const nestedExpandableContent = findBlockInList(block.schema.expandableContentBlocks?.children ?? [], blockId, seen);
    if (nestedExpandableContent) {
      return nestedExpandableContent;
    }
    if (block.schema.encryptedBlock) {
      const nestedEncrypted = findBlockInList([block.schema.encryptedBlock], blockId, seen);
      if (nestedEncrypted) {
        return nestedEncrypted;
      }
    }
    for (const item of block.schema.gridItems ?? []) {
      const nestedGridBlock = findBlockInList([item.block], blockId, seen);
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
      ...(block.schema.encryptedBlock ? [block.schema.encryptedBlock] : []),
    ];
    const nestedPath = findBlockPathInList(nestedBlocks, blockId);
    if (nestedPath) {
      return [block.id, ...nestedPath];
    }
  }
  return null;
}

export function removeBlockFromList(blocks: VisualBlock[], blockId: string, seen = new Set<VisualBlock>()): boolean {
  const index = blocks.findIndex((candidate) => candidate.id === blockId);
  if (index >= 0) {
    blocks.splice(index, 1);
    return true;
  }
  for (const block of blocks) {
    if (seen.has(block)) {
      continue;
    }
    seen.add(block);
    if (removeBlockFromList(block.schema.containerBlocks ?? [], blockId, seen)) {
      return true;
    }
    if (removeBlockFromList(block.schema.componentListBlocks ?? [], blockId, seen)) {
      return true;
    }
    if (removeBlockFromList(block.schema.expandableStubBlocks?.children ?? [], blockId, seen)) {
      return true;
    }
    if (removeBlockFromList(block.schema.expandableContentBlocks?.children ?? [], blockId, seen)) {
      return true;
    }
    const gridItems = block.schema.gridItems ?? [];
    const gridIndex = gridItems.findIndex((item) => item.block.id === blockId);
    if (gridIndex >= 0) {
      gridItems.splice(gridIndex, 1);
      return true;
    }
    for (const item of gridItems) {
      if (removeBlockFromGridItem(item.block, blockId, seen)) {
        return true;
      }
    }
  }
  return false;
}

function removeBlockFromGridItem(block: VisualBlock, blockId: string, seen: Set<VisualBlock>): boolean {
  if (seen.has(block)) {
    return false;
  }
  seen.add(block);
  return removeBlockFromList(block.schema.containerBlocks ?? [], blockId, seen)
    || removeBlockFromList(block.schema.componentListBlocks ?? [], blockId, seen)
    || removeBlockFromList(block.schema.expandableStubBlocks?.children ?? [], blockId, seen)
    || removeBlockFromList(block.schema.expandableContentBlocks?.children ?? [], blockId, seen)
    || removeBlockFromGridItems(block.schema.gridItems ?? [], blockId, seen);
}

function removeBlockFromGridItems(gridItems: NonNullable<VisualBlock['schema']['gridItems']>, blockId: string, seen: Set<VisualBlock>): boolean {
  const gridIndex = gridItems.findIndex((item) => item.block.id === blockId);
  if (gridIndex >= 0) {
    gridItems.splice(gridIndex, 1);
    return true;
  }
  return gridItems.some((item) => removeBlockFromGridItem(item.block, blockId, seen));
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

export function handleBlockFieldInput(target: HTMLElement, options: { migrateFillInPlaceholders?: boolean } = {}): boolean {
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

  if (field === 'rich-code-language') {
    if (!(target instanceof HTMLInputElement)) {
      return false;
    }
    const richEditor = target.closest<HTMLElement>('.text-editor-shell')?.querySelector<HTMLElement>('.rich-editor');
    if (!richEditor) {
      return false;
    }
    updateRichCodeBlockLanguageInput(target);
    removeNonTextContentFromRichEditor(richEditor);
    normalizeSortValueAnnotationDom(richEditor);
    normalizeEditableListDom(richEditor);
    normalizeInlineCodeTextNodes(richEditor);
    const editedMarkdown = normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(turndown.turndown(getRichEditorSerializableHtml(richEditor))));
    block.text = state.editorMode === 'mobile-adjustment' ? applyMobileAltAdjustment(block.text, editedMarkdown) : editedMarkdown;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    if (shouldRefreshReaderPanelsAfterRichInput(richEditor)) {
      refreshReaderPanelsOutsideActiveEditor(richEditor);
    }
    return true;
  }

  if (field === 'caption-rich') {
    removeNonTextContentFromRichEditor(target);
    normalizeSortValueAnnotationDom(target);
    normalizeEditableListDom(target);
    convertInlineCodeInsertedShortcut(target);
    normalizeInlineCodeTextNodes(target);
    const editedMarkdown = normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(turndown.turndown(getRichEditorSerializableHtml(target))));
    let nextCaption: TextCaptionPayload | null = null;
    if (block.schema.kind === 'image') {
      nextCaption = updateTextCaptionText(block.schema.caption, editedMarkdown);
      block.schema.caption = nextCaption;
    } else if (state.captionTextModal?.target.kind === 'plugin-config') {
      const key = state.captionTextModal.target.configKey;
      const current = normalizeTextCaption(block.schema.pluginConfig[key]);
      nextCaption = updateTextCaptionText(current, editedMarkdown);
      state.captionTextModal.onChange?.(nextCaption);
    } else {
      return false;
    }
    refreshCaptionModalPreview(target, nextCaption);
    if (block.schema.kind === 'image') {
      syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
      getRefreshReaderPanels()();
    }
    return true;
  }

  if (field === 'block-rich' || field === 'text-fill-in-rich') {
    let turndownMs = 0;
    let syncMs = 0;
    let refreshMs = 0;
    let stepStartedAt = performance.now();
    removeNonTextContentFromRichEditor(target);
    normalizeSortValueAnnotationDom(target);
    normalizeEditableListDom(target);
    convertInlineCodeInsertedShortcut(target);
    normalizeInlineCodeTextNodes(target);
    const editedMarkdown = normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(turndown.turndown(
      field === 'text-fill-in-rich' ? getTextFillInRichEditorHtml(target) : getRichEditorSerializableHtml(target)
    )));
    block.text = state.editorMode === 'mobile-adjustment' ? applyMobileAltAdjustment(block.text, editedMarkdown) : editedMarkdown;
    if (field === 'text-fill-in-rich') {
      block.schema.fillIn = hasTextFillInMarker(block.text);
    }
    turndownMs = performance.now() - stepStartedAt;
    if (field === 'block-rich') {
      syncEditableTaskListMarkup(target, block.text);
    }
    stepStartedAt = performance.now();
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    const sortValuesChanged = syncSortValuesForDocument(state.document);
    syncMs = performance.now() - stepStartedAt;
    stepStartedAt = performance.now();
    if ((state.currentView !== 'ai' && sortValuesChanged) || shouldRefreshReaderPanelsAfterRichInput(target)) {
      refreshReaderPanelsOutsideActiveEditor(target);
    }
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

  if (field === 'text-fill-in-value') {
    block.text = buildTextFromFillInEditor(target, block, options.migrateFillInPlaceholders === true);
    block.schema.fillIn = hasTextFillInMarker(block.text);
    if (options.migrateFillInPlaceholders === true) {
      block.schema.placeholder = '';
    }
    scheduleCompletedMultiSlotFillInBlur(target, block);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    const sortValuesChanged = syncSortValuesForDocument(state.document);
    if ((state.currentView !== 'ai' && sortValuesChanged) || !target.closest('.editor-tree, .hvy-ai-reader-surface')) {
      refreshReaderPanelsOutsideActiveEditor(target);
    }
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
    refreshReaderPanelsOutsideActiveEditor(target);
    return true;
  }

  if (field === 'block-plugin-query' && target instanceof HTMLTextAreaElement) {
    block.text = target.value;
    resetDbTableViewState(target.dataset.sectionKey ?? '', block.id);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanelsOutsideActiveEditor(target);
    return true;
  }

  if (field === 'block-xref-title') {
    block.schema.xrefTitle = target instanceof HTMLInputElement ? target.value : getInlineEditableText(target);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    return true;
  }

  if (field === 'block-xref-detail') {
    block.schema.xrefDetail = target instanceof HTMLInputElement ? target.value : getInlineEditableText(target);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    return true;
  }

  if (field === 'block-xref-target' && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
    const previousTarget = block.schema.xrefTarget;
    block.schema.xrefTarget = normalizeXrefTarget(target.value);
    applyXrefTargetDefaults(block, previousTarget);
    syncXrefEditorAfterTargetInput(target, block);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    return true;
  }

  if (field === 'block-xref-target-tag-filter' && target instanceof HTMLInputElement) {
    block.schema.xrefTargetTagFilter = target.value;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanelsOutsideActiveEditor(target);
    return true;
  }

  if (field === 'block-component-list-component' && target instanceof HTMLSelectElement) {
    if (isPdfDocument(state.document) && !isPdfAllowedComponent(target.value, state.document.meta)) {
      return true;
    }
    const previousComponent = block.schema.componentListComponent || 'item';
    const previousLabel = inferComponentListItemLabel(previousComponent);
    const shouldRefreshLabel =
      block.schema.componentListItemLabel.trim().length === 0
      || block.schema.componentListItemLabel.trim() === previousLabel;
    block.schema.componentListComponent = target.value;
    if (shouldRefreshLabel) {
      block.schema.componentListItemLabel = inferComponentListItemLabel(target.value);
    }
    ensureComponentListBlocks(block);
    block.schema.componentListBlocks.forEach((itemBlock) => {
      itemBlock.schema.component = target.value;
      applyComponentDefaults(itemBlock.schema, target.value);
      syncSortValuesForListItem(state.document.meta, itemBlock);
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
    refreshReaderPanelsOutsideActiveEditor(target);
    return true;
  }

  if (field === 'block-grid-stack-width' && target instanceof HTMLInputElement) {
    block.schema.gridStackWidth = target.value.trim().length === 0
      ? DEFAULT_GRID_STACK_WIDTH
      : coerceGridStackWidth(target.value);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanelsOutsideActiveEditor(target);
    return true;
  }

  if (field === 'block-grid-stack-never' && target instanceof HTMLInputElement) {
    block.schema.gridStackWidth = target.checked ? 'never' : DEFAULT_GRID_STACK_WIDTH;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    getRefreshReaderPanels()();
    getRenderApp()();
    return true;
  }

  if (field === 'block-grid-item-component' && target instanceof HTMLSelectElement) {
    if (isPdfDocument(state.document) && !isPdfAllowedComponent(target.value, state.document.meta)) {
      return true;
    }
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
      const previousBlockId = item.block.id;
      item.block = createEmptyBlock(target.value);
      item.block.id = previousBlockId;
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
    removeNonTextContentFromRichEditor(target);
    normalizeEditableListDom(target);
    item.block.text = normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(turndown.turndown(target.innerHTML)));
    turndownMs = performance.now() - stepStartedAt;
    syncEditableTaskListMarkup(target, item.block.text);
    stepStartedAt = performance.now();
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    const sortValuesChanged = syncSortValuesForDocument(state.document);
    syncMs = performance.now() - stepStartedAt;
    stepStartedAt = performance.now();
    if ((state.currentView !== 'ai' && sortValuesChanged) || shouldRefreshReaderPanelsAfterRichInput(target)) {
      refreshReaderPanelsOutsideActiveEditor(target);
    }
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
    refreshReaderPanelsOutsideActiveEditor(target);
    return true;
  }

  if (field === 'block-code' && target instanceof HTMLTextAreaElement) {
    block.text = target.value;
    refreshReaderPanelsOutsideActiveEditor(target);
    return true;
  }

  if (field === 'block-expandable-always' && target instanceof HTMLInputElement) {
    if (state.editorMode === 'mobile-adjustment') {
      target.checked = block.schema.expandableAlwaysShowStub;
      return true;
    }
    block.schema.expandableAlwaysShowStub = target.checked;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanelsOutsideActiveEditor(target);
    return true;
  }

  if (field === 'table-show-header' && target instanceof HTMLInputElement) {
    block.schema.tableShowHeader = target.checked;
    refreshReaderPanelsOutsideActiveEditor(target);
    return true;
  }

  if (field === 'table-column') {
    const columnIndex = Number.parseInt(target.dataset.columnIndex ?? '', 10);
    if (!Number.isNaN(columnIndex)) {
      const columns = getTableColumns(block.schema);
      columns[columnIndex] = getInlineEditableMarkdown(target);
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
      row.cells[cellIndex] = getInlineEditableMarkdown(target, { preserveLineBreaks: true });
      if (row.editorCreatedByEnter && !isEmptyTableRow(row, getTableColumns(block.schema).length)) {
        delete row.editorCreatedByEnter;
      }
      syncTableRowEmptyClass(target);
      const sortValuesChanged = syncSortValuesForDocument(state.document);
      if (state.currentView !== 'ai' && sortValuesChanged) {
        getRefreshReaderPanels()();
      }
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

function syncXrefEditorAfterTargetInput(target: HTMLElement, block: VisualBlock): void {
  const editor = target.closest<HTMLElement>('.editor-xref-card');
  if (!editor) {
    return;
  }
  const hasTarget = normalizeXrefTarget(block.schema.xrefTarget).length > 0;
  editor.classList.toggle('is-target-empty', !hasTarget);
  editor.querySelectorAll<HTMLElement>('[data-field="block-xref-title"], [data-field="block-xref-detail"]').forEach((field) => {
    if (hasTarget) {
      field.removeAttribute('aria-disabled');
    } else {
      field.setAttribute('aria-disabled', 'true');
    }
  });
  const title = editor.querySelector<HTMLElement>('[data-field="block-xref-title"]');
  if (title) {
    title.textContent = hasTarget ? block.schema.xrefTitle || 'Untitled' : 'Pick a target first';
  }
  const detail = editor.querySelector<HTMLElement>('[data-field="block-xref-detail"]');
  if (detail) {
    detail.textContent = hasTarget ? block.schema.xrefDetail : '';
  }
}

function shouldRefreshReaderPanelsAfterRichInput(target: HTMLElement): boolean {
  return !target.closest('.editor-tree, .editor-sidebar, .hvy-ai-reader-surface');
}

export function refreshReaderPanelsOutsideActiveEditor(target: HTMLElement): void {
  const surface = getRefreshSurfaceOutsideActiveEditor(target);
  getRefreshReaderPanels()({ ...(surface === 'all' ? {} : { surface }), runDocumentHooks: false });
}

function getRefreshSurfaceOutsideActiveEditor(target: HTMLElement): ReaderPanelRefreshSurface {
  if (target.closest('.editor-sidebar, #readerSidebarSections, #aiSidebarSections')) {
    return 'reader';
  }
  if (target.closest('#readerDocument, #aiReaderDocument')) {
    return 'sidebar';
  }
  return 'all';
}

function refreshCaptionModalPreview(target: HTMLElement, caption: TextCaptionPayload | null): void {
  const modal = target.closest<HTMLElement>('.caption-text-modal');
  const preview = modal?.querySelector<HTMLElement>('.caption-text-modal-preview .image-caption');
  if (!preview) {
    return;
  }
  const helpers = getCachedComponentRenderHelpers();
  preview.innerHTML = renderTextCaptionHtml(caption, helpers);
  preview.style.textAlign = caption?.schema.align ?? 'center';
}

function buildTextFromFillInEditor(target: HTMLElement, block: VisualBlock, migrateFillInPlaceholders: boolean): string {
  const editor = target.closest<HTMLElement>('.text-fill-in-editor');
  if (!editor) {
    return target.textContent ?? '';
  }
  let parts: string[];
  try {
    const parsed = JSON.parse(editor.dataset.fillParts ?? '[]') as unknown;
    parts = Array.isArray(parsed) && parsed.every((part) => typeof part === 'string') ? parsed : [];
  } catch {
    parts = [];
  }
  const fillIns = Array.from(editor.querySelectorAll<HTMLElement>('[data-field="text-fill-in-value"]'));
  if (parts.length !== fillIns.length + 1) {
    return target.textContent ?? '';
  }
  return parts
    .map((part, index) => {
      if (index >= fillIns.length) {
        return part;
      }
      const value = (fillIns[index]?.textContent ?? '').replaceAll('\u200b', '');
      return `${part}${value.length > 0 ? value : createTextFillInMarker(getTextFillInSlotPlaceholder(fillIns[index], block, index, migrateFillInPlaceholders))}`;
    })
    .join('');
}

function scheduleCompletedMultiSlotFillInBlur(target: HTMLElement, block: VisualBlock): void {
  const existingTimer = completedMultiSlotFillInBlurTimers.get(target);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }
  const editor = target.closest<HTMLElement>('.text-fill-in-editor');
  const startedAsMultiSlot = (editor?.querySelectorAll<HTMLElement>('[data-field="text-fill-in-value"]').length ?? 0) > 1;
  if (!startedAsMultiSlot || block.schema.fillIn) {
    completedMultiSlotFillInBlurTimers.delete(target);
    return;
  }
  completedMultiSlotFillInBlurTimers.set(target, window.setTimeout(() => {
    completedMultiSlotFillInBlurTimers.delete(target);
    if (document.activeElement === target && !block.schema.fillIn) {
      target.blur();
    }
  }, 250));
}

function getTextFillInSlotPlaceholder(fillIn: HTMLElement | undefined, block: VisualBlock, index: number, migrateFillInPlaceholders: boolean): string {
  const markerPlaceholder = fillIn?.dataset.placeholder ?? '';
  if (!migrateFillInPlaceholders) {
    return markerPlaceholder;
  }
  if (markerPlaceholder && markerPlaceholder !== 'value') {
    return markerPlaceholder;
  }
  const blockPlaceholder = block.schema.placeholder
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)[index] ?? '';
  return blockPlaceholder || markerPlaceholder;
}

function getTextFillInRichEditorHtml(editor: HTMLElement): string {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>('[data-field="text-fill-in-value"]').forEach((fillIn) => {
    const value = (fillIn.textContent ?? '').replaceAll('\u200b', '');
    if (value.length > 0) {
      fillIn.replaceWith(document.createTextNode(value));
      return;
    }
    const marker = document.createElement('span');
    marker.dataset.hvyFillInMarker = 'true';
    const placeholder = fillIn.dataset.placeholder ?? '';
    if (placeholder) {
      marker.setAttribute('data-placeholder', placeholder);
    }
    marker.textContent = placeholder || 'value';
    fillIn.replaceWith(marker);
  });
  return clone.innerHTML;
}

function getInlineEditableMarkdown(target: HTMLElement, options: { preserveLineBreaks?: boolean } = {}): string {
  const markdown = normalizeEditorMarkdownWhitespace(turndown.turndown(target)).replaceAll('\u200b', '');
  return options.preserveLineBreaks
    ? markdown.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim()
    : markdown.replace(/\s*\n+\s*/g, ' ').trim();
}

function syncTableRowEmptyClass(target: HTMLElement): void {
  const row = target.closest<HTMLElement>('.table-row-editor');
  if (!row) {
    return;
  }
  const cells = Array.from(row.querySelectorAll<HTMLElement>('[data-field="table-cell"]'));
  row.classList.toggle('table-row-editor-empty', cells.every((cell) => getInlineEditableMarkdown(cell).trim().length === 0));
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
  if (state.currentView !== 'ai') {
    getRefreshReaderPanels()();
  }
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
  return state.activeEditorBlockPath.some((active) => active.sectionKey === sectionKey && active.blockId === blockId);
}

export function isActiveEditorLeafBlock(sectionKey: string, blockId: string): boolean {
  return state.activeEditorBlock?.sectionKey === sectionKey && state.activeEditorBlock.blockId === blockId;
}

type SetActiveEditorBlockOptions = {
  targetOnly?: boolean;
  pathBlockIds?: string[];
  textEditorMode?: 'rich' | 'fill-in' | null;
};

export function setActiveEditorBlock(sectionKey: string, blockId: string, options: SetActiveEditorBlockOptions = {}): void {
  const pathIds = options.pathBlockIds ?? (options.targetOnly ? [blockId] : getEditorBlockPathIds(sectionKey, blockId) ?? [blockId]);
  state.activeEditorBlockPath = pathIds.map((pathBlockId) => ({ sectionKey, blockId: pathBlockId }));
  state.activeEditorBlock = { sectionKey, blockId };
  state.activeTextEditorMode = options.textEditorMode ? { sectionKey, blockId, mode: options.textEditorMode } : null;
  state.activeEditorBlockSnapshots = state.activeEditorBlockPath
    .map((active) => {
      const existing = state.activeEditorBlockSnapshots.find(
        (snapshot) => snapshot.sectionKey === active.sectionKey && snapshot.blockId === active.blockId
      );
      return existing ?? createEditorBlockSnapshot(active.sectionKey, active.blockId);
    })
    .filter((snapshot): snapshot is NonNullable<AppState['activeEditorBlockSnapshot']> => Boolean(snapshot));
  state.activeEditorBlockSnapshot =
    state.activeEditorBlockSnapshots.find((snapshot) => snapshot.sectionKey === sectionKey && snapshot.blockId === blockId)
    ?? null;
  openExpandableEditorPanelsToBlock(sectionKey, blockId);
  state.pendingEditorActivation = {
    sectionKey,
    blockId,
    revealPath: false,
  };
}

export function setAiEditorHostBlock(sectionKey: string, blockId: string): void {
  state.aiEditorHostBlock = { sectionKey, blockId };
  state.aiEditorHostSectionKey = null;
}

export function clearAiEditorHostBlock(): void {
  state.aiEditorHostBlock = null;
  state.aiEditorHostSectionKey = null;
}

export function markActiveEditorBlockAsNew(blockId: string): void {
  state.activeEditorNewBlockIds.add(blockId);
}

function getEditorBlockPathIds(sectionKey: string, blockId: string): string[] | null {
  const rootBlocks = getEditorRootBlocks(sectionKey);
  return rootBlocks ? findBlockPathInList(rootBlocks, blockId) : null;
}

function createEditorBlockSnapshot(sectionKey: string, blockId: string): AppState['activeEditorBlockSnapshot'] {
  const block = findBlockByIds(sectionKey, blockId);
  return block ? { sectionKey, blockId, block: cloneVisualBlock(block) } : null;
}

function cloneVisualBlock(block: VisualBlock): VisualBlock {
  return JSON.parse(JSON.stringify(block)) as VisualBlock;
}

function openExpandableEditorPanelsToBlock(sectionKey: string, blockId: string): void {
  const rootBlocks = getEditorRootBlocks(sectionKey);
  if (!rootBlocks) {
    return;
  }
  openExpandableEditorPanelsInList(sectionKey, rootBlocks, blockId);
}

function getEditorRootBlocks(sectionKey: string): VisualBlock[] | null {
  const sqliteRowComponentModal = state.sqliteRowComponentModal;
  if (sqliteRowComponentModal?.sectionKey === sectionKey) {
    return sqliteRowComponentModal.blocks;
  }
  const reusableName = getReusableNameFromSectionKey(sectionKey);
  if (reusableName) {
    const template = getReusableTemplateByName(reusableName);
    return template ? [template] : null;
  }
  const section = findSectionByKey(state.document.sections, sectionKey);
  return section?.blocks ?? null;
}

function openExpandableEditorPanelsInList(sectionKey: string, blocks: VisualBlock[], targetBlockId: string): boolean {
  for (const block of blocks) {
    if (block.id === targetBlockId) {
      return true;
    }

    if (resolveBaseComponent(block.schema.component) === 'expandable') {
      if (openExpandableEditorPanelsInList(sectionKey, block.schema.expandableStubBlocks?.children ?? [], targetBlockId)) {
        setExpandableEditorPanelOpen(sectionKey, block.id, 'stub');
        return true;
      }
      if (openExpandableEditorPanelsInList(sectionKey, block.schema.expandableContentBlocks?.children ?? [], targetBlockId)) {
        setExpandableEditorPanelOpen(sectionKey, block.id, 'expanded');
        return true;
      }
    }

    if (openExpandableEditorPanelsInList(sectionKey, block.schema.containerBlocks ?? [], targetBlockId)) {
      return true;
    }
    if (openExpandableEditorPanelsInList(sectionKey, block.schema.componentListBlocks ?? [], targetBlockId)) {
      return true;
    }
    if (openExpandableEditorPanelsInList(sectionKey, (block.schema.gridItems ?? []).map((item) => item.block), targetBlockId)) {
      return true;
    }
  }
  return false;
}

function setExpandableEditorPanelOpen(sectionKey: string, blockId: string, panel: 'stub' | 'expanded'): void {
  const key = `${sectionKey}:${blockId}`;
  const current = state.expandableEditorPanels[key] ?? { stubOpen: false, expandedOpen: false };
  state.expandableEditorPanels[key] = {
    ...current,
    [panel === 'stub' ? 'stubOpen' : 'expandedOpen']: true,
  };
}


export function clearActiveEditorBlock(blockId?: string): void {
  if (!state.activeEditorBlock) {
    return;
  }
  if (!blockId) {
    state.activeEditorBlock = null;
    state.aiEditorHostBlock = null;
    state.aiEditorHostSectionKey = null;
    state.activeEditorBlockSnapshot = null;
    state.activeEditorBlockPath = [];
    state.activeEditorBlockSnapshots = [];
    state.activeEditorNewBlockIds.clear();
    return;
  }
  const index = state.activeEditorBlockPath.findIndex((active) => active.blockId === blockId);
  if (index >= 0) {
    closeActiveEditorPathFromIndex(index);
  }
}

export type DeactivateEditorBlockResult = 'closed' | 'removed' | 'unchanged';

export function hasActiveEditorBlockChanges(sectionKey: string, blockId: string): boolean {
  if (state.activeEditorNewBlockIds.has(blockId)) {
    return true;
  }
  const snapshot = state.activeEditorBlockSnapshots.find(
    (candidate) => candidate.sectionKey === sectionKey && candidate.blockId === blockId
  );
  const block = findBlockByIds(sectionKey, blockId);
  return !snapshot || !block || !visualBlocksEqual(block, snapshot.block);
}

export function deactivateEditorBlock(sectionKey: string, blockId: string): DeactivateEditorBlockResult {
  const index = state.activeEditorBlockPath.findIndex(
    (active) => active.sectionKey === sectionKey && active.blockId === blockId
  );
  if (index < 0) {
    return 'unchanged';
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (block?.schema.kind === 'table' && pruneEmptyKeyboardInsertedTableRows(block.schema)) {
    syncReusableTemplateForBlock(sectionKey, blockId);
  }
  if (block && shouldRemoveXrefOnEditorExit(block)) {
    const rootBlocks = getEditorRootBlocks(sectionKey);
    if (rootBlocks && removeBlockFromList(rootBlocks, blockId)) {
      syncReusableTemplateForBlock(sectionKey, blockId);
      closeActiveEditorPathFromIndex(index);
      return 'removed';
    }
  }
  closeActiveEditorPathFromIndex(index);
  return 'closed';
}

export type CancelEditorBlockEditResult = 'closed' | 'removed' | 'unchanged' | 'needs-confirmation';

export function cancelEditorBlockEdit(
  sectionKey: string,
  blockId: string,
  options: { confirmChangedNewBlock?: boolean } = {}
): CancelEditorBlockEditResult {
  const index = state.activeEditorBlockPath.findIndex(
    (active) => active.sectionKey === sectionKey && active.blockId === blockId
  );
  if (index < 0) {
    return 'unchanged';
  }
  const snapshot = state.activeEditorBlockSnapshots.find(
    (candidate) => candidate.sectionKey === sectionKey && candidate.blockId === blockId
  );
  const block = findBlockByIds(sectionKey, blockId);
  if (state.activeEditorNewBlockIds.has(blockId) && block) {
    const changed = snapshot ? !visualBlocksEqual(block, snapshot.block) : true;
    if (changed && !options.confirmChangedNewBlock) {
      return 'needs-confirmation';
    }
    const rootBlocks = getEditorRootBlocks(sectionKey);
    if (rootBlocks && removeBlockFromList(rootBlocks, blockId)) {
      state.activeEditorNewBlockIds.delete(blockId);
      syncReusableTemplateForBlock(sectionKey, blockId);
      closeActiveEditorPathFromIndex(index);
      return 'removed';
    }
  }
  if (snapshot) {
    if (block) {
      const restored = cloneVisualBlock(snapshot.block);
      block.text = restored.text;
      block.schema = restored.schema;
      block.schemaMode = restored.schemaMode;
    }
  }
  closeActiveEditorPathFromIndex(index);
  return 'closed';
}

function closeActiveEditorPathFromIndex(index: number): void {
  const closing = state.activeEditorBlockPath.slice(index);
  state.activeEditorBlockPath = state.activeEditorBlockPath.slice(0, index);
  state.activeEditorBlockSnapshots = state.activeEditorBlockSnapshots.filter((snapshot) =>
    state.activeEditorBlockPath.some((active) => active.sectionKey === snapshot.sectionKey && active.blockId === snapshot.blockId)
  );
  closing.forEach((active) => state.activeEditorNewBlockIds.delete(active.blockId));
  const leaf = state.activeEditorBlockPath[state.activeEditorBlockPath.length - 1] ?? null;
  state.activeEditorBlock = leaf ? { ...leaf } : null;
  if (!state.activeEditorBlock) {
    state.aiEditorHostBlock = null;
    state.aiEditorHostSectionKey = null;
  }
  state.activeEditorBlockSnapshot = leaf
    ? state.activeEditorBlockSnapshots.find((snapshot) => snapshot.sectionKey === leaf.sectionKey && snapshot.blockId === leaf.blockId) ?? null
    : null;
}

function visualBlocksEqual(left: VisualBlock, right: VisualBlock): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shouldRemoveXrefOnEditorExit(block: VisualBlock): boolean {
  return resolveBaseComponent(block.schema.component) === 'xref-card'
    && normalizeXrefTarget(block.schema.xrefTarget).length === 0;
}

export function blockContainsBlockId(block: VisualBlock, blockId: string): boolean {
  return Boolean(
    findBlockInList(block.schema.containerBlocks ?? [], blockId)
      || findBlockInList(block.schema.componentListBlocks ?? [], blockId)
      || findBlockInList((block.schema.gridItems ?? []).map((item) => item.block), blockId)
      || findBlockInList(block.schema.expandableStubBlocks?.children ?? [], blockId)
      || findBlockInList(block.schema.expandableContentBlocks?.children ?? [], blockId)
      || findBlockInList(block.schema.encryptedBlock ? [block.schema.encryptedBlock] : [], blockId)
  );
}

export function isActiveEditorSectionTitle(sectionKey: string): boolean {
  return state.activeEditorSectionTitleKey === sectionKey;
}

export function getComponentRenderHelpers(editorRenderer: {
  renderRichToolbar: ComponentRenderHelpers['renderRichToolbar'];
  renderEditorBlock: (sectionKey: string, block: VisualBlock, sections: import('./editor/types').VisualSection[], parentLocked?: boolean) => string;
  renderPassiveEditorBlock: (sectionKey: string, block: VisualBlock, sections: import('./editor/types').VisualSection[]) => string;
  renderTextFragment: ComponentRenderHelpers['renderTextFragment'];
  renderComponentFragment: ComponentRenderHelpers['renderComponentFragment'];
  renderComponentPlacementTarget: ComponentRenderHelpers['renderComponentPlacementTarget'];
}, readerRenderer: {
  renderReaderBlock: ComponentRenderHelpers['renderReaderBlock'];
  renderReaderBlocks: ComponentRenderHelpers['renderReaderBlocks'];
  renderReaderListBlocks: ComponentRenderHelpers['renderReaderListBlocks'];
  orderReaderBlocks: ComponentRenderHelpers['orderReaderBlocks'];
  orderReaderListBlocks: ComponentRenderHelpers['orderReaderListBlocks'];
  isReaderViewPrioritizedBlock: ComponentRenderHelpers['isReaderViewPrioritizedBlock'];
}): ComponentRenderHelpers {
  const renderAllowedComponentOptions = (selected: string): string => {
    if (!isPdfDocument(state.document)) {
      return renderComponentOptions(selected);
    }
    const builtins = ['text', 'container', 'component-list', 'grid', 'image', ...(isPdfAllowedComponent('table', state.document.meta) ? ['table'] : [])];
    const custom = getComponentDefs()
      .map((def) => def.name.trim())
      .filter((name) => name.length > 0 && isPdfAllowedComponent(name, state.document.meta));
    return [...new Set([...builtins, ...custom])]
      .map((option) => renderOption(option, selected))
      .join('');
  };
  const pdfComponentFilter = (componentName: string, pluginId?: string): boolean => {
    return !isPdfDocument(state.document) || isPdfAllowedComponentInstance(componentName, state.document.meta, pluginId);
  };
  const pdfComponentDisabledReason = (componentName: string, pluginId?: string): string | null => {
    return pdfComponentFilter(componentName, pluginId) ? null : 'Not supported in PHVY';
  };
  return {
    escapeAttr,
    escapeHtml,
    markdownToEditorHtml: (markdown, codeLanguageInputAttrs) => highlightEditorSearchMatches(renderMarkdownToEditorHtml(markdown, {
      textLineStyles: getTextLineStylesFromMeta(state.document.meta),
      textLineStyleMode: 'editor',
      codeLanguageInputAttrs,
    })),
    renderRichToolbar: editorRenderer.renderRichToolbar,
    renderEditorBlock: (sectionKey, block, parentLocked) => editorRenderer.renderEditorBlock(sectionKey, block, state.document.sections, parentLocked),
    renderPassiveEditorBlock: (sectionKey, block) => editorRenderer.renderPassiveEditorBlock(sectionKey, block, state.document.sections),
    renderReaderBlock: readerRenderer.renderReaderBlock,
    renderReaderBlocks: readerRenderer.renderReaderBlocks,
    renderReaderListBlocks: readerRenderer.renderReaderListBlocks,
    orderReaderBlocks: readerRenderer.orderReaderBlocks,
    orderReaderListBlocks: readerRenderer.orderReaderListBlocks,
    isReaderViewPrioritizedBlock: readerRenderer.isReaderViewPrioritizedBlock,
    renderTextFragment: editorRenderer.renderTextFragment,
    renderComponentFragment: editorRenderer.renderComponentFragment,
    renderComponentOptions: renderAllowedComponentOptions,
    renderAddComponentPicker: (options) => renderAddComponentPicker(
      { ...options, ...(isPdfDocument(state.document) ? { componentFilter: pdfComponentFilter, componentDisabledReason: pdfComponentDisabledReason } : {}) },
      { escapeAttr, escapeHtml, getComponentDefs }
    ),
    renderComponentPlacementTarget: (options) => editorRenderer.renderComponentPlacementTarget(options),
    renderOption,
    getDocumentComponentCss: (componentName: string) => getDocumentComponentDefaultCss(state.document.meta, componentName),
    getXrefTargetOptions,
    isXrefTargetValid,
    getEffectiveXrefTargetTagFilter: (block) => getEffectiveXrefTargetTagFilter(state.document, block),
    isCrossDocumentLinksEnabled: () => state.crossDocumentLinksEnabled === true,
    getTableColumns,
    ensureContainerBlocks,
    ensureComponentListBlocks,
    getSelectedAddComponent: (key: string, fallback: string) => state.addComponentBySection[key] ?? fallback,
    getComponentListReaderViewId: (sectionKey, blockId) => state.componentListReaderViews[`${sectionKey}:${blockId}`] ?? '',
    getReaderContainerExpanded: (key, fallback) => state.readerContainerState[key] ?? fallback,
    isExpandableEditorPanelOpen: (sectionKey, blockId, panel, fallback) =>
      state.expandableEditorPanels[`${sectionKey}:${blockId}`]?.[panel === 'stub' ? 'stubOpen' : 'expandedOpen'] ?? fallback,
    isAdvancedEditorMode: () => state.showAdvancedEditor,
    isMobileAdjustmentMode: () => state.editorMode === 'mobile-adjustment',
    isReusableDefinitionEditor: () => state.reusableDefinitionEditModal?.mode === 'edit',
    isPdfDocument: () => isPdfDocument(state.document),
    getTextLineStyles: () => getTextLineStylesFromMeta(state.document.meta),
  };
}

export function highlightEditorSearchMatches(html: string): string {
  if (state.currentView !== 'editor') {
    return html;
  }
  const query = state.search.submittedQuery.trim();
  if (!query || state.search.filterEnabled) {
    return html;
  }
  return highlightSearchHtml(html, query, state.search.caseSensitive);
}

export function applyRichAction(
  action: string,
  editable: HTMLElement,
  value?: string,
  options: { sortValueKey?: string; sortValueType?: string } = {}
): void {
  if (action === 'fill-in') {
    if (applyTextFillInSlot(editable)) {
      routeNextUndoToDocument();
    }
    return;
  }
  if (action === 'sort-value') {
    if (applySortValueAnnotation(editable, options)) {
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      routeNextUndoToDocument();
    }
    return;
  }
  if (action === 'text-line-style') {
    const styleName = value ?? '';
    applyTextLineStyleToSelection(editable, styleName);
    updateRichToolbarState(editable, styleName);
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable, styleName);
    return;
  }
  const annotationAction = normalizeAnnotationAction(action);
  if (annotationAction && toggleExistingTableAnnotationPreview(annotationAction, editable)) {
    updateRichToolbarState(editable);
    return;
  }
  if (annotationAction) {
    const changed = toggleAnnotationAction(editable, annotationAction);
    updateRichToolbarState(editable);
    if (changed) {
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    return;
  }
  if (action === 'bold') {
    applyInlineRichAction(editable, 'strong', 'bold');
  } else if (action === 'italic') {
    applyInlineRichAction(editable, 'em', 'italic');
  } else if (action === 'underline') {
    applyInlineRichAction(editable, 'u', 'underline');
  } else if (action === 'strikethrough') {
    applyInlineRichAction(editable, 's', 'strikethrough');
  } else if (action === 'paragraph') {
    clearInlineTypingState(editable);
    formatSelectionBlock(editable, 'p');
  } else if (action.startsWith('heading-')) {
    clearInlineTypingState(editable);
    const level = action.split('-')[1] ?? '2';
    const currentBlock = getSelectionBlockElement(editable);
    const nextBlock = currentBlock?.tagName.toLowerCase() === `h${level}` ? 'p' : `h${level}`;
    formatSelectionBlock(editable, nextBlock);
  } else if (action === 'list') {
    clearInlineTypingState(editable);
    toggleSelectionList(editable, 'ul');
  } else if (action === 'ordered-list') {
    clearInlineTypingState(editable);
    toggleSelectionList(editable, 'ol');
  } else if (action === 'checklist') {
    clearInlineTypingState(editable);
    insertInlineCheckboxAtSelection(editable);
  } else if (action === 'quote') {
    clearInlineTypingState(editable);
    const currentBlock = getSelectionBlockElement(editable);
    formatSelectionBlock(editable, isSelectionInsideQuoteBlock(editable) || currentBlock?.tagName.toLowerCase() === 'blockquote' ? 'p' : 'blockquote');
  } else if (action === 'code-block') {
    clearInlineTypingState(editable);
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

function applySortValueAnnotation(
  editable: HTMLElement,
  options: { sortValueKey?: string; sortValueType?: string }
): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range || range.collapsed || range.toString().trim().length === 0) {
    return false;
  }
  const key = (options.sortValueKey ?? '').trim() || inferSortValueKey(range.toString(), options.sortValueType);
  const type: SortValueType = options.sortValueType === 'number' || options.sortValueType === 'datetime' || options.sortValueType === 'enum' ? options.sortValueType : 'text';
  ensureSortValueDefinition(editable, key, type);
  const wrapper = document.createElement('span');
  wrapper.className = 'hvy-sort-value';
  wrapper.dataset.hvySortValue = 'true';
  wrapper.dataset.sortValueKey = key;
  const fragment = range.extractContents();
  unwrapSortValueAnnotations(fragment, key);
  unwrapSortValueAnnotations(editable, key);
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);
  moveCaretAfterElement(wrapper);
  return true;
}

function moveCaretAfterElement(element: HTMLElement): void {
  const caretNode = document.createTextNode('\u200b');
  element.after(caretNode);
  const range = document.createRange();
  range.setStart(caretNode, caretNode.data.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  element.closest<HTMLElement>('[contenteditable="true"]')?.focus({ preventScroll: true });
}

function unwrapSortValueAnnotations(root: ParentNode, key: string): void {
  root.querySelectorAll<HTMLElement>(`[data-hvy-sort-value="true"][data-sort-value-key="${cssEscapeForSelector(key)}"]`).forEach((node) => {
    const parent = node.parentNode;
    if (!parent) {
      return;
    }
    while (node.firstChild) {
      parent.insertBefore(node.firstChild, node);
    }
    node.remove();
  });
}

function inferSortValueKey(text: string, type: string | undefined): string {
  if (type === 'number' || Number.isFinite(Number(text.trim()))) {
    return 'Value';
  }
  return 'Name';
}

function ensureSortValueDefinition(editable: HTMLElement, key: string, type: SortValueType): void {
  const blockId = editable.dataset.blockId ?? '';
  if (!blockId) {
    return;
  }
  const sectionKey = editable.dataset.sectionKey ?? '';
  const owner = getReusableNameFromSectionKey(sectionKey)
    ? findReusableOwner(sectionKey, blockId)
    : findSortValueOwnerBlock(state.document, blockId) ?? findBlockByIds(sectionKey, blockId);
  const componentName = owner?.schema.component.trim() ?? '';
  if (!componentName) {
    return;
  }
  const defs = Array.isArray(state.document.meta.component_defs) ? state.document.meta.component_defs : [];
  const definition = defs.find((item): item is { name: string; sortValueDefs?: Record<string, unknown> } =>
    !!item && typeof item === 'object' && (item as { name?: unknown }).name === componentName
  );
  if (!definition) {
    return;
  }
  const sortValueDefs = definition.sortValueDefs && typeof definition.sortValueDefs === 'object' && !Array.isArray(definition.sortValueDefs)
    ? definition.sortValueDefs
    : {};
  if (!sortValueDefs[key]) {
    sortValueDefs[key] = { type };
    definition.sortValueDefs = sortValueDefs;
  }
}

function isSelectionInsideQuoteBlock(editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range) {
    return false;
  }
  return Boolean(getAncestorElement(range.startContainer, editable, 'blockquote'));
}

function applyTextLineStyleToSelection(editable: HTMLElement, styleName: string): void {
  if (editable.dataset.field !== 'block-rich' && editable.dataset.field !== 'text-fill-in-rich') {
    return;
  }
  const range = getEditableSelectionRange(editable);
  const targets = getSelectedTextLineStyleBlocks(editable, range);
  for (const target of targets) {
    setTextLineStyleBlock(target, editable, styleName);
  }
}

function getSelectedTextLineStyleBlocks(editable: HTMLElement, range: Range | null): HTMLElement[] {
  if (!range) {
    const block = getSelectionTextLineStyleBlock(editable);
    return block ? [block] : [];
  }
  if (range.collapsed) {
    const block = getSelectionTextLineStyleBlock(editable);
    return block ? [block] : [];
  }
  const blocks = Array.from(editable.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  const selected = blocks.filter((block) => range.intersectsNode(block));
  if (selected.length > 0) {
    return selected;
  }
  const block = getSelectionTextLineStyleBlock(editable);
  return block ? [block] : [];
}

function getSelectionTextLineStyleBlock(editable: HTMLElement): HTMLElement | null {
  const range = getEditableSelectionRange(editable);
  if (!range) {
    return null;
  }
  const styled = getAncestorElement(range.startContainer, editable, '[data-hvy-text-line-style]');
  if (styled) {
    return styled;
  }
  const block = getSelectionBlockElement(editable);
  if (!block || block === editable) {
    return null;
  }
  const direct = getDirectEditableChild(block, editable);
  return direct ?? block;
}

function setTextLineStyleBlock(block: HTMLElement, editable: HTMLElement, styleName: string): void {
  const current = block.matches('[data-hvy-text-line-style]') ? block : null;
  const styles = getTextLineStylesFromMeta(state.document.meta);
  const style = styles[styleName];
  const css = style ? sanitizeTextLineStyleCss(style.css) : '';
  const label = style?.label.trim() || styleName;
  const range = getEditableSelectionRange(editable);
  const selectionOffsets = range && isRangeInsideElement(block, range)
    ? {
        start: getTextOffset(block, range.startContainer, range.startOffset),
        end: getTextOffset(block, range.endContainer, range.endOffset),
      }
    : null;
  if (!styleName) {
    if (current) {
      const emptyStyledBlock = getTextLineStyleContentBlock(current);
      unwrapTextLineStyleBlock(current);
      if (emptyStyledBlock && isEffectivelyEmptyBlock(emptyStyledBlock)) {
        emptyStyledBlock.replaceChildren(editable.ownerDocument.createElement('br'));
        placeCaretAtStart(emptyStyledBlock);
      }
    }
    return;
  }
  if (current) {
    current.dataset.hvyTextLineStyle = styleName;
    current.dataset.hvyTextLineStyleLabel = label;
    current.setAttribute('style', css);
    current.classList.toggle('is-unknown', !style);
    const marker = current.querySelector<HTMLElement>(':scope > .hvy-text-line-style-marker');
    if (marker) {
      marker.textContent = `^${styleName}^`;
    } else {
      current.prepend(createTextLineStyleMarker(styleName));
    }
    return;
  }
  const wrapper = createTextLineStyleWrapper(styleName, editable.ownerDocument);
  const shouldPlaceCaretInEmptyStyledBlock = Boolean(range?.collapsed && isEffectivelyEmptyBlock(block));
  if (shouldPlaceCaretInEmptyStyledBlock) {
    block.replaceChildren();
  }
  block.replaceWith(wrapper);
  wrapper.appendChild(block);
  if (selectionOffsets && selectionOffsets.start !== null && selectionOffsets.end !== null) {
    if (!restoreSelectionByTextOffsets(block, selectionOffsets.start, selectionOffsets.end) && shouldPlaceCaretInEmptyStyledBlock) {
      placeCaretAtStart(block);
    }
  } else if (shouldPlaceCaretInEmptyStyledBlock) {
    placeCaretAtStart(block);
  }
}

function createTextLineStyleWrapper(styleName: string, ownerDocument: Document): HTMLElement {
  const styles = getTextLineStylesFromMeta(state.document.meta);
  const style = styles[styleName];
  const wrapper = ownerDocument.createElement('div');
  wrapper.className = 'hvy-text-line-style';
  wrapper.dataset.hvyTextLineStyle = styleName;
  wrapper.dataset.hvyTextLineStyleLabel = style?.label.trim() || styleName;
  wrapper.setAttribute('style', style ? sanitizeTextLineStyleCss(style.css) : '');
  wrapper.classList.toggle('is-unknown', !style);
  wrapper.appendChild(createTextLineStyleMarker(styleName));
  return wrapper;
}

function createTextLineStyleMarker(styleName: string): HTMLElement {
  const marker = document.createElement('span');
  marker.className = 'hvy-text-line-style-marker';
  marker.contentEditable = 'false';
  marker.textContent = `^${styleName}^`;
  return marker;
}

function unwrapTextLineStyleBlock(wrapper: HTMLElement): void {
  wrapper.querySelector(':scope > .hvy-text-line-style-marker')?.remove();
  const parent = wrapper.parentNode;
  if (!parent) {
    return;
  }
  while (wrapper.firstChild) {
    parent.insertBefore(wrapper.firstChild, wrapper);
  }
  wrapper.remove();
}

function getTextLineStyleContentBlock(wrapper: HTMLElement): HTMLElement | null {
  return Array.from(wrapper.children).find((child): child is HTMLElement =>
    child instanceof HTMLElement && !child.matches('.hvy-text-line-style-marker')
  ) ?? null;
}

function getDirectEditableChild(element: HTMLElement, editable: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current?.parentElement && current.parentElement !== editable) {
    current = current.parentElement;
  }
  return current && current.parentElement === editable ? current : null;
}

function getAncestorElement(node: Node, boundary: HTMLElement, selector: string): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const match = element?.closest<HTMLElement>(selector) ?? null;
  return match && boundary.contains(match) ? match : null;
}

function applyTextFillInSlot(editable: HTMLElement): boolean {
  if (editable.dataset.field !== 'block-rich') {
    return false;
  }
  const context = resolveBlockContext(editable);
  const block = context?.block ?? null;
  const sectionKey = editable.dataset.sectionKey ?? '';
  if (!block || hasTextFillInMarker(block.text)) {
    return false;
  }
  const range = getEditableSelectionRange(editable);
  const selectedText = range && !range.collapsed
    ? range.toString().trim()
    : editable.dataset.fillInSelectionText?.trim() ?? '';
  recordHistory(`text:${block.id}:fill-in:set`);
  if (selectedText && block.text.includes(selectedText)) {
    block.text = block.text.replace(selectedText, prepareTextFillIn(selectedText).text);
    block.schema.placeholder = '';
  } else if (block.text.trim().length === 0) {
    block.text = createTextFillInMarker();
  } else {
    const separator = /\s$/.test(block.text) ? '' : ' ';
    block.text = `${block.text}${separator}${createTextFillInMarker()}`;
  }
  block.schema.fillIn = true;
  state.activeTextEditorMode = { sectionKey, blockId: block.id, mode: 'fill-in' };
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRefreshReaderPanels()();
  getRenderApp()();
  return true;
}

function toggleExistingTableAnnotationPreview(action: string, editable: HTMLElement): boolean {
  if (editable.dataset.field !== 'table-column' && editable.dataset.field !== 'table-cell') {
    return false;
  }
  const shell = editable.closest<HTMLElement>('.table-inline-edit-shell');
  if (!shell) {
    return false;
  }
  if (action === 'alt' && editable.querySelector('[data-hvy-alt="true"]')) {
    if (isTableAltPreviewSelected(shell, editable)) {
      shell.classList.remove('is-previewing-compact');
      shell.classList.add('is-previewing-full');
    } else {
      shell.classList.add('is-previewing-compact');
      shell.classList.remove('is-previewing-full');
    }
    return true;
  }
  if (action === 'nowrap' && editable.querySelector('[data-hvy-nowrap="true"]')) {
    shell.classList.toggle('is-previewing-nowrap');
    return true;
  }
  if (editable.isContentEditable) {
    return false;
  }
  return true;
}

type AnnotationAction = 'alt' | 'nowrap';

function normalizeAnnotationAction(action: string): AnnotationAction | null {
  if (action === 'alt') {
    return 'alt';
  }
  return action === 'nowrap' ? 'nowrap' : null;
}

function toggleAnnotationAction(editable: HTMLElement, action: AnnotationAction): boolean {
  const range = getEditableSelectionRange(editable);
  const annotationKey = action === 'alt' ? 'hvyAlt' : 'hvyNowrap';
  const existing = range ? getAnnotationAncestor(range, annotationKey) : null;
  if (existing) {
    clearPendingAnnotationAction(editable);
    if (action === 'alt') {
      unwrapAltAnnotation(existing);
    } else {
      unwrapInlineElement(existing);
    }
    return true;
  }
  if (!range || range.collapsed || range.toString().length === 0) {
    togglePendingAnnotationAction(editable, action);
    return false;
  }
  clearPendingAnnotationAction(editable);
  return action === 'alt' ? wrapAltAnnotation(range) : wrapNowrapAnnotation(range);
}

export function completePendingRichAnnotation(editable: HTMLElement): boolean {
  const action = getPendingAnnotationAction(editable);
  if (!action) {
    refreshRichToolbarState(editable);
    return false;
  }
  const range = getEditableSelectionRange(editable);
  if (!range || range.collapsed || range.toString().length === 0) {
    refreshRichToolbarState(editable);
    return false;
  }
  clearPendingAnnotationAction(editable);
  const changed = action === 'alt' ? wrapAltAnnotation(range) : wrapNowrapAnnotation(range);
  updateRichToolbarState(editable);
  if (changed) {
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  return changed;
}

function getPendingAnnotationAction(editable: HTMLElement): AnnotationAction | null {
  return editable.dataset.pendingAnnotationAction === 'alt' || editable.dataset.pendingAnnotationAction === 'nowrap'
    ? editable.dataset.pendingAnnotationAction
    : null;
}

function togglePendingAnnotationAction(editable: HTMLElement, action: AnnotationAction): void {
  if (getPendingAnnotationAction(editable) === action) {
    clearPendingAnnotationAction(editable);
  } else {
    editable.dataset.pendingAnnotationAction = action;
  }
}

function clearPendingAnnotationAction(editable: HTMLElement): void {
  delete editable.dataset.pendingAnnotationAction;
}

function wrapAltAnnotation(range: Range): boolean {
  if (range.collapsed || range.toString().length === 0) {
    return false;
  }
  const selectionText = range.toString();
  const wrapper = document.createElement('span');
  wrapper.className = 'hvy-alt';
  wrapper.dataset.hvyAlt = 'true';
  const full = document.createElement('span');
  full.className = 'hvy-alt-full';
  full.textContent = selectionText;
  const compact = document.createElement('span');
  compact.className = 'hvy-alt-compact';
  compact.contentEditable = 'true';
  compact.spellcheck = false;
  compact.textContent = selectionText;
  wrapper.append(full, compact);
  range.deleteContents();
  range.insertNode(wrapper);
  selectElementContents(compact);
  return true;
}

function wrapNowrapAnnotation(range: Range): boolean {
  if (range.collapsed || range.toString().length === 0) {
    return false;
  }
  const wrapper = document.createElement('span');
  wrapper.className = 'hvy-nowrap';
  wrapper.dataset.hvyNowrap = 'true';
  const fragment = range.extractContents();
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);
  selectElementContents(wrapper);
  return true;
}

function unwrapAltAnnotation(element: HTMLElement): void {
  const fullText = element.querySelector<HTMLElement>('.hvy-alt-full')?.textContent ?? element.textContent ?? '';
  const replacement = document.createTextNode(fullText);
  element.replaceWith(replacement);
  const range = document.createRange();
  range.selectNodeContents(replacement);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function selectElementContents(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  element.focus();
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
  if (wrapSelectedEditableBlocksInline(editable, range, tagName, href)) {
    setPendingInlineAction(editable, action, false);
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

function wrapSelectedEditableBlocksInline(editable: HTMLElement, range: Range, tagName: InlineRichTag, href?: string): boolean {
  const startBlock = getBlockElementContaining(editable, range.startContainer);
  const endBlock = getBlockElementContaining(editable, range.endContainer);
  if (!startBlock || !endBlock || startBlock === editable || endBlock === editable || startBlock === endBlock) {
    return false;
  }
  const targets = getSelectedInlineFormattingBlocks(editable, range);
  if (targets.length < 2) {
    return false;
  }
  const wrappers: HTMLElement[] = [];
  for (const target of targets) {
    const targetRange = createRangeForSelectedBlock(target, range);
    if (!targetRange || targetRange.toString().length === 0) {
      continue;
    }
    const wrapper = document.createElement(tagName);
    if (tagName === 'a' && href) {
      wrapper.setAttribute('href', href);
    }
    wrapper.appendChild(targetRange.extractContents());
    targetRange.insertNode(wrapper);
    wrappers.push(wrapper);
  }
  if (wrappers.length === 0) {
    return false;
  }
  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.setStartBefore(wrappers[0]);
  nextRange.setEndAfter(wrappers[wrappers.length - 1]);
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  refocusEditablePreservingSelection(editable);
  return true;
}

function getSelectedInlineFormattingBlocks(editable: HTMLElement, range: Range): HTMLElement[] {
  const candidates = Array.from(editable.querySelectorAll<HTMLElement>('p, div, h1, h2, h3, h4, h5, h6, blockquote, li'))
    .filter((element) => !element.closest('pre') && range.intersectsNode(element));
  return candidates.filter((element) => !candidates.some((candidate) => candidate !== element && element.contains(candidate)));
}

function createRangeForSelectedBlock(block: HTMLElement, selectionRange: Range): Range | null {
  const range = document.createRange();
  range.selectNodeContents(block);
  if (block.contains(selectionRange.startContainer)) {
    range.setStart(selectionRange.startContainer, selectionRange.startOffset);
  }
  if (block.contains(selectionRange.endContainer)) {
    range.setEnd(selectionRange.endContainer, selectionRange.endOffset);
  }
  return range.collapsed ? null : range;
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

function clearInlineTypingState(editable: HTMLElement): void {
  editable.dataset.pendingInlineActions = '';
  editable.dataset.suppressedInlineActions = '';
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

function getAnnotationAncestor(range: Range, annotationKey: 'hvyAlt' | 'hvyNowrap'): HTMLElement | null {
  const selector = annotationKey === 'hvyAlt' ? '[data-hvy-alt="true"]' : '[data-hvy-nowrap="true"]';
  const candidates = [range.startContainer, range.endContainer, range.commonAncestorContainer];
  for (const node of candidates) {
    const element = node instanceof Element ? node : node.parentElement;
    const match = element?.closest(selector);
    if (match instanceof HTMLElement) {
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
    const boundary = document.createTextNode('\u200b');
    parent.insertBefore(boundary, element);
    nextRange.setStart(boundary, boundary.data.length);
  } else if (suffixRange.toString().length === 0) {
    const boundary = document.createTextNode('\u200b');
    parent.insertBefore(boundary, element.nextSibling);
    nextRange.setStart(boundary, boundary.data.length);
  } else {
    const trailingRange = range.cloneRange();
    trailingRange.setEndAfter(element);
    const trailing = trailingRange.extractContents();
    const boundary = document.createTextNode('\u200b');
    parent.insertBefore(boundary, element.nextSibling);
    parent.insertBefore(trailing, boundary.nextSibling);
    nextRange.setStart(boundary, boundary.data.length);
  }
  nextRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
}

function formatSelectionBlock(editable: HTMLElement, tagName: string): void {
  if (formatSelectedEditableBlocks(editable, tagName)) {
    return;
  }
  const block = getSelectionBlockElement(editable);
  if (!block || block.tagName === 'LI' || block.tagName === 'PRE') {
    return;
  }
  const targetBlock = block === editable ? getEditableRootBlockForFormatting(editable) ?? block : block;
  if (targetBlock.tagName === 'LI' || targetBlock.tagName === 'PRE') {
    return;
  }
  if (tagName === 'p' && targetBlock.parentElement instanceof HTMLLIElement) {
    unwrapBlockInsideListItem(targetBlock, editable);
    return;
  }
  const selection = window.getSelection();
  const previousRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const previousTextSelection =
    previousRange && isRangeInsideElement(targetBlock, previousRange)
      ? {
          start: getTextOffset(targetBlock, previousRange.startContainer, previousRange.startOffset),
          end: getTextOffset(targetBlock, previousRange.endContainer, previousRange.endOffset),
        }
      : null;
  const replacement = document.createElement(tagName);
  while (targetBlock.firstChild) {
    replacement.appendChild(targetBlock.firstChild);
  }
  const needsTypingAnchor = tagName !== 'p' && (!replacement.textContent || replacement.textContent === '\u200b');
  if (!replacement.firstChild || (replacement.childNodes.length === 1 && replacement.firstChild instanceof HTMLBRElement)) {
    replacement.replaceChildren(document.createTextNode(needsTypingAnchor ? '\u200b' : ''));
  }
  if (targetBlock === editable) {
    editable.replaceChildren(replacement);
  } else {
    targetBlock.replaceWith(replacement);
  }
  if (needsTypingAnchor && replacement.firstChild) {
    placeCaretAtEnd(replacement);
    refocusEditablePreservingSelection(editable);
  } else if (
    previousTextSelection &&
    previousTextSelection.start !== null &&
    previousTextSelection.end !== null &&
    restoreSelectionByTextOffsets(replacement, previousTextSelection.start, previousTextSelection.end)
  ) {
    refocusEditablePreservingSelection(editable);
    return;
  } else if (
    previousRange &&
    replacement.contains(previousRange.startContainer) &&
    replacement.contains(previousRange.endContainer)
  ) {
    selection?.removeAllRanges();
    selection?.addRange(previousRange);
    refocusEditablePreservingSelection(editable);
  } else {
    placeCaretInside(replacement);
    refocusEditablePreservingSelection(editable);
  }
}

function formatSelectedEditableBlocks(editable: HTMLElement, tagName: string): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range || range.collapsed) {
    return false;
  }
  const targets = getSelectedEditableFormatBlocks(editable, range);
  if (targets.length < 2) {
    return false;
  }
  const shouldUnquote = tagName === 'blockquote' && targets.every((target) => target.tagName === 'BLOCKQUOTE');
  if (tagName === 'blockquote' && !shouldUnquote) {
    return wrapSelectedEditableBlocksInQuote(targets, editable);
  }
  const formatted: HTMLElement[] = [];
  for (const target of targets) {
    if (target.tagName === 'PRE') {
      continue;
    }
    if (shouldUnquote || tagName === 'p') {
      formatted.push(replaceFormattedBlockWithParagraph(target));
      continue;
    }
    if (target.tagName.toLowerCase() === tagName) {
      formatted.push(target);
      continue;
    }
    const replacement = document.createElement(tagName);
    while (target.firstChild) {
      replacement.appendChild(target.firstChild);
    }
    if (!replacement.firstChild) {
      replacement.appendChild(document.createTextNode(tagName === 'p' ? '' : '\u200b'));
    }
    target.replaceWith(replacement);
    formatted.push(replacement);
  }
  if (formatted.length === 0) {
    return false;
  }
  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.setStartBefore(formatted[0]);
  nextRange.setEndAfter(formatted[formatted.length - 1]);
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  refocusEditablePreservingSelection(editable);
  return true;
}

function wrapSelectedEditableBlocksInQuote(blocks: HTMLElement[], editable: HTMLElement): boolean {
  const firstBlock = blocks[0];
  if (!firstBlock?.parentNode) {
    return false;
  }
  const quote = document.createElement('blockquote');
  firstBlock.parentNode.insertBefore(quote, firstBlock);
  for (const block of blocks) {
    quote.appendChild(block);
  }
  if (!quote.firstChild) {
    quote.appendChild(document.createTextNode('\u200b'));
  }
  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(quote);
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  refocusEditablePreservingSelection(editable);
  return true;
}

function getSelectedEditableFormatBlocks(editable: HTMLElement, range: Range): HTMLElement[] {
  const selection = window.getSelection();
  const anchorChild = selection?.anchorNode ? getEditableDirectChildForNode(editable, selection.anchorNode) : null;
  const focusChild = selection?.focusNode ? getEditableDirectChildForNode(editable, selection.focusNode) : null;
  const startChild = anchorChild ?? getEditableDirectChildForNode(editable, range.startContainer);
  const endChild = focusChild ?? getEditableDirectChildForNode(editable, range.endContainer);
  if (startChild && endChild) {
    const children = Array.from(editable.children).filter((child): child is HTMLElement =>
      child instanceof HTMLElement && !child.matches('pre')
    );
    const startIndex = children.indexOf(startChild);
    const endIndex = children.indexOf(endChild);
    if (startIndex >= 0 && endIndex >= 0) {
      return children.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
    }
  }
  return Array.from(editable.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement && range.intersectsNode(child) && !child.matches('pre')
  );
}

function getEditableDirectChildForNode(editable: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current && current.parentNode !== editable) {
    current = current.parentNode;
  }
  return current instanceof HTMLElement && current.parentNode === editable ? current : null;
}

function replaceFormattedBlockWithParagraph(block: HTMLElement): HTMLElement {
  if (block.tagName === 'BLOCKQUOTE') {
    const parent = block.parentNode;
    const inserted: HTMLElement[] = [];
    while (block.firstChild && parent) {
      const child = block.firstChild;
      if (child instanceof HTMLElement && /^(P|DIV|UL|OL|H[1-6])$/.test(child.tagName)) {
        parent.insertBefore(child, block);
        inserted.push(child);
      } else {
        const paragraph = document.createElement('p');
        paragraph.appendChild(child);
        parent.insertBefore(paragraph, block);
        inserted.push(paragraph);
      }
    }
    block.remove();
    return inserted[0] ?? document.createElement('p');
  }
  const paragraph = document.createElement('p');
  while (block.firstChild) {
    paragraph.appendChild(block.firstChild);
  }
  if (!paragraph.firstChild) {
    paragraph.appendChild(document.createElement('br'));
  }
  block.replaceWith(paragraph);
  return paragraph;
}

function unwrapBlockInsideListItem(block: HTMLElement, editable: HTMLElement): void {
  const item = block.parentElement;
  if (!(item instanceof HTMLLIElement)) {
    return;
  }
  const selection = window.getSelection();
  const previousRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  if (!block.firstChild) {
    block.appendChild(document.createTextNode('\u200b'));
  }
  while (block.firstChild) {
    item.insertBefore(block.firstChild, block);
  }
  block.remove();
  if (previousRange && item.contains(previousRange.startContainer) && item.contains(previousRange.endContainer)) {
    selection?.removeAllRanges();
    selection?.addRange(previousRange);
  } else {
    placeCaretInside(item);
  }
  refocusEditablePreservingSelection(editable);
}

function getEditableRootBlockForFormatting(editable: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range?.startContainer === editable) {
    const offsetChild = editable.childNodes[Math.min(range.startOffset, editable.childNodes.length - 1)] ?? null;
    const previousChild = range.startOffset > 0 ? editable.childNodes[range.startOffset - 1] ?? null : null;
    const candidate = getBlockElementCandidate(offsetChild) ?? getBlockElementCandidate(previousChild);
    if (candidate) {
      return candidate;
    }
  }
  if (editable.children.length === 1) {
    return getBlockElementCandidate(editable.firstElementChild);
  }
  return null;
}

function getBlockElementCandidate(node: Node | null): HTMLElement | null {
  if (!(node instanceof HTMLElement)) {
    return null;
  }
  return /^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6])$/.test(node.tagName) ? node : null;
}

function refocusEditablePreservingSelection(editable: HTMLElement): void {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  editable.focus({ preventScroll: true });
  if (!range || !selection || (!editable.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== editable)) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export function refreshRichToolbarState(editable: HTMLElement): void {
  updateRichToolbarState(editable);
}

export function handleRichEditorKeyup(editable: HTMLElement): boolean {
  if (!convertInlineCodeInsertedShortcut(editable)) {
    return false;
  }
  editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
  updateRichToolbarState(editable);
  return true;
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

function updateRichToolbarState(editable: HTMLElement, textLineStyleOverride?: string): void {
  const range = getEditableSelectionRange(editable);
  const textEditorShell = editable.closest<HTMLElement>('.text-editor-shell');
  const hasFillInSelection = editable.dataset.field === 'block-rich' && range && !range.collapsed && range.toString().trim().length > 0;
  if (hasFillInSelection) {
    textEditorShell?.classList.add('has-fill-in-selection');
    editable.dataset.fillInSelectionText = range.toString().trim();
  } else if (
    (editable.dataset.field === 'block-rich' && range) ||
    !textEditorShell ||
    !document.activeElement ||
    !textEditorShell.contains(document.activeElement)
  ) {
    textEditorShell?.classList.remove('has-fill-in-selection');
    textEditorShell?.classList.remove('is-use-as-open');
    textEditorShell?.querySelector<HTMLElement>('.text-use-as-selection')?.classList.remove('is-use-as-open');
    textEditorShell?.querySelector<HTMLElement>('.text-use-as-button')?.setAttribute('aria-expanded', 'false');
    delete editable.dataset.fillInSelectionText;
  }
  const toolbars = [
    editable.closest('.table-inline-edit-shell')?.querySelector<HTMLElement>('.table-inline-toolbar') ?? null,
    editable.closest('.caption-text-modal')?.querySelector<HTMLElement>('.rich-toolbar') ?? null,
    editable.closest('.text-editor-shell')?.querySelector<HTMLElement>('.rich-toolbar') ?? null,
    editable.closest('.editor-block')?.querySelector<HTMLElement>('.rich-toolbar') ?? null,
  ].filter((toolbar): toolbar is HTMLElement => Boolean(toolbar));
  if (toolbars.length === 0) {
    return;
  }
  const selectedStyle = getSelectedRichBlockStyle(editable);
  const selectedTextLineStyle = textLineStyleOverride ?? getSelectedTextLineStyleName(editable);
  const selectedInlineActions = getSelectedInlineRichActions(editable);
  toolbars.forEach((toolbar) => {
    updateParagraphStyleToolbarState(toolbar, selectedTextLineStyle);
    toolbar.querySelectorAll<HTMLButtonElement>('[data-rich-action]').forEach((button) => {
      const action = button.dataset.richAction ?? '';
      const annotationAction = normalizeAnnotationAction(action);
      if (annotationAction) {
        const shell = toolbar.closest<HTMLElement>('.table-inline-edit-shell');
        const selected =
          shell && annotationAction === 'alt'
            ? isTableAltPreviewSelected(shell, editable)
            : shell && annotationAction === 'nowrap'
            ? shell.classList.contains('is-previewing-nowrap')
            : annotationAction === 'alt'
            ? getPendingAnnotationAction(editable) === 'alt' || Boolean(range && getAnnotationAncestor(range, 'hvyAlt'))
            : getPendingAnnotationAction(editable) === 'nowrap' || Boolean(range && getAnnotationAncestor(range, 'hvyNowrap'));
        button.classList.toggle('secondary', selected);
        button.classList.toggle('is-selected', selected);
        button.classList.toggle('ghost', !selected);
        return;
      }
      const selected =
        action === selectedStyle ||
        (selectedStyle === 'paragraph' && action === 'paragraph') ||
        (isInlineRichAction(action) && selectedInlineActions.has(action));
      if (action === 'text-line-style') {
        const selected = (button.dataset.textLineStyleName ?? '') === selectedTextLineStyle;
        button.classList.toggle('secondary', selected);
        button.classList.toggle('is-selected', selected);
        button.classList.toggle('ghost', !selected);
        return;
      }
      if (!/^(paragraph|heading-[1-4]|quote|code-block|list|ordered-list|checklist)$/.test(action) && !isInlineRichAction(action)) {
        return;
      }
      button.classList.toggle('secondary', selected);
      button.classList.toggle('is-selected', selected);
      button.classList.toggle('ghost', !selected);
    });
  });
}

function getSelectedTextLineStyleName(editable: HTMLElement): string {
  const block = getSelectionTextLineStyleBlock(editable);
  const styled = block?.matches('[data-hvy-text-line-style]')
    ? block
    : block?.closest<HTMLElement>('[data-hvy-text-line-style]');
  return styled?.dataset.hvyTextLineStyle ?? '';
}

function updateParagraphStyleToolbarState(toolbar: HTMLElement, selectedStyleName: string): void {
  const styleToolbar = toolbar.querySelector<HTMLElement>('.paragraph-style-toolbar');
  if (!styleToolbar) {
    return;
  }
  const selectedButton = styleToolbar.querySelector<HTMLButtonElement>(
    `.paragraph-style-modal-list [data-rich-action="text-line-style"][data-text-line-style-name="${cssEscapeForSelector(selectedStyleName)}"]`
  );
  if (!selectedStyleName || !selectedButton) {
    return;
  }
  state.paragraphStyleRecentNames = [
    selectedStyleName,
    ...state.paragraphStyleRecentNames.filter((name) => name !== selectedStyleName),
  ].slice(0, 2);
  const recent = styleToolbar.querySelector<HTMLElement>('.paragraph-style-recent');
  if (!recent) {
    return;
  }
  recent
    .querySelectorAll<HTMLButtonElement>('[data-rich-action="text-line-style"]')
    .forEach((button) => {
      if ((button.dataset.textLineStyleName ?? '') === selectedStyleName) {
        button.remove();
      }
    });
  const clone = selectedButton.cloneNode(true) as HTMLButtonElement;
  clone.classList.remove('paragraph-style-modal-option');
  recent.prepend(clone);
  Array.from(recent.querySelectorAll<HTMLButtonElement>('[data-rich-action="text-line-style"]')).slice(2).forEach((button) => button.remove());
}

function cssEscapeForSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function isTableAltPreviewSelected(shell: HTMLElement, editable: HTMLElement): boolean {
  if (!editable.querySelector('[data-hvy-alt="true"]')) {
    return false;
  }
  if (shell.classList.contains('is-previewing-full')) {
    return false;
  }
  if (shell.classList.contains('is-previewing-compact')) {
    return true;
  }
  return Boolean(editable.closest('.hvy-surface-phone, .hvy-surface-tablet'));
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
    if (/^\s*(☐|☑|\[[ xX]\])/.test(text)) {
      return 'checklist';
    }
    const item = block.closest('li');
    return item?.parentElement instanceof HTMLOListElement ? 'ordered-list' : 'list';
  }
  return 'paragraph';
}

function moveCaretFromEmptyTextLineStyleToPreviousLine(editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range?.collapsed) {
    return false;
  }
  const block = getSelectionBlockElement(editable);
  if (!block || block === editable || !isEffectivelyEmptyBlock(block)) {
    return false;
  }
  const styled = block.closest<HTMLElement>('[data-hvy-text-line-style]');
  if (!styled || !editable.contains(styled)) {
    return false;
  }
  const previous = styled.previousElementSibling;
  const previousBlock = previous instanceof HTMLElement && previous.matches('[data-hvy-text-line-style]')
    ? getTextLineStyleContentBlock(previous)
    : previous instanceof HTMLElement
      ? previous
      : null;
  if (!previousBlock || isEffectivelyEmptyBlock(previousBlock)) {
    return false;
  }
  placeCaretAtEnd(previousBlock);
  return true;
}

export function handleRichEditorKeydown(event: KeyboardEvent, editable: HTMLElement): boolean {
  if (event.key === 'ArrowRight' && moveCaretAfterFocusedSortValueControl(event, editable)) {
    event.preventDefault();
    updateRichToolbarState(editable);
    return true;
  }

  if (event.key === 'ArrowRight' && exitInlineCodeAtEnd(editable)) {
    event.preventDefault();
    updateRichToolbarState(editable);
    return true;
  }

  if (event.key === 'ArrowUp' && moveCaretFromEmptyTextLineStyleToPreviousLine(editable)) {
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

  if ((event.key === 'Backspace' || event.key === 'Delete') && clearSelectedFormatBlock(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.key === 'Delete' && preventForwardDeleteFormatBlockMerge(editable)) {
    event.preventDefault();
    if (editable.dataset.hvyFormatBlockMergeChanged === 'true') {
      delete editable.dataset.hvyFormatBlockMergeChanged;
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      routeNextUndoToDocument();
    }
    updateRichToolbarState(editable);
    return true;
  }

  if ((event.key === 'Backspace' || event.key === 'Delete') && isSelectionInsideEditableList(editable)) {
    const pruneActiveItem = !window.getSelection()?.isCollapsed;
    scheduleEmptyListItemPruneAfterDeletion(editable, { pruneActiveItem });
  }

  if (event.key === 'Tab' && isSelectionInsideEditableList(editable)) {
    event.preventDefault();
    const selectionSnapshot = moveSelectionListItemNesting(editable, event.shiftKey ? 'outdent' : 'indent');
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    restoreMovedListItemSelection(selectionSnapshot, editable);
    updateRichToolbarState(editable);
    window.setTimeout(() => restoreMovedListItemSelection(selectionSnapshot, editable), 0);
    return true;
  }

  if (event.key === 'Tab' && applyCodeBlockIndentation(editable, event.shiftKey ? 'dedent' : 'indent')) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
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
    suppressNextCodeBlockParagraphInput(editable);
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

  if (event.key.length === 1 && insertTextAfterInlineCodeAtEnd(editable, event.key)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.key === '`' && convertInlineCodeAltcut(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.key === ' ' && convertMarkdownQuoteAltcut(editable)) {
    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }

  if (event.key === 'Enter') {
    if (exitEmptyListItemAtSelection(editable)) {
      event.preventDefault();
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      updateRichToolbarState(editable);
      return true;
    }

    if (continueTextLineStyleAtSelection(editable)) {
      event.preventDefault();
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      updateRichToolbarState(editable);
      return true;
    }

    if (exitBlockStyleAtSelection(editable)) {
      event.preventDefault();
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      updateRichToolbarState(editable);
      return true;
    }

    if (exitInlineFormattingAtParagraphEnd(editable)) {
      event.preventDefault();
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      updateRichToolbarState(editable);
      return true;
    }

    const codeLanguage = getCurrentLineAltcut(editable, /^```([\w-]*)$/);
    if (codeLanguage !== null) {
      event.preventDefault();
      replaceCurrentLineWithCodeBlock(editable, codeLanguage);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    }

    if (convertMarkdownQuoteAltcut(editable)) {
      event.preventDefault();
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    }
  }

  return false;
}

export function handleRichEditorBeforeInput(event: InputEvent, editable: HTMLElement): boolean {
  if (event.inputType === 'insertParagraph') {
    if (consumeSuppressedCodeBlockParagraphInput(editable)) {
      return true;
    }
    if (isSelectionInsideCodeBlock(editable)) {
      insertTextInSelectionCodeBlock(editable, '\n');
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      updateRichToolbarState(editable);
      return true;
    }
    if (!insertParagraphAtEditableSelection(editable)) {
      return false;
    }
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromPasteAsQuotation') {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      return false;
    }
    const codeBlockPasteText = dataTransfer.getData('text/plain');
    if (isSelectionInsideCodeBlock(editable) && codeBlockPasteText) {
      insertTextInSelectionCodeBlock(editable, codeBlockPasteText);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      routeNextUndoToDocument();
      updateRichToolbarState(editable);
      return true;
    }
    if (event.inputType === 'insertFromPasteAsQuotation') {
      const text = dataTransfer.getData('text/plain');
      if (text) {
        insertPlainTextAtEditableSelection(editable, text);
        editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
        routeNextUndoToDocument();
        updateRichToolbarState(editable);
        return true;
      }
      return false;
    }
    const html = dataTransfer.getData(HVY_RICH_CLIPBOARD_TYPE) ||
      normalizeExternalRichPasteHtml(dataTransfer.getData('text/html'));
    if (html) {
      insertHtmlAtEditableSelection(editable, html);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      routeNextUndoToDocument();
      updateRichToolbarState(editable);
      return true;
    }
    const text = dataTransfer.getData('text/plain');
    if (text) {
      insertPlainTextAtEditableSelection(editable, text);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      routeNextUndoToDocument();
      updateRichToolbarState(editable);
      return true;
    }
    return false;
  }

  if (event.inputType === 'deleteByCut' && isSelectionInsideEditableList(editable)) {
    scheduleEmptyListItemPruneAfterDeletion(editable, { pruneActiveItem: true });
    return false;
  }

  if (
    (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward' || event.inputType === 'deleteByCut') &&
    preserveSelectedSortValueAnnotationForReplacement(editable)
  ) {
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (
    (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') &&
    preserveCollapsedSortValueAnnotationDeletion(editable, event.inputType)
  ) {
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

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

  if (replaceEmptySortValueAnnotationText(editable, event.data)) {
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (insertTextAfterInlineCodeAtEnd(editable, event.data)) {
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  if (event.data === '`' && convertInlineCodeAltcut(editable)) {
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }

  const pendingActions = getPendingInlineActions(editable);
  const suppressedActions = getSuppressedInlineActions(editable);
  const shouldPreserveVisibleSpace = event.data === ' ' && (pendingActions.size > 0 || suppressedActions.size > 0);
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

function preserveCollapsedSortValueAnnotationDeletion(editable: HTMLElement, inputType: string): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range || !range.collapsed) {
    return false;
  }
  const sortValue = getRangeSortValueTextElement(range, editable);
  if (!sortValue || countVisibleSortValueCharacters(sortValue) !== 1) {
    return false;
  }
  const offset = getTextOffset(sortValue, range.startContainer, range.startOffset);
  if (offset === null) {
    return false;
  }
  const text = sortValue.textContent ?? '';
  if (inputType === 'deleteContentBackward' && countVisibleSortValueCharactersBefore(text, offset) !== 1) {
    return false;
  }
  if (inputType === 'deleteContentForward' && countVisibleSortValueCharactersAfter(text, offset) !== 1) {
    return false;
  }
  sortValue.replaceChildren(document.createTextNode('\u200b'));
  placeCaretAtEnd(sortValue);
  return true;
}

function preserveSelectedSortValueAnnotationForReplacement(editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range || range.collapsed) {
    return false;
  }
  const sortValue = getRangeSortValueTextElement(range, editable);
  if (!sortValue) {
    return false;
  }
  sortValue.replaceChildren(document.createTextNode('\u200b'));
  placeCaretAtEnd(sortValue);
  return true;
}

function replaceEmptySortValueAnnotationText(editable: HTMLElement, text: string): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range) {
    return false;
  }
  const sortValue = getRangeSortValueTextElement(range, editable);
  if (!sortValue || !isSortValueAnnotationEmpty(sortValue)) {
    return false;
  }
  sortValue.textContent = text;
  placeCaretAtEnd(sortValue);
  return true;
}

function getRangeSortValueTextElement(range: Range, editable: HTMLElement): HTMLElement | null {
  const start = getSortValueTextElement(range.startContainer, editable);
  const end = getSortValueTextElement(range.endContainer, editable);
  return start && start === end ? start : null;
}

function getSortValueTextElement(node: Node, editable: HTMLElement): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const sortValue = element?.closest<HTMLElement>('[data-hvy-sort-value="true"]');
  if (!sortValue || sortValue instanceof HTMLSelectElement || !editable.contains(sortValue)) {
    return null;
  }
  return sortValue;
}

function isSortValueAnnotationEmpty(sortValue: HTMLElement): boolean {
  return (sortValue.textContent ?? '').replaceAll('\u200b', '').trim().length === 0;
}

function countVisibleSortValueCharacters(sortValue: HTMLElement): number {
  return (sortValue.textContent ?? '').replaceAll('\u200b', '').length;
}

function countVisibleSortValueCharactersBefore(text: string, offset: number): number {
  return text.slice(0, offset).replaceAll('\u200b', '').length;
}

function countVisibleSortValueCharactersAfter(text: string, offset: number): number {
  return text.slice(offset).replaceAll('\u200b', '').length;
}

function normalizeSortValueAnnotationDom(root: ParentNode): void {
  const sortValueBackground = getSortValuePresentationBackground(root);
  root.querySelectorAll<HTMLElement>('.hvy-sort-value').forEach((element) => {
    if (element instanceof HTMLSelectElement) {
      return;
    }
    const isSortValue = element.getAttribute('data-hvy-sort-value') === 'true';
    const key = element.getAttribute('data-sort-value-key')?.trim() ?? '';
    if (isSortValue && key) {
      return;
    }
    unwrapElement(element);
  });
  if (!sortValueBackground) {
    return;
  }
  root.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    if (element.closest('[data-hvy-sort-value="true"]')) {
      return;
    }
    if (isBrowserCopiedSortValuePresentation(element, sortValueBackground)) {
      unwrapElement(element);
    }
  });
}

function unwrapElement(element: HTMLElement): void {
  const parent = element.parentNode;
  if (!parent) {
    return;
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  element.remove();
}

function getSortValuePresentationBackground(root: ParentNode): string | null {
  const rootNode = root as Node;
  const ownerDocument = rootNode instanceof Document ? rootNode : rootNode.ownerDocument;
  if (!ownerDocument) {
    return null;
  }
  const host = root instanceof Element ? root : ownerDocument.body;
  if (!host) {
    return null;
  }
  const probe = ownerDocument.createElement('span');
  probe.className = 'hvy-sort-value';
  probe.dataset.hvySortValue = 'true';
  probe.dataset.sortValueKey = '__probe__';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.textContent = '\u200b';
  host.appendChild(probe);
  const background = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return background && background !== 'rgba(0, 0, 0, 0)' ? background : null;
}

function isBrowserCopiedSortValuePresentation(element: HTMLElement, sortValueBackground: string): boolean {
  if (element.tagName !== 'SPAN' || element.className || element.attributes.length !== 1 || !element.hasAttribute('style')) {
    return false;
  }
  if (!element.style.backgroundColor) {
    return false;
  }
  return getComputedStyle(element).backgroundColor === sortValueBackground;
}

export function handleRichEditorCopy(event: ClipboardEvent, editable: HTMLElement): boolean {
  const clipboard = event.clipboardData;
  const selection = window.getSelection();
  if (!clipboard || !selection?.rangeCount) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (range.collapsed || !isRangeInsideElement(editable, range)) {
    return false;
  }
  const container = document.createElement('div');
  container.appendChild(range.cloneContents());
  removeEditorCaretAnchors(container);
  const html = container.innerHTML;
  if (!html) {
    return false;
  }
  clipboard.setData(HVY_RICH_CLIPBOARD_TYPE, html);
  clipboard.setData('text/html', html);
  clipboard.setData('text/plain', removeEditorCaretAnchorsFromText(range.toString()));
  event.preventDefault();
  return true;
}

function removeEditorCaretAnchors(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }
  textNodes.forEach((node) => {
    node.textContent = removeEditorCaretAnchorsFromText(node.textContent ?? '');
  });
}

function removeEditorCaretAnchorsFromText(text: string): string {
  return text.replace(/\u200b/g, '');
}

export function handleRichEditorPlainTextPaste(event: ClipboardEvent, editable: HTMLElement): boolean {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!text) {
    return false;
  }
  if (isSelectionInsideCodeBlock(editable)) {
    insertTextInSelectionCodeBlock(editable, text);
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
    return true;
  }
  insertPlainTextAtEditableSelection(editable, text);
  editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
  updateRichToolbarState(editable);
  return true;
}

function sanitizeExternalRichPasteHtml(html: string): string {
  if (!html) {
    return '';
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLElement>('*').forEach((element) => {
    stripExternalPastePresentation(element);
  });
  return template.innerHTML;
}

function normalizeExternalRichPasteHtml(html: string): string {
  const sanitized = sanitizeExternalRichPasteHtml(html);
  if (!sanitized) {
    return '';
  }
  const container = document.createElement('div');
  container.innerHTML = sanitized;
  convertExternalBoldPresentationToSemanticStrong(container);
  removeNonTextContentFromRichEditor(container);
  normalizeEditableListDom(container);
  normalizeInlineCodeTextNodes(container);
  const markdown = normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(
    turndown.turndown(getRichEditorSerializableHtml(container))
  ));
  if (!markdown.trim()) {
    return '';
  }
  const editorHtml = renderMarkdownToEditorHtml(markdown);
  return shouldInsertExternalPasteInline(sanitized, markdown) ? unwrapSingleRenderedParagraph(editorHtml) : editorHtml;
}

function shouldInsertExternalPasteInline(html: string, markdown: string): boolean {
  if (!/<\/?(p|div|blockquote|pre|ul|ol|li|table|h[1-6]|tr|td|th)\b/i.test(html)) {
    return true;
  }
  return !/\n\s*\n/.test(markdown) &&
    !/^(#{1,6} |[-*+] |\d+\. |> |```|~~~)/m.test(markdown);
}

function unwrapSingleRenderedParagraph(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const children = Array.from(template.content.childNodes).filter((node) => {
    return node.nodeType !== Node.TEXT_NODE || (node.textContent ?? '').trim().length > 0;
  });
  if (children.length !== 1 || !(children[0] instanceof HTMLParagraphElement)) {
    return html;
  }
  return children[0].innerHTML;
}

function convertExternalBoldPresentationToSemanticStrong(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    if (!isExternalBoldPresentation(element.getAttribute('style') ?? '')) {
      return;
    }
    if (element.closest('strong, b')) {
      return;
    }
    const strong = document.createElement('strong');
    element.before(strong);
    strong.append(element);
  });
}

function isExternalBoldPresentation(style: string): boolean {
  const weight = style.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i)?.[1]?.trim().toLowerCase() ?? '';
  if (!weight) {
    return false;
  }
  if (weight === 'bold' || weight === 'bolder') {
    return true;
  }
  const numeric = Number(weight);
  return Number.isFinite(numeric) && numeric >= 600;
}

function stripExternalPastePresentation(element: HTMLElement): void {
  element.removeAttribute('color');
  element.removeAttribute('bgcolor');
  element.removeAttribute('face');
  element.removeAttribute('size');
  if (!element.hasAttribute('style')) {
    return;
  }
  const preservedDeclarations = (element.getAttribute('style') ?? '')
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !isExternalPastePresentationDeclaration(declaration));
  if (preservedDeclarations.length > 0) {
    element.setAttribute('style', preservedDeclarations.join('; '));
  } else {
    element.removeAttribute('style');
  }
}

function isExternalPastePresentationDeclaration(declaration: string): boolean {
  const propertyName = declaration.split(':', 1)[0]?.trim().toLowerCase() ?? '';
  return propertyName === 'color' ||
    propertyName === 'background' ||
    propertyName === 'background-color' ||
    propertyName === 'font' ||
    propertyName === 'font-family' ||
    propertyName === 'font-size' ||
    propertyName === 'text-decoration-color' ||
    propertyName === 'border-color' ||
    propertyName.endsWith('-color');
}

function insertHtmlAtEditableSelection(editable: HTMLElement, html: string): void {
  const range = getEditableSelectionRange(editable);
  if (!range) {
    editable.insertAdjacentHTML('beforeend', html);
    placeCaretAtEnd(editable);
    return;
  }
  const fragment = range.createContextualFragment(html);
  if (insertListItemFragmentAtEditableListSelection(editable, range, fragment)) {
    return;
  }
  range.deleteContents();
  placeCaretAfterInsertedFragment(range, fragment);
}

function insertListItemFragmentAtEditableListSelection(editable: HTMLElement, range: Range, fragment: DocumentFragment): boolean {
  const selectedItem = getSelectionListItem(editable);
  if (!selectedItem || !isNodeInsideElement(selectedItem, range.commonAncestorContainer)) {
    return false;
  }
  const items = getTopLevelPastedListItems(fragment);
  if (!items || items.length === 0) {
    return false;
  }
  range.deleteContents();
  let insertedItem: HTMLLIElement | null = null;
  let referenceItem = selectedItem;
  items.forEach((item) => {
    referenceItem.after(item);
    referenceItem = item;
    insertedItem = item;
  });
  normalizeEditableListDom(editable);
  if (insertedItem) {
    placeCaretAtEnd(insertedItem);
  }
  return true;
}

function getTopLevelPastedListItems(fragment: DocumentFragment): HTMLLIElement[] | null {
  const items: HTMLLIElement[] = [];
  const removableNodes: Node[] = [];
  for (const child of Array.from(fragment.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim().length === 0) {
      removableNodes.push(child);
      continue;
    }
    if (!(child instanceof HTMLLIElement)) {
      return null;
    }
    if (isEffectivelyEmptyContinuationListItem(child)) {
      removableNodes.push(child);
      continue;
    }
    items.push(child);
  }
  removableNodes.forEach((node) => node.parentNode?.removeChild(node));
  return items;
}

function insertPlainTextAtEditableSelection(editable: HTMLElement, text: string): void {
  const html = escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
  insertHtmlAtEditableSelection(editable, html || '<br>');
}

function insertParagraphAtEditableSelection(editable: HTMLElement): boolean {
  if (isSelectionInsideEditableList(editable) || isSelectionInsideCodeBlock(editable)) {
    return false;
  }
  const range = getEditableSelectionRange(editable);
  if (!range) {
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    editable.appendChild(paragraph);
    placeCaretAtStart(paragraph);
    return true;
  }

  const block = getSelectionBlockElement(editable);
  if (!block || block === editable || !/^(P|DIV|BLOCKQUOTE|H[1-6])$/.test(block.tagName)) {
    return false;
  }

  if (!range.collapsed) {
    range.deleteContents();
  }

  const nextBlock = block instanceof HTMLQuoteElement
    ? document.createElement('blockquote')
    : /^H[1-6]$/.test(block.tagName)
      ? document.createElement('p')
      : document.createElement('p');
  const tailRange = document.createRange();
  tailRange.selectNodeContents(block);
  tailRange.setStart(range.startContainer, range.startOffset);
  nextBlock.appendChild(tailRange.extractContents());
  ensureEditableParagraphContent(block);
  ensureEditableParagraphContent(nextBlock);
  block.parentNode?.insertBefore(nextBlock, block.nextSibling);
  placeCaretAtStart(nextBlock);
  return true;
}

function ensureEditableParagraphContent(block: HTMLElement): void {
  if (block.childNodes.length > 0 && !isEffectivelyEmptyBlock(block)) {
    return;
  }
  block.replaceChildren(document.createElement('br'));
}

function placeCaretAfterInsertedFragment(range: Range, fragment: DocumentFragment): void {
  const lastChild = fragment.lastChild;
  range.insertNode(fragment);
  const nextRange = document.createRange();
  if (lastChild) {
    nextRange.setStartAfter(lastChild);
  } else {
    nextRange.setStart(range.startContainer, range.startOffset);
  }
  nextRange.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
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

function scheduleEmptyListItemPruneAfterDeletion(editable: HTMLElement, options: { pruneActiveItem: boolean }): void {
  window.setTimeout(() => {
    if (!editable.isConnected || !pruneEmptyListItemsAwayFromSelection(editable, options)) {
      return;
    }
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    updateRichToolbarState(editable);
  }, 0);
}

function pruneEmptyListItemsAwayFromSelection(editable: HTMLElement, options: { pruneActiveItem: boolean }): boolean {
  const activeItem = getSelectionListItem(editable);
  let changed = false;
  editable.querySelectorAll<HTMLLIElement>('li').forEach((item) => {
    if ((item === activeItem && !options.pruneActiveItem) || !isEffectivelyEmptyContinuationListItem(item)) {
      return;
    }
    if (item === activeItem) {
      placeCaretNearRemovedListItem(item);
    }
    item.remove();
    changed = true;
  });
  if (changed) {
    editable.querySelectorAll<HTMLUListElement | HTMLOListElement>('ul, ol').forEach((list) => {
      if (list.children.length === 0) {
        list.remove();
      }
    });
  }
  return changed;
}

function placeCaretNearRemovedListItem(item: HTMLLIElement): void {
  const previous = item.previousElementSibling;
  if (previous instanceof HTMLElement) {
    placeCaretAtEnd(previous);
    return;
  }
  const next = item.nextElementSibling;
  if (next instanceof HTMLElement) {
    placeCaretInside(next);
  }
}

type EditableListTagName = 'ul' | 'ol';

function toggleSelectionList(editable: HTMLElement, tagName: EditableListTagName): void {
  const item = getSelectionListItem(editable);
  if (item) {
    const list = item.parentElement;
    const selectedListMatchesAction =
      tagName === 'ol' ? list instanceof HTMLOListElement : list instanceof HTMLUListElement;
    if (!selectedListMatchesAction) {
      convertListTypeForItem(item, tagName);
      return;
    }
    unwrapListItem(item, editable);
    return;
  }

  const block = getSelectionBlockElement(editable);
  const rootInlineNodes = block === editable ? getSelectedEditableRootInlineRun(editable) : [];
  if (!block || block.tagName === 'PRE') {
    return;
  }
  if (block === editable && rootInlineNodes.length === 0) {
    if (isEffectivelyEmptyBlock(editable)) {
      replaceEmptyEditableWithList(editable, tagName);
    }
    return;
  }
  if (rootInlineNodes.length > 0) {
    wrapRootInlineRunInList(editable, rootInlineNodes, tagName);
    return;
  }
  const selectedBlocks = getSelectedEditableTextBlocks(editable);
  if (selectedBlocks.length > 1) {
    wrapSelectedBlocksInList(selectedBlocks, tagName);
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
  const list = document.createElement(tagName);
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

function replaceEmptyEditableWithList(editable: HTMLElement, tagName: EditableListTagName): void {
  const list = document.createElement(tagName);
  const listItem = document.createElement('li');
  listItem.appendChild(document.createTextNode('\u200b'));
  list.appendChild(listItem);
  editable.replaceChildren(list);
  placeCaretAtEnd(listItem);
  refocusEditablePreservingSelection(editable);
}

function getSelectedEditableRootInlineRun(editable: HTMLElement): Node[] {
  const range = getEditableSelectionRange(editable);
  if (!range) {
    return [];
  }
  const child = getEditableRootSelectionChild(editable, range);
  if (!child || isEditableRootBlockBoundary(child)) {
    return [];
  }
  const nodes: Node[] = [child];
  let previous = child.previousSibling;
  while (previous && !isEditableRootBlockBoundary(previous)) {
    nodes.unshift(previous);
    previous = previous.previousSibling;
  }
  let next = child.nextSibling;
  while (next && !isEditableRootBlockBoundary(next)) {
    nodes.push(next);
    next = next.nextSibling;
  }
  return hasVisibleEditableRootContent(nodes) ? nodes : [];
}

function getEditableRootSelectionChild(editable: HTMLElement, range: Range): Node | null {
  if (range.startContainer === editable) {
    return editable.childNodes[Math.min(range.startOffset, editable.childNodes.length - 1)] ?? null;
  }
  let node: Node | null = range.startContainer;
  while (node?.parentNode && node.parentNode !== editable) {
    node = node.parentNode;
  }
  return node?.parentNode === editable ? node : null;
}

function isEditableRootBlockBoundary(node: Node): boolean {
  return node instanceof HTMLElement && /^(P|DIV|UL|OL|LI|BLOCKQUOTE|PRE|H[1-6])$/.test(node.tagName);
}

function hasVisibleEditableRootContent(nodes: Node[]): boolean {
  return nodes.some((node) => {
    if (node instanceof HTMLBRElement) {
      return false;
    }
    return (node.textContent ?? '').replace(/\u200b/g, '').trim().length > 0;
  });
}

function wrapRootInlineRunInList(editable: HTMLElement, nodes: Node[], tagName: EditableListTagName): void {
  const firstNode = nodes[0];
  if (!firstNode?.parentNode) {
    return;
  }
  const list = document.createElement(tagName);
  const listItem = document.createElement('li');
  firstNode.parentNode.insertBefore(list, firstNode);
  for (const node of nodes) {
    listItem.appendChild(node);
  }
  if (!listItem.firstChild) {
    listItem.appendChild(document.createTextNode('\u200b'));
  }
  list.appendChild(listItem);
  placeCaretAtEnd(listItem);
  refocusEditablePreservingSelection(editable);
}

function getSelectedEditableTextBlocks(editable: HTMLElement): HTMLElement[] {
  const range = getEditableSelectionRange(editable);
  if (!range || range.collapsed) {
    return [];
  }
  const directChildren = Array.from(editable.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  const selected = directChildren.filter((child) => range.intersectsNode(child));
  return selected.every((child) => !/^(PRE|UL|OL)$/.test(child.tagName)) ? selected : [];
}

function wrapSelectedBlocksInList(blocks: HTMLElement[], tagName: EditableListTagName): void {
  const firstBlock = blocks[0];
  if (!firstBlock?.parentNode) {
    return;
  }
  const list = document.createElement(tagName);
  for (const block of blocks) {
    const listItem = document.createElement('li');
    while (block.firstChild) {
      listItem.appendChild(block.firstChild);
    }
    if (!listItem.firstChild) {
      listItem.appendChild(document.createTextNode('\u200b'));
    }
    list.appendChild(listItem);
  }
  firstBlock.parentNode.insertBefore(list, firstBlock);
  for (const block of blocks) {
    block.remove();
  }
  const lastItem = list.lastElementChild;
  if (lastItem instanceof HTMLElement) {
    placeCaretAtEnd(lastItem);
  }
}

function unwrapListItem(item: HTMLLIElement, editable: HTMLElement): void {
  const list = item.parentElement;
  if (!(list instanceof HTMLUListElement || list instanceof HTMLOListElement)) {
    return;
  }
  const paragraph = splitListItemToParagraph(item, editable, { forceEmpty: false });
  placeCaretAtEnd(paragraph);
}

function exitEmptyListItemAtSelection(editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range?.collapsed) {
    return false;
  }
  const item = getSelectionListItem(editable);
  if (!item || !isEmptyEditableListItem(item)) {
    return false;
  }
  const list = item.parentElement;
  if (!(list instanceof HTMLUListElement || list instanceof HTMLOListElement)) {
    return false;
  }
  const paragraph = splitListItemToParagraph(item, editable, { forceEmpty: true });
  removeEmptyListAncestors(list);
  placeCaretInside(paragraph);
  refocusEditablePreservingSelection(editable);
  return true;
}

function splitListItemToParagraph(item: HTMLLIElement, editable: HTMLElement, options: { forceEmpty: boolean }): HTMLParagraphElement {
  const list = item.parentElement;
  if (!(list instanceof HTMLUListElement || list instanceof HTMLOListElement) || !list.parentNode) {
    const fallback = document.createElement('p');
    fallback.appendChild(document.createElement('br'));
    return fallback;
  }
  const paragraph = document.createElement('p');
  if (options.forceEmpty) {
    paragraph.appendChild(document.createElement('br'));
  } else {
    moveListItemContentToParagraph(item, paragraph);
  }
  if (!paragraph.firstChild) {
    paragraph.appendChild(document.createElement('br'));
  }

  const parent = list.parentNode;
  const afterList = document.createElement(list.tagName.toLowerCase()) as HTMLUListElement | HTMLOListElement;
  while (item.nextSibling) {
    afterList.appendChild(item.nextSibling);
  }
  item.remove();

  if (list.children.length > 0) {
    parent.insertBefore(paragraph, list.nextSibling);
  } else {
    parent.insertBefore(paragraph, list);
    list.remove();
  }

  pruneEmptyContinuationListItems(afterList);
  if (afterList.children.length > 0) {
    parent.insertBefore(afterList, paragraph.nextSibling);
  }
  hoistSplitParagraphToEditableRoot(paragraph, editable);
  return paragraph;
}

function hoistSplitParagraphToEditableRoot(paragraph: HTMLParagraphElement, editable: HTMLElement): void {
  while (paragraph.parentElement && paragraph.parentElement !== editable) {
    const item = paragraph.parentElement;
    const list = item.parentElement;
    if (!(item instanceof HTMLLIElement) || !(list instanceof HTMLUListElement || list instanceof HTMLOListElement) || !list.parentNode) {
      return;
    }
    const continuationItem = document.createElement('li');
    while (paragraph.nextSibling) {
      continuationItem.appendChild(paragraph.nextSibling);
    }
    item.removeChild(paragraph);
    if (continuationItem.childNodes.length > 0) {
      insertContinuationListItem(list, continuationItem, item.nextSibling);
    }

    const parent = list.parentNode;
    const afterList = document.createElement(list.tagName.toLowerCase()) as HTMLUListElement | HTMLOListElement;
    while (item.nextSibling) {
      afterList.appendChild(item.nextSibling);
    }
    pruneEmptyContinuationListItems(afterList);

    if (isEffectivelyEmptyBlock(item)) {
      item.remove();
    }
    if (list.children.length > 0) {
      parent.insertBefore(paragraph, list.nextSibling);
    } else {
      parent.insertBefore(paragraph, list);
      list.remove();
    }
    if (afterList.children.length > 0) {
      parent.insertBefore(afterList, paragraph.nextSibling);
    }
  }
}

function insertContinuationListItem(list: HTMLUListElement | HTMLOListElement, item: HTMLLIElement, before: ChildNode | null): void {
  const singleListChild = getOnlyListChild(item);
  if (singleListChild && singleListChild.tagName === list.tagName) {
    drainContinuationListItems(list, singleListChild, before);
    return;
  }
  list.insertBefore(item, before);
}

function drainContinuationListItems(
  targetList: HTMLUListElement | HTMLOListElement,
  sourceList: HTMLUListElement | HTMLOListElement,
  before: ChildNode | null
): void {
  while (sourceList.firstElementChild) {
    const item = sourceList.firstElementChild;
    if (!(item instanceof HTMLLIElement)) {
      sourceList.removeChild(item);
      continue;
    }
    const nestedList = getOnlyListChild(item);
    if (nestedList && nestedList.tagName === targetList.tagName) {
      drainContinuationListItems(targetList, nestedList, before);
      item.remove();
      continue;
    }
    if (isEffectivelyEmptyContinuationListItem(item)) {
      item.remove();
      continue;
    }
    targetList.insertBefore(item, before);
  }
}

function pruneEmptyContinuationListItems(list: HTMLUListElement | HTMLOListElement): void {
  Array.from(list.children).forEach((child) => {
    if (child instanceof HTMLLIElement && isEffectivelyEmptyContinuationListItem(child)) {
      child.remove();
    }
  });
}

function isEffectivelyEmptyContinuationListItem(item: HTMLLIElement): boolean {
  if (Array.from(item.children).some((child) => child instanceof HTMLUListElement || child instanceof HTMLOListElement)) {
    return false;
  }
  return isEffectivelyEmptyBlock(item);
}

function getOnlyListChild(item: HTMLLIElement): HTMLUListElement | HTMLOListElement | null {
  const meaningfulChildren = Array.from(item.childNodes).filter((child) => {
    if (child instanceof Text) {
      return child.data.replace(/\u200b/g, '').trim().length > 0;
    }
    if (child instanceof HTMLBRElement) {
      return false;
    }
    if (child instanceof HTMLElement && /^(P|DIV|BLOCKQUOTE|H[1-6])$/.test(child.tagName) && isEffectivelyEmptyBlock(child)) {
      return false;
    }
    return true;
  });
  return meaningfulChildren.length === 1 &&
    (meaningfulChildren[0] instanceof HTMLUListElement || meaningfulChildren[0] instanceof HTMLOListElement)
    ? meaningfulChildren[0]
    : null;
}

function moveListItemContentToParagraph(item: HTMLLIElement, paragraph: HTMLParagraphElement): void {
  while (item.firstChild) {
    const child = item.firstChild;
    if (child instanceof HTMLUListElement || child instanceof HTMLOListElement) {
      child.remove();
      continue;
    }
    if (child instanceof HTMLElement && /^(P|DIV|BLOCKQUOTE|H[1-6])$/.test(child.tagName)) {
      appendBlockContentsToParagraph(child, paragraph);
      child.remove();
      continue;
    }
    paragraph.appendChild(child);
  }
}

function appendBlockContentsToParagraph(block: HTMLElement, paragraph: HTMLParagraphElement): void {
  if (paragraph.textContent?.trim() && paragraph.lastChild && !(paragraph.lastChild instanceof HTMLBRElement)) {
    paragraph.appendChild(document.createElement('br'));
  }
  while (block.firstChild) {
    paragraph.appendChild(block.firstChild);
  }
}

function isEmptyEditableListItem(item: HTMLLIElement): boolean {
  const hasNestedList = Array.from(item.children).some((child) => child instanceof HTMLUListElement || child instanceof HTMLOListElement);
  if (hasNestedList) {
    return false;
  }
  return (item.textContent ?? '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim().length === 0;
}

function removeEmptyListAncestors(list: HTMLUListElement | HTMLOListElement): void {
  let current: HTMLElement | null = list;
  while (current instanceof HTMLUListElement || current instanceof HTMLOListElement) {
    const next: HTMLElement | null = current.parentElement instanceof HTMLLIElement ? current.parentElement.parentElement : null;
    if (current.children.length === 0) {
      current.remove();
    }
    current = next;
  }
}

function convertListTypeForItem(item: HTMLLIElement, tagName: EditableListTagName): void {
  const list = item.parentElement;
  if (!(list instanceof HTMLUListElement || list instanceof HTMLOListElement)) {
    return;
  }
  const replacement = document.createElement(tagName);
  while (list.firstChild) {
    replacement.appendChild(list.firstChild);
  }
  list.replaceWith(replacement);
  placeCaretInside(item);
}

interface MovedListItemSelection {
  item: HTMLLIElement;
  snapshot: ListItemSelectionSnapshot | null;
}

function moveSelectionListItemNesting(editable: HTMLElement, direction: 'indent' | 'outdent'): MovedListItemSelection | null {
  const item = getSelectionListItem(editable);
  if (!item) {
    return null;
  }
  const selectionSnapshot = captureListItemSelection(item);
  if (direction === 'indent') {
    indentListItem(item);
  } else {
    outdentListItem(item);
  }
  normalizeEditableListDom(editable);
  if (!restoreListItemSelection(item, selectionSnapshot)) {
    placeCaretInside(item);
  }
  refocusEditablePreservingSelection(editable);
  return { item, snapshot: selectionSnapshot };
}

interface ListItemSelectionSnapshot {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
  textStart: number | null;
  textEnd: number | null;
}

function captureListItemSelection(item: HTMLLIElement): ListItemSelectionSnapshot | null {
  const range = getEditableSelectionRange(item);
  if (!range) {
    return null;
  }
  return {
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
    textStart: getTextOffset(item, range.startContainer, range.startOffset),
    textEnd: getTextOffset(item, range.endContainer, range.endOffset),
  };
}

function restoreListItemSelection(item: HTMLLIElement, snapshot: ListItemSelectionSnapshot | null): boolean {
  if (!snapshot || !item.isConnected) {
    return false;
  }
  if (
    isNodeInsideElement(item, snapshot.startContainer) &&
    isNodeInsideElement(item, snapshot.endContainer) &&
    restoreSelectionByContainers(snapshot)
  ) {
    return true;
  }
  return snapshot.textStart !== null && snapshot.textEnd !== null
    ? restoreSelectionByTextOffsets(item, snapshot.textStart, snapshot.textEnd)
    : false;
}

function restoreMovedListItemSelection(movedSelection: MovedListItemSelection | null, editable: HTMLElement): void {
  if (!movedSelection || !editable.contains(movedSelection.item)) {
    return;
  }
  if (!restoreListItemSelection(movedSelection.item, movedSelection.snapshot)) {
    placeCaretInside(movedSelection.item);
  }
  refocusEditablePreservingSelection(editable);
}

function restoreSelectionByContainers(snapshot: ListItemSelectionSnapshot): boolean {
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }
  try {
    const range = document.createRange();
    range.setStart(snapshot.startContainer, snapshot.startOffset);
    range.setEnd(snapshot.endContainer, snapshot.endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function isNodeInsideElement(element: HTMLElement, node: Node): boolean {
  return node === element || element.contains(node);
}

function indentListItem(item: HTMLLIElement): void {
  const previousItem = item.previousElementSibling;
  if (!(previousItem instanceof HTMLLIElement)) {
    return;
  }
  const list = item.parentElement;
  const tagName: EditableListTagName = list instanceof HTMLOListElement ? 'ol' : 'ul';
  let nestedList = Array.from(previousItem.children).find((child): child is HTMLUListElement | HTMLOListElement =>
    (tagName === 'ol' ? child instanceof HTMLOListElement : child instanceof HTMLUListElement)
  );
  if (!nestedList) {
    nestedList = document.createElement(tagName);
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

function convertMarkdownQuoteAltcut(editable: HTMLElement): boolean {
  if (getCurrentLineAltcut(editable, /^>$/) === null) {
    return false;
  }
  replaceCurrentLineText(editable, '');
  formatSelectionBlock(editable, 'blockquote');
  return true;
}

function convertInlineCodeAltcut(editable: HTMLElement): boolean {
  return convertInlineCodeShortcut(editable, false);
}

function convertInlineCodeInsertedShortcut(editable: HTMLElement): boolean {
  return convertInlineCodeShortcut(editable, true);
}

function convertInlineCodeShortcut(editable: HTMLElement, closingTickInserted: boolean): boolean {
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
  if (closingTickInserted && !prefix.endsWith('`')) {
    return false;
  }
  const openingTickIndex = closingTickInserted
    ? prefix.lastIndexOf('`', prefix.length - 2)
    : prefix.lastIndexOf('`');
  if (openingTickIndex < 0) {
    return false;
  }
  const codeText = closingTickInserted
    ? prefix.slice(openingTickIndex + 1, -1)
    : prefix.slice(openingTickIndex + 1);
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
  const boundary = document.createTextNode('\u200b');
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

function normalizeInlineCodeTextNodes(editable: HTMLElement): boolean {
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || parent.closest('code, pre')) {
        return NodeFilter.FILTER_REJECT;
      }
      return /`[^`\r\n]+`/.test(node.textContent ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      targets.push(current);
    }
    current = walker.nextNode();
  }
  let changed = false;
  for (const textNode of targets) {
    changed = replaceInlineCodeInTextNode(textNode) || changed;
  }
  return changed;
}

function replaceInlineCodeInTextNode(textNode: Text): boolean {
  const text = textNode.textContent ?? '';
  const match = /`([^`\r\n]+)`/.exec(text);
  if (!match || typeof match.index !== 'number') {
    return false;
  }
  const selection = window.getSelection();
  const selectedOffset = selection?.rangeCount && selection.getRangeAt(0).startContainer === textNode
    ? selection.getRangeAt(0).startOffset
    : null;
  const before = text.slice(0, match.index);
  const codeText = match[1] ?? '';
  const after = text.slice(match.index + match[0].length);
  const fragment = document.createDocumentFragment();
  if (before.length > 0) {
    fragment.appendChild(document.createTextNode(before));
  }
  const code = document.createElement('code');
  code.textContent = codeText;
  fragment.appendChild(code);
  const afterNode = document.createTextNode(after.length > 0 ? after : '\u200b');
  fragment.appendChild(afterNode);
  textNode.replaceWith(fragment);
  if (selectedOffset !== null && selectedOffset >= match.index + match[0].length) {
    const range = document.createRange();
    range.setStart(afterNode, after.length > 0 ? Math.min(after.length, selectedOffset - (match.index + match[0].length)) : afterNode.data.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return true;
}

function moveCaretAfterFocusedSortValueControl(event: KeyboardEvent, editable: HTMLElement): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !target.matches('[data-hvy-sort-value="true"]')) {
    return false;
  }
  if (!editable.contains(target)) {
    return false;
  }
  placeCaretAfterInlineElement(target, editable);
  return true;
}

function placeCaretAfterInlineElement(element: HTMLElement, editable: HTMLElement): void {
  const nextNode = element.nextSibling;
  const textNode = nextNode instanceof Text ? nextNode : document.createTextNode('\u200b');
  if (textNode !== nextNode) {
    element.after(textNode);
  }
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.collapse(true);
  if (document.activeElement === element) {
    element.blur();
  }
  editable.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
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

function insertTextAfterInlineCodeAtEnd(editable: HTMLElement, text: string): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range || !range.collapsed) {
    return false;
  }
  const code = getInlineAncestor(range, editable, 'code');
  if (!code || !isCollapsedSelectionAtEndOf(code)) {
    return false;
  }
  moveCollapsedCaretOutsideInline(code, range);
  const nextRange = getEditableSelectionRange(editable);
  if (!nextRange) {
    return false;
  }
  nextRange.deleteContents();
  const textNode = document.createTextNode(text === ' ' ? '\u00a0' : text);
  nextRange.insertNode(textNode);
  nextRange.setStart(textNode, textNode.data.length);
  nextRange.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
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

function exitInlineFormattingAtParagraphEnd(editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  const block = getSelectionBlockElement(editable);
  if (!range?.collapsed || !block || block === editable || !/^(P|DIV)$/.test(block.tagName) || !isCollapsedSelectionAtEndOf(block)) {
    return false;
  }
  const hasInlineContext = (Object.keys(inlineActionTagByAction) as InlineRichAction[]).some((action) =>
    Boolean(getInlineAncestor(range, editable, inlineActionTagByAction[action]))
  );
  if (!hasInlineContext && getPendingInlineActions(editable).size === 0 && getSuppressedInlineActions(editable).size === 0) {
    return false;
  }
  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createTextNode('\u200b'));
  block.parentNode?.insertBefore(paragraph, block.nextSibling);
  clearInlineTypingState(editable);
  placeCaretAtEnd(paragraph);
  return true;
}

function continueTextLineStyleAtSelection(editable: HTMLElement): boolean {
  const range = getEditableSelectionRange(editable);
  if (!range?.collapsed) {
    return false;
  }
  const styled = getAncestorElement(range.startContainer, editable, '[data-hvy-text-line-style]');
  if (!styled || styled === editable) {
    return false;
  }
  const styleName = styled.dataset.hvyTextLineStyle ?? '';
  if (!styleName) {
    return false;
  }
  const wrapper = createTextLineStyleWrapper(styleName, editable.ownerDocument);
  const block = getSelectionBlockElement(editable);
  const currentBlock = block && block !== editable && styled.contains(block) && !block.matches('.hvy-text-line-style-marker')
    ? block
    : null;
  const nextBlock = currentBlock
    ? currentBlock.cloneNode(false) as HTMLElement
    : document.createElement('p');
  if (currentBlock) {
    const tailRange = document.createRange();
    tailRange.selectNodeContents(currentBlock);
    tailRange.setStart(range.startContainer, range.startOffset);
    nextBlock.appendChild(tailRange.extractContents());
    let sibling = currentBlock.nextSibling;
    while (sibling) {
      const nextSibling = sibling.nextSibling;
      nextBlock.appendChild(sibling);
      sibling = nextSibling;
    }
    ensureTextLineStyleBlockHasCaretContent(currentBlock);
  }
  ensureTextLineStyleBlockHasCaretContent(nextBlock);
  wrapper.appendChild(nextBlock);
  styled.parentNode?.insertBefore(wrapper, styled.nextSibling);
  if (isEffectivelyEmptyBlock(nextBlock)) {
    placeCaretAtStart(nextBlock);
  } else {
    placeCaretInside(nextBlock);
  }
  return true;
}

function ensureTextLineStyleBlockHasCaretContent(block: HTMLElement): void {
  if (block.childNodes.length > 0 && !isEffectivelyEmptyBlock(block)) {
    return;
  }
  block.replaceChildren();
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

function getCurrentLineAltcut(editable: HTMLElement, pattern: RegExp): string | null {
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
  replaceCurrentLineElement(editable, createRichCodeBlockShell(editable, pre, normalizedLanguage || 'text'));
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
  insertNodeAtSelection(createRichCodeBlockShell(editable, pre, ''));
  placeCaretInside(code);
}

function createRichCodeBlockShell(editable: HTMLElement, pre: HTMLPreElement, language: string): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'rich-code-block-shell';
  shell.append(createRichCodeLanguageControl(editable, language), pre);
  return shell;
}

function createRichCodeLanguageControl(editable: HTMLElement, language: string): HTMLElement {
  const label = document.createElement('label');
  label.className = 'rich-code-language-control';
  label.contentEditable = 'false';
  const labelText = document.createElement('span');
  labelText.textContent = 'Language';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = language === 'text' ? '' : language;
  input.placeholder = 'text';
  input.dataset.field = 'rich-code-language';
  const sectionKey = editable.dataset.sectionKey;
  const blockId = editable.dataset.blockId;
  if (sectionKey) {
    input.dataset.sectionKey = sectionKey;
  }
  if (blockId) {
    input.dataset.blockId = blockId;
  }
  label.append(labelText, input);
  return label;
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
  replaceCodeBlockWith(pre, paragraph);
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

export function updateRichCodeBlockLanguageInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLInputElement) || target.dataset.field !== 'rich-code-language') {
    return false;
  }
  const pre = target.closest<HTMLElement>('.rich-code-block-shell')?.querySelector('pre') ?? target.closest('pre');
  const code = pre?.querySelector('code');
  if (!(pre instanceof HTMLPreElement) || !(code instanceof HTMLElement)) {
    return false;
  }
  const language = normalizeRichCodeLanguage(target.value);
  pre.dataset.codeLanguage = language;
  Array.from(code.classList)
    .filter((className) => className.startsWith('language-'))
    .forEach((className) => code.classList.remove(className));
  if (language) {
    code.classList.add(`language-${language}`);
    code.dataset.language = language;
  } else {
    delete code.dataset.language;
  }
  return true;
}

function normalizeRichCodeLanguage(value: string): string {
  return value.trim().toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
}

function replaceCodeBlockWith(pre: HTMLPreElement, replacement: HTMLElement): void {
  const shell = pre.closest<HTMLElement>('.rich-code-block-shell');
  if (shell && shell.parentElement) {
    shell.replaceWith(replacement);
    return;
  }
  pre.replaceWith(replacement);
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

function suppressNextCodeBlockParagraphInput(editable: HTMLElement): void {
  editable.dataset.hvyCodeBlockEnterSuppressUntil = String(Date.now() + CODE_BLOCK_ENTER_SUPPRESS_MS);
}

function consumeSuppressedCodeBlockParagraphInput(editable: HTMLElement): boolean {
  const until = Number(editable.dataset.hvyCodeBlockEnterSuppressUntil ?? '0');
  delete editable.dataset.hvyCodeBlockEnterSuppressUntil;
  return Number.isFinite(until) && until >= Date.now();
}

function applyCodeBlockIndentation(editable: HTMLElement, direction: 'indent' | 'dedent'): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return false;
  }
  const code = getSelectionCodeBlock(editable)?.querySelector('code');
  if (!(code instanceof HTMLElement)) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const startOffset = getTextOffset(code, range.startContainer, range.startOffset);
  const endOffset = getTextOffset(code, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null) {
    return false;
  }
  const value = code.textContent ?? '';
  const normalizedStartOffset = startOffset - countCodeCaretAnchors(value.slice(0, startOffset));
  const normalizedEndOffset = endOffset - countCodeCaretAnchors(value.slice(0, endOffset));
  const next = applyCodeIndentation(value.replace(/\u200b/g, ''), normalizedStartOffset, normalizedEndOffset, direction);
  code.textContent = next.value;
  const textNode = code.firstChild instanceof Text ? code.firstChild : code.appendChild(document.createTextNode(''));
  range.setStart(textNode, next.selectionStart);
  range.setEnd(textNode, next.selectionEnd);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
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
  const shell = pre.closest<HTMLElement>('.rich-code-block-shell');
  const reference = shell ?? pre;
  reference.parentNode?.insertBefore(paragraph, reference.nextSibling);
  placeCaretAtEnd(paragraph);
}

function reenterPreviousCodeBlock(editable: HTMLElement): boolean {
  const block = getSelectionBlockElement(editable);
  if (!block || block === editable || !isCollapsedSelectionAtStartOf(block)) {
    return false;
  }
  const previous = block.previousElementSibling;
  const previousPre = previous instanceof HTMLPreElement
    ? previous
    : previous instanceof HTMLElement && previous.classList.contains('rich-code-block-shell')
      ? previous.querySelector('pre')
      : null;
  if (!(previousPre instanceof HTMLPreElement)) {
    return false;
  }
  const code = previousPre.querySelector<HTMLElement>('code');
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
  const coversContents = doesRangeCoverElementContents(editable, range);
  const coversOnlyText = editable.children.length <= 1 && doesRangeCoverElementText(editable, range);
  if (
    !isRangeInsideElement(editable, range) ||
    (!coversContents && !coversOnlyText)
  ) {
    return false;
  }
  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createElement('br'));
  editable.replaceChildren(paragraph);
  placeCaretInside(paragraph);
  return true;
}

function clearSelectedFormatBlock(editable: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const block = getSelectionBlockElement(editable);
  if (!block || !isFormatBlockWithOwnTypingContext(block) || !isRangeInsideElement(block, range)) {
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

function isFormatBlockWithOwnTypingContext(block: HTMLElement): boolean {
  return block instanceof HTMLQuoteElement || /^H[1-6]$/.test(block.tagName);
}

function preventForwardDeleteFormatBlockMerge(editable: HTMLElement): boolean {
  const block = getSelectionBlockElement(editable);
  if (!block || !isFormatBlockWithOwnTypingContext(block) || !isCollapsedSelectionAtEndOf(block)) {
    return false;
  }
  const nextBlock = block.nextElementSibling instanceof HTMLElement ? block.nextElementSibling : null;
  if (!nextBlock) {
    return false;
  }
  if (isEffectivelyEmptyBlock(block)) {
    block.remove();
    placeCaretAtStart(nextBlock);
    editable.dataset.hvyFormatBlockMergeChanged = 'true';
    return true;
  }
  placeCaretAtEnd(block);
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
  replaceCodeBlockWith(pre, paragraph);
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
  const range = selection.getRangeAt(0);
  if (range.startContainer === editable) {
    const child = editable.childNodes[Math.max(0, range.startOffset - 1)] ?? editable.childNodes[range.startOffset];
    if (child) {
      return getBlockElementContaining(editable, child);
    }
  }
  return getBlockElementContaining(editable, range.startContainer);
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
  checkbox.classList.add('hvy-inline-checkbox');
  checkbox.setAttribute('contenteditable', 'false');
  const spacer = document.createTextNode(' ');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(checkbox);
  fragment.appendChild(spacer);
  normalizedRange.insertNode(fragment);
  markInlineCheckboxLine(checkbox);
  placeCaretAfterInlineCheckbox(spacer, editable);
}

function markInlineCheckboxLine(checkbox: HTMLInputElement): void {
  const parent = checkbox.parentElement;
  if (!parent || !isLeadingInlineCheckbox(checkbox)) {
    return;
  }
  parent.classList.add('hvy-inline-checkbox-line');
}

function isLeadingInlineCheckbox(checkbox: HTMLInputElement): boolean {
  let previous = checkbox.previousSibling;
  while (previous) {
    if (previous.nodeType === Node.TEXT_NODE && (previous.textContent ?? '').trim().length === 0) {
      previous = previous.previousSibling;
      continue;
    }
    return false;
  }
  return true;
}

export function syncEditableTaskListMarkup(editable: HTMLElement, markdown: string): void {
  if (!/(^|[^\\])\[( |x|X)\]/.test(markdown)) {
    return;
  }

  if (!hasRawCheckboxMarkerText(editable)) {
    return;
  }

  editable.innerHTML = renderMarkdownToEditorHtml(markdown, {
    textLineStyles: getTextLineStylesFromMeta(state.document.meta),
    textLineStyleMode: 'editor',
    codeLanguageInputAttrs: {
      ...(editable.dataset.sectionKey ? { 'data-section-key': editable.dataset.sectionKey } : {}),
      ...(editable.dataset.blockId ? { 'data-block-id': editable.dataset.blockId } : {}),
    },
  });
  placeCaretAtEnd(editable);
}

function hasRawCheckboxMarkerText(editable: HTMLElement): boolean {
  const text = (editable.textContent ?? '').replace(/\u00a0/g, ' ');
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
