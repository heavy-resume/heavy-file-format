import { state, getRenderApp, getRefreshReaderPanels } from '../../state';
import { blockContainsBlockId, findBlockByIds, resolveBlockContext, setActiveEditorBlock, clearActiveEditorBlock, markActiveEditorBlockAsNew, moveBlockByOffset, removeBlockFromList, findBlockInList } from '../../block-ops';
import { findBlockContainerById, findBlockContainerInList, findSectionByKey } from '../../section-ops';
import { cloneReusableBlock, createEmptyBlock, coerceAlign, getReusableTemplateByName } from '../../document-factory';
import { recordHistory } from '../../history';
import { syncReusableTemplateForBlock, findReusableOwner } from '../../reusable';
import { applyImagePreset, deleteCurrentImageAttachment, deleteUnusedImageAttachment, handleImageUpload, openImageCameraCapture, useExistingImageAttachment } from '../../editor/components/image/image';
import { configurePluginBlock } from '../../plugins/plugin-block';
import { makeId } from '../../utils';
import { openReusableTemplateModalIfNeeded } from './reusable-template';
import { prepareTextFillIn, removeTextFillInMarkers } from '../../text-fill-in';
import { isPdfAllowedComponentInstance, isPdfDocument } from '../../pdf-document-capabilities';
import { cloneComponentClipboardEntry, collectBlockAttachments, copyComponentToEditorClipboard, installEditorClipboardAttachments } from '../../editor-clipboard';
import { resolveBaseComponent } from '../../component-defs';
import type { ActionHandler } from './types';
import type { GridItem, VisualBlock } from '../../editor/types';

type ComponentPlacementContainer = 'section' | 'grid' | 'container' | 'component-list' | 'expandable-stub' | 'expandable-content';

const addBlock: ActionHandler = ({ actionButton, section }) => {
  const insertPlacement = actionButton.dataset.insertPlacement === 'before' || actionButton.dataset.insertPlacement === 'after'
    ? actionButton.dataset.insertPlacement
    : null;
  const targetBlockId = actionButton.dataset.targetBlockId ?? '';
  if (!section || (section.lock && (!insertPlacement || !targetBlockId))) {
    return;
  }
  const component = (actionButton.dataset.component ?? state.addComponentBySection[section.key] ?? 'text').trim() || 'text';
  if (isPdfDocument(state.document) && !isPdfAllowedComponentInstance(component, state.document.meta, actionButton.dataset.pluginId)) {
    return;
  }
  if (openReusableTemplateModalIfNeeded(component, { kind: 'section', sectionKey: section.key })) {
    return;
  }
  recordHistory();
  const newBlock = createEmptyBlock(component);
  if (component === 'plugin' && actionButton.dataset.pluginId) {
    configurePluginBlock(newBlock, actionButton.dataset.pluginId);
  }
  if (insertPlacement && targetBlockId && insertBlockRelativeToTarget(section.blocks, targetBlockId, newBlock, insertPlacement, !section.lock)) {
    setActiveEditorBlock(section.key, newBlock.id);
    markActiveEditorBlockAsNew(newBlock.id);
    getRenderApp()();
    return;
  }
  if (insertPlacement || targetBlockId) {
    if (section.lock) {
      return;
    }
  }
  const previousLastBlockId = section.blocks.length > 0 ? section.blocks[section.blocks.length - 1].id : '';
  for (const child of section.children) {
    if (child.renderAfterBlockId == null) {
      child.renderAfterBlockId = previousLastBlockId;
    }
  }
  section.blocks.push(newBlock);
  setActiveEditorBlock(section.key, newBlock.id);
  markActiveEditorBlockAsNew(newBlock.id);
  getRenderApp()();
};

const addEmptySectionHeading: ActionHandler = ({ section }) => {
  if (!section || section.lock || section.blocks.length > 0 || section.children.length > 0 || section.title.trim().length === 0) {
    return;
  }
  recordHistory();
  const headingLevel = normalizeEmptySectionHeadingLevel(state.addComponentBySection[`empty-heading:${section.key}`]);
  const newBlock = createEmptyBlock('text');
  newBlock.text = `${'#'.repeat(headingLevel)} ${section.title.trim()}`;
  section.blocks.push(newBlock);
  setActiveEditorBlock(section.key, newBlock.id);
  markActiveEditorBlockAsNew(newBlock.id);
  getRenderApp()();
};

