import { state, getRenderApp, getRefreshReaderPanels } from '../../state';
import { findBlockByIds, resolveBlockContext, setActiveEditorBlock, clearActiveEditorBlock, moveBlockByOffset, removeBlockFromList, findBlockInList } from '../../block-ops';
import { findBlockContainerById, findBlockContainerInList } from '../../section-ops';
import { createEmptyBlock, coerceAlign, getReusableTemplateByName } from '../../document-factory';
import { recordHistory } from '../../history';
import { syncReusableTemplateForBlock, findReusableOwner } from '../../reusable';
import { applyImagePreset } from '../../editor/components/image/image';
import { configurePluginBlock } from '../../plugins/plugin-block';
import type { ActionHandler } from './types';

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
};

function normalizeEmptySectionHeadingLevel(value: string | undefined): 1 | 2 | 3 {
  if (value === 'h2') {
    return 2;
  }
  if (value === 'h3') {
    return 3;
  }
  return 1;
}
