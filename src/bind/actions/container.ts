import { state, getRenderApp } from '../../state';
import { findBlockByIds, markActiveEditorBlockAsNew, setActiveEditorBlock, setAiEditorHostBlock } from '../../block-ops';
import { createEmptyBlock, ensureContainerBlocks, ensureComponentListBlocks, ensureExpandableBlocks } from '../../document-factory';
import { recordHistory } from '../../history';
import { syncReusableTemplateForBlock } from '../../reusable';
import { configurePluginBlock } from '../../plugins/plugin-block';
import { openReusableTemplateModalIfNeeded } from './reusable-template';
import { assignAutoBlockId } from '../../auto-block-id';
import { isPdfAllowedComponentInstance, isPdfDocument } from '../../pdf-document-capabilities';
import type { ActionHandler } from './types';

const addComponentListItem: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (isPdfDocument(state.document)) {
    return;
  }
  if (!blockId) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.lock) {
    return;
  }
  ensureComponentListBlocks(block);
  const component = block.schema.componentListComponent || 'text';
  if (isPdfDocument(state.document) && !isPdfAllowedComponentInstance(component, state.document.meta, actionButton.dataset.pluginId)) {
    return;
  }
  if (openReusableTemplateModalIfNeeded(component, { kind: 'component-list', sectionKey, blockId })) {
    return;
  }
  recordHistory();
  const newBlock = createEmptyBlock(component);
  if (newBlock.schema.component === 'plugin' && actionButton.dataset.pluginId) {
    configurePluginBlock(newBlock, actionButton.dataset.pluginId);
  }
  assignAutoBlockId(newBlock, { document: state.document, inheritedTags: block.schema.tags });
  block.schema.componentListBlocks.push(newBlock);
  syncReusableTemplateForBlock(sectionKey, block.id);
  const aiHost = state.currentView === 'ai' ? state.aiEditorHostBlock : null;
  const isInsideEditor = Boolean(actionButton.closest('.editor-block'));
  if (aiHost?.sectionKey === sectionKey && isInsideEditor) {
    setActiveEditorBlock(sectionKey, newBlock.id, { pathBlockIds: [aiHost.blockId, newBlock.id] });
  } else {
    setActiveEditorBlock(sectionKey, newBlock.id, { targetOnly: true });
  }
  if (state.currentView === 'ai' && !isInsideEditor) {
    setAiEditorHostBlock(sectionKey, newBlock.id);
  }
  markActiveEditorBlockAsNew(newBlock.id);
  getRenderApp()();
  centerActiveEditorBlockAfterRender(newBlock.id);
};

const addContainerBlock: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.lock) {
    return;
  }
  ensureContainerBlocks(block);
  const addKey = `container:${sectionKey}:${blockId}`;
  const component = actionButton.dataset.component ?? state.addComponentBySection[addKey] ?? 'text';
  if (isPdfDocument(state.document) && !isPdfAllowedComponentInstance(component, state.document.meta, actionButton.dataset.pluginId)) {
    return;
  }
  if (openReusableTemplateModalIfNeeded(component, { kind: 'container', sectionKey, blockId })) {
    return;
  }
  recordHistory();
  const newBlock = createEmptyBlock(component);
  if (newBlock.schema.component === 'plugin' && actionButton.dataset.pluginId) {
    configurePluginBlock(newBlock, actionButton.dataset.pluginId);
  }
  assignAutoBlockId(newBlock, { document: state.document, inheritedTags: block.schema.tags });
  block.schema.containerBlocks.push(newBlock);
  syncReusableTemplateForBlock(sectionKey, block.id);
  setActiveEditorBlock(sectionKey, newBlock.id);
  markActiveEditorBlockAsNew(newBlock.id);
  getRenderApp()();
};

const addExpandableBlock = (kind: 'stub' | 'content'): ActionHandler => ({ actionButton, sectionKey, blockId }) => {
  if (isPdfDocument(state.document)) {
    return;
  }
  if (!blockId) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  const target = kind === 'stub' ? block.schema.expandableStubBlocks : block.schema.expandableContentBlocks;
  ensureExpandableBlocks(block);
  const addKey = `expandable-${kind}:${sectionKey}:${blockId}`;
  const component = actionButton.dataset.component ?? state.addComponentBySection[addKey] ?? 'container';
  if (isPdfDocument(state.document) && !isPdfAllowedComponentInstance(component, state.document.meta, actionButton.dataset.pluginId)) {
    return;
  }
  if (openReusableTemplateModalIfNeeded(component, { kind: 'expandable', sectionKey, blockId, part: kind })) {
    return;
  }
  recordHistory();
  const newBlock = createEmptyBlock(component);
  if (newBlock.schema.component === 'plugin' && actionButton.dataset.pluginId) {
    configurePluginBlock(newBlock, actionButton.dataset.pluginId);
  }
  assignAutoBlockId(newBlock, { document: state.document, inheritedTags: block.schema.tags });
  target.children.push(newBlock);
  syncReusableTemplateForBlock(sectionKey, block.id);
  setActiveEditorBlock(sectionKey, newBlock.id);
  markActiveEditorBlockAsNew(newBlock.id);
  getRenderApp()();
};

function centerActiveEditorBlockAfterRender(blockId: string): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.editor-block[data-active-block-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      });
    });
  });
}

export const containerActions: Record<string, ActionHandler> = {
  'add-component-list-item': addComponentListItem,
  'add-container-block': addContainerBlock,
  'add-expandable-stub-block': addExpandableBlock('stub'),
  'add-expandable-content-block': addExpandableBlock('content'),
};
