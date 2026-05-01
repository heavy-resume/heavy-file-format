import { state, getRenderApp } from '../../state';
import { resolveBlockContext } from '../../block-ops';
import { createEmptyBlock, ensureGridItems } from '../../document-factory';
import { createGridItem } from '../../grid-ops';
import { recordHistory } from '../../history';
import { syncReusableTemplateForBlock } from '../../reusable';
import { moveItem } from '../../utils';
import type { ActionHandler } from './types';

const addGridItem: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  recordHistory();
  const block = resolveBlockContext(actionButton)?.block ?? null;
  if (!block || block.schema.lock) {
    return;
  }
  ensureGridItems(block.schema);
  const item = createGridItem(block.schema.gridItems.length, block.schema.gridColumns, (c, _s) => createEmptyBlock(c, true));
  item.block = createEmptyBlock(actionButton.dataset.component ?? state.gridAddComponentByBlock[blockId] ?? 'text');
  block.schema.gridItems.push(item);
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
};

const removeGridItem: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
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
};

const moveGridItem = (direction: -1 | 1): ActionHandler => ({ actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
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
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= block.schema.gridItems.length) {
    return;
  }
  block.schema.gridItems = moveItem(block.schema.gridItems, currentIndex, nextIndex);
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
};

export const gridActions: Record<string, ActionHandler> = {
  'add-grid-item': addGridItem,
  'remove-grid-item': removeGridItem,
  'move-grid-item-up': moveGridItem(-1),
  'move-grid-item-down': moveGridItem(1),
};