const toggleSchema: ActionHandler = ({ actionButton, blockId }) => {
  if (!blockId) {
    return;
  }
  recordHistory();
  const block = resolveBlockContext(actionButton)?.block ?? null;
  if (!block) {
    return;
  }
  block.schemaMode = !block.schemaMode;
  getRenderApp()();
};

const imagePreset: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  const preset = actionButton.dataset.imagePreset ?? '';
  applyImagePreset(sectionKey, blockId, preset);
};

const imageUseExisting: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  useExistingImageAttachment(sectionKey, blockId, actionButton.dataset.imageFilename ?? '');
};

const imageDeleteUnused: ActionHandler = ({ actionButton }) => {
  deleteUnusedImageAttachment(actionButton.dataset.imageFilename ?? '');
};

const imageDeleteCurrent: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  deleteCurrentImageAttachment(sectionKey, blockId, actionButton.dataset.imageFilename ?? '');
};

const imageTakePhoto: ActionHandler = ({ app, actionButton, blockId }) => {
  if (!blockId) {
    return;
  }
  openImageCameraCapture(app, {
    title: 'Take photo',
    filenamePrefix: 'photo',
    onCapture: (file) => handleImageUpload(actionButton, file),
  });
};

const setBlockAlign: ActionHandler = ({ app, actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  recordHistory();
  const block = resolveBlockContext(actionButton)?.block ?? null;
  if (!block) {
    return;
  }
  block.schema.align = coerceAlign(actionButton.dataset.alignValue ?? 'left');
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRefreshReaderPanels()();
  const selector = `[data-section-key="${sectionKey}"][data-block-id="${block.id}"][data-field="block-rich"]`;
  const editable = app.querySelector<HTMLElement>(selector);
  if (editable) {
    editable.style.textAlign = block.schema.align;
    editable.focus();
  }
  actionButton
    .closest('.align-buttons')
    ?.querySelectorAll<HTMLButtonElement>('[data-align-value]')
    .forEach((button) => {
      const selected = button.dataset.alignValue === block.schema.align;
      button.classList.toggle('secondary', selected);
      button.classList.toggle('is-selected', selected);
      button.classList.toggle('ghost', !selected);
    });
};

const setTextFillIn: ActionHandler = ({ actionButton, sectionKey }) => {
  const block = resolveBlockContext(actionButton)?.block ?? null;
  if (!block) {
    return;
  }
  recordHistory(`text:${block.id}:fill-in:set`);
  const prepared = prepareTextFillIn(block.text);
  block.text = prepared.text;
  block.schema.fillIn = true;
  state.activeTextEditorMode = { sectionKey, blockId: block.id, mode: 'fill-in' };
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
};

const removeTextFillIn: ActionHandler = ({ actionButton, sectionKey }) => {
  const block = resolveBlockContext(actionButton)?.block ?? null;
  if (!block) {
    return;
  }
  recordHistory(`text:${block.id}:fill-in:remove`);
  block.text = removeTextFillInMarkers(block.text);
  block.schema.fillIn = false;
  state.activeTextEditorMode = { sectionKey, blockId: block.id, mode: 'rich' };
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
};

const addBlockDisplayKey: ActionHandler = ({ actionButton, sectionKey }) => {
  const block = resolveBlockContext(actionButton)?.block ?? null;
  if (!block) {
    return;
  }
  const kind = actionButton.dataset.displayKeyKind === 'group' ? 'group' : 'sort';
  const keyMap = kind === 'group' ? block.schema.groupKeys : block.schema.sortKeys;
  const name = getNextDisplayKeyName(keyMap, kind === 'group' ? 'Grouping Key' : 'Sort Key');
  recordHistory(`display-key:${block.id}:add`);
  keyMap[name] = kind === 'group' ? '' : 0;
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
};

const removeBlockDisplayKey: ActionHandler = ({ actionButton, sectionKey }) => {
  const block = resolveBlockContext(actionButton)?.block ?? null;
  const name = actionButton.dataset.sortKeyName ?? '';
  const keyMap = actionButton.dataset.displayKeyKind === 'group' ? block?.schema.groupKeys : block?.schema.sortKeys;
  if (!block || !keyMap || !name || !Object.prototype.hasOwnProperty.call(keyMap, name)) {
    return;
  }
  recordHistory(`display-key:${block.id}:remove`);
  delete keyMap[name];
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
};

const removeBlock: ActionHandler = ({ section, sectionKey, blockId, reusableName }) => {
  if (!blockId) {
    return;
  }
  recordHistory();
  const sqliteRowModal = state.sqliteRowComponentModal;
  if (sqliteRowModal?.sectionKey === sectionKey) {
    const activeBlockId = state.activeEditorBlock?.sectionKey === sectionKey
      ? (state.activeEditorBlock?.blockId ?? null)
      : null;
    const removedBlock = activeBlockId ? findBlockByIds(sectionKey, blockId) : null;
    const activeIsAffected = activeBlockId !== null && (
      activeBlockId === blockId ||
      (removedBlock !== null && findBlockInList([removedBlock], activeBlockId) !== null)
    );
    const parentId = activeIsAffected
      ? findBlockContainerInList(sqliteRowModal.blocks, blockId, null)?.ownerBlockId ?? null
      : null;
    removeBlockFromList(sqliteRowModal.blocks, blockId);
    if (activeIsAffected && activeBlockId) {
      clearActiveEditorBlock(activeBlockId);
    }
    if (parentId && isActiveEditorPathStillOpen(sectionKey, parentId)) {
      setActiveEditorBlock(sectionKey, parentId);
    }
    state.sqliteRowComponentModal = {
      ...sqliteRowModal,
      blocks: [...sqliteRowModal.blocks],
      error: null,
    };
    getRenderApp()();
    return;
  }
  const reusableOwnerId = findReusableOwner(sectionKey, blockId)?.id ?? null;
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
  if (parentId && isActiveEditorPathStillOpen(sectionKey, parentId)) {
    setActiveEditorBlock(sectionKey, parentId);
  }
  getRenderApp()();
};

function isActiveEditorPathStillOpen(sectionKey: string, blockId: string): boolean {
  return state.activeEditorBlockPath.some((active) => active.sectionKey === sectionKey && active.blockId === blockId);
}

const moveBlock = (offset: -1 | 1): ActionHandler => ({ sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  recordHistory();
  const sqliteRowModal = state.sqliteRowComponentModal;
  if (sqliteRowModal?.sectionKey === sectionKey) {
    const location = findBlockContainerInList(sqliteRowModal.blocks, blockId, null);
    if (!location) {
      return;
    }
    const targetIndex = location.index + offset;
    if (targetIndex < 0 || targetIndex >= location.container.length) {
      return;
    }
    const [movedBlock] = location.container.splice(location.index, 1);
    if (!movedBlock) {
      return;
    }
    location.container.splice(targetIndex, 0, movedBlock);
    state.sqliteRowComponentModal = {
      ...sqliteRowModal,
      blocks: [...sqliteRowModal.blocks],
    };
    getRenderApp()();
    return;
  }
  if (moveBlockByOffset(sectionKey, blockId, offset)) {
    getRenderApp()();
  }
};

const focusModal: ActionHandler = ({ sectionKey }) => {
  state.modalSectionKey = sectionKey;
  getRenderApp()();
};

const openComponentMeta: ActionHandler = ({ sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  state.componentMetaModal = { sectionKey, blockId };
  getRenderApp()();
};

const copyComponent: ActionHandler = ({ sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  copyComponentToEditorClipboard(block, collectBlockAttachments(state.document, block));
  state.contextMenu = null;
  getRenderApp()();
};

const copyExpandablePane = (pane: 'stub' | 'content'): ActionHandler => ({ sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || resolveBaseComponent(block.schema.component) !== 'expandable') {
    return;
  }
  const children = pane === 'stub'
    ? block.schema.expandableStubBlocks.children
    : block.schema.expandableContentBlocks.children;
  const wrapper = createEmptyBlock('container');
  wrapper.schema.containerBlocks = children.map((child) => cloneReusableBlock(child));
  copyComponentToEditorClipboard(wrapper, collectBlockAttachments(state.document, wrapper), { unwrapIntoEmptyContainer: true });
  state.contextMenu = null;
  state.componentPlacement = { mode: 'copy', sectionKey, blockId, source: 'clipboard', sourcePane: pane };
  setActiveEditorBlock(sectionKey, blockId);
  getRenderApp()();
  centerPlacementSourceAfterRender();
};

const startComponentPlacement = (mode: 'move' | 'copy'): ActionHandler => ({ sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  if (mode === 'copy') {
    const block = findBlockByIds(sectionKey, blockId);
    if (block) {
      copyComponentToEditorClipboard(block, collectBlockAttachments(state.document, block));
    }
  }
  state.contextMenu = null;
  state.componentPlacement = { mode, sectionKey, blockId };
  setActiveEditorBlock(sectionKey, blockId);
  getRenderApp()();
  centerPlacementSourceAfterRender();
};

const cancelComponentPlacement: ActionHandler = () => {
  state.componentPlacement = null;
  getRenderApp()();
};

const placeComponent: ActionHandler = ({ actionButton, sectionKey }) => {
  const placement = state.componentPlacement;
  state.contextMenu = null;
  if (!sectionKey) {
    return;
  }
  const targetSection = findSectionByKey(state.document.sections, sectionKey);
  if (!targetSection) {
    return;
  }
  const clipboardEntry = !placement || placement.source === 'clipboard'
    ? cloneComponentClipboardEntry()
    : null;
  const sourceBlock = placement?.source === 'clipboard'
    ? clipboardEntry?.block ?? null
    : placement
      ? findBlockByIds(placement.sectionKey, placement.blockId)
      : clipboardEntry?.block ?? null;
  const unwrapIntoEmptyContainer = clipboardEntry?.unwrapIntoEmptyContainer === true;
  if (!sourceBlock) {
    state.componentPlacement = null;
    getRenderApp()();
    return;
  }
  const targetBlockId = actionButton.dataset.targetBlockId ?? '';
  const targetGridItemId = actionButton.dataset.targetGridItemId ?? '';
  const parentBlockId = actionButton.dataset.parentBlockId ?? '';
  const placementContainer = normalizePlacementContainer(actionButton.dataset.placementContainer);
  if (placementContainer === 'section' && targetSection.lock) {
    return;
  }
  const targetPlacement = actionButton.dataset.placement === 'before' || actionButton.dataset.placement === 'after'
    ? actionButton.dataset.placement
    : 'end';
  const gridBlock = placementContainer === 'grid' && parentBlockId ? findBlockByIds(sectionKey, parentBlockId) : null;
  if (placementContainer === 'grid' && (!gridBlock || gridBlock.schema.component !== 'grid')) {
    state.componentPlacement = null;
    getRenderApp()();
    return;
  }
  const targetBlockList = placementContainer === 'section'
    ? targetSection.blocks
    : placementContainer === 'grid'
      ? null
      : getPlacementBlockList(sectionKey, parentBlockId, placementContainer);
  if (placementContainer !== 'grid' && !targetBlockList) {
    state.componentPlacement = null;
    getRenderApp()();
    return;
  }

  if (
    placement &&
    placement.mode === 'move' &&
    placement.sectionKey === sectionKey &&
    (
      targetBlockId === placement.blockId ||
      parentBlockId === placement.blockId ||
      getGridItemBlockId(sectionKey, parentBlockId, targetGridItemId) === placement.blockId ||
      (parentBlockId.length > 0 && blockContainsBlockId(sourceBlock, parentBlockId))
    )
  ) {
    state.componentPlacement = null;
    getRenderApp()();
    return;
  }

  const placementMode = placement?.mode ?? 'copy';
  const placedBlock = placementMode === 'copy' ? cloneBlockForPlacement(sourceBlock) : sourceBlock;
  const canUnwrapPlacedBlock = placementMode === 'copy'
    && unwrapIntoEmptyContainer
    && placedBlock.schema.component === 'container'
    && Array.isArray(placedBlock.schema.containerBlocks)
    && placedBlock.schema.containerBlocks.length > 0;
  let activePlacedBlockId = placedBlock.id;
  let syncBlockId = placedBlock.id;
  if (placementMode === 'copy') {
    installEditorClipboardAttachments(state.document);
  }

  if (placementMode === 'move') {
    recordHistory(`component-${placementMode}`);
    if (!placement || !removeBlockForPlacement(placement.sectionKey, placement.blockId)) {
      state.componentPlacement = null;
      getRenderApp()();
      return;
    }
    syncReusableTemplateForBlock(placement.sectionKey, placement.blockId);
  } else {
    recordHistory(`component-${placementMode}`);
  }

  if (placementContainer === 'grid') {
    if (!gridBlock) {
      return;
    }
    const insertIndex = getGridPlacementInsertIndex(gridBlock.schema.gridItems, targetPlacement, targetGridItemId);
    gridBlock.schema.gridItems.splice(insertIndex, 0, { id: makeId('griditem'), block: placedBlock });
  } else if (targetBlockList) {
    const insertIndex = getPlacementInsertIndex(targetBlockList, targetPlacement, targetBlockId);
    if (
      canUnwrapPlacedBlock
      && targetBlockList.length === 0
      && (placementContainer === 'container' || placementContainer === 'expandable-stub' || placementContainer === 'expandable-content')
    ) {
      targetBlockList.splice(insertIndex, 0, ...placedBlock.schema.containerBlocks);
      activePlacedBlockId = targetBlockList[insertIndex]?.id ?? placedBlock.id;
      syncBlockId = parentBlockId || activePlacedBlockId;
    } else {
      targetBlockList.splice(insertIndex, 0, placedBlock);
    }
  }
  syncReusableTemplateForBlock(sectionKey, syncBlockId);
  state.componentPlacement = null;
  setActiveEditorBlock(sectionKey, activePlacedBlockId);
  getRenderApp()();
};

export const blockActions: Record<string, ActionHandler> = {
  'add-block': addBlock,
  'add-empty-section-heading': addEmptySectionHeading,
  'toggle-schema': toggleSchema,
  'image-preset': imagePreset,
  'image-use-existing': imageUseExisting,
  'image-delete-unused': imageDeleteUnused,
  'image-delete-current': imageDeleteCurrent,
  'image-take-photo': imageTakePhoto,
  'set-block-align': setBlockAlign,
  'set-text-fill-in': setTextFillIn,
  'remove-text-fill-in': removeTextFillIn,
  'add-block-display-key': addBlockDisplayKey,
  'remove-block-display-key': removeBlockDisplayKey,
  'remove-block': removeBlock,
  'move-block-up': moveBlock(-1),
  'move-block-down': moveBlock(1),
  'focus-modal': focusModal,
  'open-component-meta': openComponentMeta,
  'copy-component': copyComponent,
  'copy-expandable-stub-pane': copyExpandablePane('stub'),
  'copy-expandable-content-pane': copyExpandablePane('content'),
  'start-component-move': startComponentPlacement('move'),
  'start-component-copy': startComponentPlacement('copy'),
  'cancel-component-placement': cancelComponentPlacement,
  'place-component': placeComponent,
};

function getPlacementInsertIndex(blocks: VisualBlock[], placement: 'before' | 'after' | 'end', targetBlockId: string): number {
  if (placement === 'end' || targetBlockId.length === 0) {
    return blocks.length;
  }
  const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);
  if (targetIndex < 0) {
    return blocks.length;
  }
  return placement === 'before' ? targetIndex : targetIndex + 1;
}

function normalizePlacementContainer(value: string | undefined): ComponentPlacementContainer {
  if (
    value === 'grid'
    || value === 'container'
    || value === 'component-list'
    || value === 'expandable-stub'
    || value === 'expandable-content'
  ) {
    return value;
  }
  return 'section';
}

function getPlacementBlockList(
  sectionKey: string,
  parentBlockId: string,
  placementContainer: Exclude<ComponentPlacementContainer, 'section' | 'grid'>
): VisualBlock[] | null {
  const parentBlock = parentBlockId ? findBlockByIds(sectionKey, parentBlockId) : null;
  if (!parentBlock || parentBlock.schema.lock) {
    return null;
  }
  if (placementContainer === 'container') {
    return parentBlock.schema.containerBlocks;
  }
  if (placementContainer === 'component-list') {
    return parentBlock.schema.componentListBlocks;
  }
  if (placementContainer === 'expandable-stub') {
    return parentBlock.schema.expandableStubBlocks.lock ? null : parentBlock.schema.expandableStubBlocks.children;
  }
  return parentBlock.schema.expandableContentBlocks.lock ? null : parentBlock.schema.expandableContentBlocks.children;
}

function getGridPlacementInsertIndex(items: GridItem[], placement: 'before' | 'after' | 'end', targetGridItemId: string): number {
  if (placement === 'end' || targetGridItemId.length === 0) {
    return items.length;
  }
  const targetIndex = items.findIndex((item) => item.id === targetGridItemId);
  if (targetIndex < 0) {
    return items.length;
  }
  return placement === 'before' ? targetIndex : targetIndex + 1;
}

function insertBlockRelativeToTarget(
  blocks: VisualBlock[],
  targetBlockId: string,
  newBlock: VisualBlock,
  placement: 'before' | 'after',
  canInsertInCurrentList = true
): boolean {
  const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);
  if (targetIndex >= 0) {
    if (!canInsertInCurrentList) {
      return false;
    }
    blocks.splice(placement === 'before' ? targetIndex : targetIndex + 1, 0, newBlock);
    return true;
  }
  for (const block of blocks) {
    const blockAllowsChildren = block.schema.lock !== true;
    if (insertBlockRelativeToTarget(block.schema.containerBlocks ?? [], targetBlockId, newBlock, placement, blockAllowsChildren)) {
      return true;
    }
    if (insertBlockRelativeToTarget(block.schema.componentListBlocks ?? [], targetBlockId, newBlock, placement, blockAllowsChildren)) {
      return true;
    }
    if (insertBlockRelativeToTarget(
      block.schema.expandableStubBlocks?.children ?? [],
      targetBlockId,
      newBlock,
      placement,
      blockAllowsChildren && block.schema.expandableStubBlocks?.lock !== true
    )) {
      return true;
    }
    if (insertBlockRelativeToTarget(
      block.schema.expandableContentBlocks?.children ?? [],
      targetBlockId,
      newBlock,
      placement,
      blockAllowsChildren && block.schema.expandableContentBlocks?.lock !== true
    )) {
      return true;
    }
    const gridItems = block.schema.gridItems ?? [];
    const targetGridIndex = gridItems.findIndex((item) => item.block.id === targetBlockId);
    if (targetGridIndex >= 0) {
      if (!blockAllowsChildren) {
        return false;
      }
      gridItems.splice(placement === 'before' ? targetGridIndex : targetGridIndex + 1, 0, {
        id: makeId('griditem'),
        block: newBlock,
      });
      return true;
    }
    for (const item of gridItems) {
      if (insertBlockInsideBlock(item.block, targetBlockId, newBlock, placement)) {
        return true;
      }
    }
  }
  return false;
}

function insertBlockInsideBlock(
  block: VisualBlock,
  targetBlockId: string,
  newBlock: VisualBlock,
  placement: 'before' | 'after'
): boolean {
  const blockAllowsChildren = block.schema.lock !== true;
  return insertBlockRelativeToTarget(block.schema.containerBlocks ?? [], targetBlockId, newBlock, placement, blockAllowsChildren)
    || insertBlockRelativeToTarget(block.schema.componentListBlocks ?? [], targetBlockId, newBlock, placement, blockAllowsChildren)
    || insertBlockRelativeToTarget(
      block.schema.expandableStubBlocks?.children ?? [],
      targetBlockId,
      newBlock,
      placement,
      blockAllowsChildren && block.schema.expandableStubBlocks?.lock !== true
    )
    || insertBlockRelativeToTarget(
      block.schema.expandableContentBlocks?.children ?? [],
      targetBlockId,
      newBlock,
      placement,
      blockAllowsChildren && block.schema.expandableContentBlocks?.lock !== true
    )
    || (block.schema.gridItems ?? []).some((item) => insertBlockInsideBlock(item.block, targetBlockId, newBlock, placement));
}

function getGridItemBlockId(sectionKey: string, gridBlockId: string, gridItemId: string): string | null {
  const gridBlock = gridBlockId ? findBlockByIds(sectionKey, gridBlockId) : null;
  const item = gridBlock?.schema.gridItems.find((candidate) => candidate.id === gridItemId);
  return item?.block.id ?? null;
}

function removeBlockForPlacement(sectionKey: string, blockId: string): boolean {
  const section = findSectionByKey(state.document.sections, sectionKey);
  return section ? removeBlockForPlacementFromList(section.blocks, blockId) : false;
}

function removeBlockForPlacementFromList(blocks: VisualBlock[], blockId: string): boolean {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) {
    blocks.splice(index, 1);
    return true;
  }
  for (const block of blocks) {
    if (removeBlockForPlacementFromList(block.schema.containerBlocks ?? [], blockId)) {
      return true;
    }
    if (removeBlockForPlacementFromList(block.schema.componentListBlocks ?? [], blockId)) {
      return true;
    }
    if (removeBlockForPlacementFromList(block.schema.expandableStubBlocks?.children ?? [], blockId)) {
      return true;
    }
    if (removeBlockForPlacementFromList(block.schema.expandableContentBlocks?.children ?? [], blockId)) {
      return true;
    }
    const gridItems = block.schema.gridItems ?? [];
    const gridItemIndex = gridItems.findIndex((item) => item.block.id === blockId);
    if (gridItemIndex >= 0) {
      gridItems.splice(gridItemIndex, 1);
      return true;
    }
    for (const item of gridItems) {
      if (removeBlockForPlacementFromList([item.block], blockId)) {
        return true;
      }
    }
  }
  return false;
}

function cloneBlockForPlacement(block: VisualBlock): VisualBlock {
  const clone = JSON.parse(JSON.stringify(block)) as VisualBlock;
  reassignBlockIds(clone);
  return clone;
}

function reassignBlockIds(block: VisualBlock): void {
  block.id = makeId('block');
  block.schema.id = '';
  (block.schema.containerBlocks ?? []).forEach(reassignBlockIds);
  (block.schema.componentListBlocks ?? []).forEach(reassignBlockIds);
  (block.schema.expandableStubBlocks?.children ?? []).forEach(reassignBlockIds);
  (block.schema.expandableContentBlocks?.children ?? []).forEach(reassignBlockIds);
  (block.schema.gridItems ?? []).forEach((item) => {
    item.id = makeId('griditem');
    reassignBlockIds(item.block);
  });
}

function getNextDisplayKeyName(keyMap: Record<string, unknown>, baseName: string): string {
  if (!Object.prototype.hasOwnProperty.call(keyMap, baseName)) {
    return baseName;
  }
  let index = 2;
  while (Object.prototype.hasOwnProperty.call(keyMap, `${baseName} ${index}`)) {
    index += 1;
  }
  return `${baseName} ${index}`;
}

function centerPlacementSourceAfterRender(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.editor-block.is-placement-source')?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      });
    });
  });
}

function normalizeEmptySectionHeadingLevel(value: string | undefined): 1 | 2 | 3 {
  if (value === 'h2') {
    return 2;
  }
  if (value === 'h3') {
    return 3;
  }
  return 1;
}
