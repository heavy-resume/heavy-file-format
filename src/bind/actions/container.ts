import { state, getRenderApp } from '../../state';
import { findBlockByIds, setActiveEditorBlock } from '../../block-ops';
import { createEmptyBlock, ensureContainerBlocks, ensureComponentListBlocks, ensureExpandableBlocks } from '../../document-factory';
import { recordHistory } from '../../history';
import { syncReusableTemplateForBlock } from '../../reusable';
import { configurePluginBlock } from '../../plugins/plugin-block';
import type { ActionHandler } from './types';

const addComponentListItem: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  recordHistory();
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.lock) {
    return;
  }
  ensureComponentListBlocks(block);
  const newBlock = createEmptyBlock(block.schema.componentListComponent || 'text');
  if (newBlock.schema.component === 'plugin' && actionButton.dataset.pluginId) {
    configurePluginBlock(newBlock, actionButton.dataset.pluginId);
  }
  block.schema.componentListBlocks.push(newBlock);
  syncReusableTemplateForBlock(sectionKey, block.id);
  setActiveEditorBlock(sectionKey, newBlock.id);
  getRenderApp()();
};

const addContainerBlock: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  recordHistory();
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.lock) {
    return;
  }
  ensureContainerBlocks(block);
  const addKey = `container:${sectionKey}:${blockId}`;
  const newBlock = createEmptyBlock(actionButton.dataset.component ?? state.addComponentBySection[addKey] ?? 'text');
  if (newBlock.schema.component === 'plugin' && actionButton.dataset.pluginId) {
    configurePluginBlock(newBlock, actionButton.dataset.pluginId);
  }
  block.schema.containerBlocks.push(newBlock);
  syncReusableTemplateForBlock(sectionKey, block.id);
  setActiveEditorBlock(sectionKey, newBlock.id);
  getRenderApp()();
};

const addExpandableBlock = (kind: 'stub' | 'content'): ActionHandler => ({ actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  recordHistory();
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  const target = kind === 'stub' ? block.schema.expandableStubBlocks : block.schema.expandableContentBlocks;
  ensureExpandableBlocks(block);
  const addKey = `expandable-${kind}:${sectionKey}:${blockId}`;
  const newBlock = createEmptyBlock(actionButton.dataset.component ?? state.addComponentBySection[addKey] ?? 'container');
  if (newBlock.schema.component === 'plugin' && actionButton.dataset.pluginId) {
    configurePluginBlock(newBlock, actionButton.dataset.pluginId);
  }
  target.children.push(newBlock);
  syncReusableTemplateForBlock(sectionKey, block.id);
  setActiveEditorBlock(sectionKey, newBlock.id);
  getRenderApp()();
};

export const containerActions: Record<string, ActionHandler> = {
  'add-component-list-item': addComponentListItem,
  'add-container-block': addContainerBlock,
  'add-expandable-stub-block': addExpandableBlock('stub'),
  'add-expandable-content-block': addExpandableBlock('content'),
};
