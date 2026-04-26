import { state, getRenderApp } from '../../state';
import { findBlockByIds, setActiveEditorBlock } from '../../block-ops';
import { createEmptyBlock } from '../../document-factory';
import { recordHistory } from '../../history';
import { addDbTableColumn, addDbTableRow, getSqliteRowComponent, parseAttachedComponentBlocks, toggleDbTableSort } from '../../plugins/db-table';
import type { ActionHandler } from './types';

const sqliteAddRow: ActionHandler = ({ actionButton }) => {
  const tableName = actionButton.dataset.tableName ?? '';
  if (tableName.length === 0) {
    return;
  }
  recordHistory(`sqlite-add-row:${tableName}`);
  void addDbTableRow(tableName)
    .then(() => {
      getRenderApp()();
    })
    .catch((error) => {
      console.error('[hvy:sqlite-plugin] add row failed', error);
    });
};

const sqliteAddColumn: ActionHandler = ({ actionButton }) => {
  const tableName = actionButton.dataset.tableName ?? '';
  if (tableName.length === 0) {
    return;
  }
  recordHistory(`sqlite-add-column:${tableName}`);
  void addDbTableColumn(tableName)
    .then(() => {
      getRenderApp()();
    })
    .catch((error) => {
      console.error('[hvy:sqlite-plugin] add column failed', error);
    });
};

const dbTableOpenQueryEditor: ActionHandler = ({ sectionKey, blockId }) => {
  if (sectionKey.length === 0 || blockId.length === 0) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  const pluginConfig = block.schema.pluginConfig ?? {};
  const tableName = typeof pluginConfig.table === 'string' ? pluginConfig.table : '';
  const dynamicWindow = typeof pluginConfig.queryDynamicWindow === 'boolean' ? pluginConfig.queryDynamicWindow : true;
  const rawLimit = typeof pluginConfig.queryLimit === 'number'
    ? pluginConfig.queryLimit
    : typeof pluginConfig.queryLimit === 'string'
      ? Number.parseInt(pluginConfig.queryLimit, 10)
      : NaN;
  state.dbTableQueryModal = {
    sectionKey,
    blockId,
    tableName,
    draftQuery: block.text,
    dynamicWindow,
    queryLimit: Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.floor(rawLimit), 99)) : 50,
    error: null,
  };
  getRenderApp()();
};

const dbTableToggleSort: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  const columnName = actionButton.dataset.columnName ?? '';
  if (sectionKey.length === 0 || blockId.length === 0 || columnName.length === 0) {
    return;
  }
  toggleDbTableSort(sectionKey, blockId, columnName);
  getRenderApp()();
};

const sqliteOpenRowComponent = (action: 'sqlite-open-row-component-editor' | 'sqlite-open-row-component-view'): ActionHandler => ({ actionButton, sectionKey, blockId }) => {
  const tableName = actionButton.dataset.tableName ?? '';
  const rowId = Number.parseInt(actionButton.dataset.rowid ?? '', 10);
  if (tableName.length === 0 || Number.isNaN(rowId) || blockId.length === 0 || sectionKey.length === 0) {
    return;
  }
  if (action === 'sqlite-open-row-component-view' && state.currentView === 'editor') {
    setActiveEditorBlock(sectionKey, blockId);
    getRenderApp()();
    return;
  }

  void getSqliteRowComponent(tableName, rowId)
    .then((fragment) => {
      const modalBlocks = fragment ? parseAttachedComponentBlocks(fragment) : [];
      const rawDraft = fragment ?? '';
      const modalState = {
        sectionKey,
        blockId,
        tableName,
        rowId,
        blocks: modalBlocks,
        error: null,
        readOnly: action === 'sqlite-open-row-component-view',
        previousActiveEditorBlock: state.activeEditorBlock ? { ...state.activeEditorBlock } : null,
        mode: state.editorMode,
        rawDraft,
      };
      state.sqliteRowComponentModal = modalState;
      if (!modalState.readOnly && modalBlocks[0]) {
        state.activeEditorBlock = {
          sectionKey,
          blockId: modalBlocks[0].id,
        };
      }
      getRenderApp()();
    })
    .catch((error) => {
      console.error('[hvy:sqlite-plugin] load row component failed', error);
    });
};

const sqliteRowComponentAddBlock: ActionHandler = () => {
  const modal = state.sqliteRowComponentModal;
  if (!modal || modal.readOnly) {
    return;
  }
  recordHistory(`sqlite-row-component-add:${modal.tableName}:${modal.rowId}`);
  const addKey = `sqlite-row-component:${modal.sectionKey}:${modal.rowId}`;
  const component = (state.addComponentBySection[addKey] ?? 'text').trim() || 'text';
  const newBlock = createEmptyBlock(component);
  state.sqliteRowComponentModal = {
    ...modal,
    blocks: [...modal.blocks, newBlock],
    error: null,
  };
  setActiveEditorBlock(modal.sectionKey, newBlock.id);
  getRenderApp()();
};

export const dbTableActions: Record<string, ActionHandler> = {
  'sqlite-add-row': sqliteAddRow,
  'sqlite-add-column': sqliteAddColumn,
  'db-table-open-query-editor': dbTableOpenQueryEditor,
  'db-table-toggle-sort': dbTableToggleSort,
  'sqlite-open-row-component-editor': sqliteOpenRowComponent('sqlite-open-row-component-editor'),
  'sqlite-open-row-component-view': sqliteOpenRowComponent('sqlite-open-row-component-view'),
  'sqlite-row-component-add-block': sqliteRowComponentAddBlock,
};
