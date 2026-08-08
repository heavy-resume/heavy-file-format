import { state, getRenderApp } from '../../state';
import { markActiveEditorBlockAsNew, setActiveEditorBlock } from '../../block-ops';
import { createEmptyBlock } from '../../document-factory';
import { recordHistory } from '../../history';
import { parseAttachedComponentBlocks } from '../../plugins/db-table-fragment';
import type { ActionHandler } from './types';

const loadDbTableRuntime = () => import('../../plugins/db-table');

const dbTableOpenRowComponent = (action: 'db-table-open-row-component-editor' | 'db-table-open-row-component-view'): ActionHandler => ({ actionButton, sectionKey, blockId }) => {
  const tableName = actionButton.dataset.tableName ?? '';
  const rowId = Number.parseInt(actionButton.dataset.rowid ?? '', 10);
  if (tableName.length === 0 || Number.isNaN(rowId) || blockId.length === 0 || sectionKey.length === 0) {
    return;
  }
  if (action === 'db-table-open-row-component-view' && state.currentView === 'editor') {
    setActiveEditorBlock(sectionKey, blockId);
    getRenderApp()();
    return;
  }

  void loadDbTableRuntime()
    .then(({ getDbTableRowComponent }) => getDbTableRowComponent(tableName, rowId))
    .then((fragment) => {
      const modalBlocks = fragment ? parseAttachedComponentBlocks(fragment) : [];
      const rawDraft = fragment ?? '';
      const modalMode: 'basic' | 'advanced' | 'raw' = state.editorMode === 'advanced' || state.editorMode === 'raw' ? state.editorMode : 'basic';
      const modalState = {
        sectionKey,
        blockId,
        tableName,
        rowId,
        blocks: modalBlocks,
        error: null,
        readOnly: action === 'db-table-open-row-component-view',
        previousActiveEditorBlock: state.activeEditorBlock ? { ...state.activeEditorBlock } : null,
        mode: modalMode,
        rawDraft,
      };
      state.dbTableRowComponentModal = modalState;
      if (!modalState.readOnly && modalBlocks[0]) {
        state.activeEditorBlock = {
          sectionKey,
          blockId: modalBlocks[0].id,
        };
      }
      getRenderApp()();
    })
    .catch((error) => {
      console.error('[hvy:db-table-plugin] load row component failed', error);
    });
};

const dbTableRowComponentAddBlock: ActionHandler = () => {
  const modal = state.dbTableRowComponentModal;
  if (!modal || modal.readOnly) {
    return;
  }
  recordHistory(`db-table-row-component-add:${modal.tableName}:${modal.rowId}`);
  const addKey = `db-table-row-component:${modal.sectionKey}:${modal.rowId}`;
  const component = (state.addComponentBySection[addKey] ?? 'text').trim() || 'text';
  const newBlock = createEmptyBlock(component);
  state.dbTableRowComponentModal = {
    ...modal,
    blocks: [...modal.blocks, newBlock],
    error: null,
  };
  setActiveEditorBlock(modal.sectionKey, newBlock.id);
  markActiveEditorBlockAsNew(newBlock.id);
  getRenderApp()();
};

export const dbTableActions: Record<string, ActionHandler> = {
  'db-table-open-row-component-editor': dbTableOpenRowComponent('db-table-open-row-component-editor'),
  'db-table-open-row-component-view': dbTableOpenRowComponent('db-table-open-row-component-view'),
  'db-table-row-component-add-block': dbTableRowComponentAddBlock,
};
