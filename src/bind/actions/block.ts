import { state, getRenderApp, getRefreshReaderPanels } from '../../state';
import { blockContainsBlockId, findBlockByIds, resolveBlockContext, setActiveEditorBlock, clearActiveEditorBlock, moveBlockByOffset, removeBlockFromList, findBlockInList } from '../../block-ops';
import { findBlockContainerById, findBlockContainerInList, findSectionByKey } from '../../section-ops';
import { createEmptyBlock, coerceAlign, getReusableTemplateByName } from '../../document-factory';
import { recordHistory } from '../../history';
import { syncReusableTemplateForBlock, findReusableOwner } from '../../reusable';
import { applyImagePreset } from '../../editor/components/image/image';
import { configurePluginBlock } from '../../plugins/plugin-block';
import { makeId } from '../../utils';
import type { ActionHandler } from './types';
import type { GridItem, VisualBlock } from '../../editor/types';

const addBlock: ActionHandler = ({ actionButton, section }) => {
  if (!section || section.lock) {
    return;
  }
  recordHistory();
  const component = (actionButton.dataset.component ?? state.addComponentBySection[section.key] ?? 'text').trim() || 'text';
  const newBlock = createEmptyBlock(component);
  if (component === 'plugin' && actionButton.dataset.pluginId) {
    configurePluginBlock(newBlock, actionButton.dataset.pluginId);
  }
  const previousLastBlockId = section.blocks.length > 0 ? section.blocks[section.blocks.length - 1].id : '';
  for (const child of section.children) {
    if (child.renderAfterBlockId == null) {
      child.renderAfterBlockId = previousLastBlockId;
    }
  }
  section.blocks.push(newBlock);
  setActiveEditorBlock(section.key, newBlock.id);
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
    if (parentId) {
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
  if (parentId) {
    setActiveEditorBlock(sectionKey, parentId);
  }
  getRenderApp()();
};

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

const startComponentPlacement = (mode: 'move' | 'copy'): ActionHandler => ({ sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
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
  if (!placement || !sectionKey) {
    return;
  }
  const targetSection = findSectionByKey(state.document.sections, sectionKey);
  if (!targetSection || targetSection.lock) {
    return;
  }
  const sourceBlock = findBlockByIds(placement.sectionKey, placement.blockId);
  if (!sourceBlock) {
    state.componentPlacement = null;
    getRenderApp()();
    return;
  }
  const targetBlockId = actionButton.dataset.targetBlockId ?? '';
  const targetGridItemId = actionButton.dataset.targetGridItemId ?? '';
  const parentBlockId = actionButton.dataset.parentBlockId ?? '';
  const placementContainer = actionButton.dataset.placementContainer === 'grid' ? 'grid' : 'section';
  const targetPlacement = actionButton.dataset.placement === 'before' || actionButton.dataset.placement === 'after'
    ? actionButton.dataset.placement
    : 'end';
  const gridBlock = placementContainer === 'grid' && parentBlockId ? findBlockByIds(sectionKey, parentBlockId) : null;
  if (placementContainer === 'grid' && (!gridBlock || gridBlock.schema.component !== 'grid')) {
    state.componentPlacement = null;
    getRenderApp()();
    return;
  }

  if (
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

  const placedBlock = placement.mode === 'copy' ? cloneBlockForPlacement(sourceBlock) : sourceBlock;

  if (placement.mode === 'move') {
    recordHistory(`component-${placement.mode}`);
    if (!removeBlockForPlacement(placement.sectionKey, placement.blockId)) {
      state.componentPlacement = null;
      getRenderApp()();
      return;
    }
    syncReusableTemplateForBlock(placement.sectionKey, placement.blockId);
  } else {
    recordHistory(`component-${placement.mode}`);
  }

  if (placementContainer === 'grid') {
    if (!gridBlock) {
      return;
    }
    const insertIndex = getGridPlacementInsertIndex(gridBlock.schema.gridItems, targetPlacement, targetGridItemId);
    gridBlock.schema.gridItems.splice(insertIndex, 0, { id: makeId('griditem'), block: placedBlock });
  } else {
    const insertIndex = getPlacementInsertIndex(targetSection.blocks, targetPlacement, targetBlockId);
    targetSection.blocks.splice(insertIndex, 0, placedBlock);
  }
  syncReusableTemplateForBlock(sectionKey, placedBlock.id);
  state.componentPlacement = null;
  setActiveEditorBlock(sectionKey, placedBlock.id);
  getRenderApp()();
};

export const blockActions: Record<string, ActionHandler> = {
  'add-block': addBlock,
  'add-empty-section-heading': addEmptySectionHeading,
  'toggle-schema': toggleSchema,
  'image-preset': imagePreset,
  'set-block-align': setBlockAlign,
  'remove-block': removeBlock,
  'move-block-up': moveBlock(-1),
  'move-block-down': moveBlock(1),
  'focus-modal': focusModal,
  'open-component-meta': openComponentMeta,
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
    if (removeBlockForPlacementFromList(block.schema.containerBlocks, blockId)) {
      return true;
    }
    if (removeBlockForPlacementFromList(block.schema.componentListBlocks, blockId)) {
      return true;
    }
    if (removeBlockForPlacementFromList(block.schema.expandableStubBlocks.children, blockId)) {
      return true;
    }
    if (removeBlockForPlacementFromList(block.schema.expandableContentBlocks.children, blockId)) {
      return true;
    }
    const gridItemIndex = block.schema.gridItems.findIndex((item) => item.block.id === blockId);
    if (gridItemIndex >= 0) {
      block.schema.gridItems.splice(gridItemIndex, 1);
      return true;
    }
    for (const item of block.schema.gridItems) {
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
  block.schema.containerBlocks.forEach(reassignBlockIds);
  block.schema.componentListBlocks.forEach(reassignBlockIds);
  block.schema.expandableStubBlocks.children.forEach(reassignBlockIds);
  block.schema.expandableContentBlocks.children.forEach(reassignBlockIds);
  block.schema.gridItems.forEach((item) => {
    item.id = makeId('griditem');
    reassignBlockIds(item.block);
  });
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
