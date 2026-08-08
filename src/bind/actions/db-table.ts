import { state, getRenderApp } from '../../state';
import { findBlockByIds, markActiveEditorBlockAsNew, setActiveEditorBlock } from '../../block-ops';
import { createEmptyBlock } from '../../document-factory';
import { recordHistory } from '../../history';
import { toggleDbTableSort } from '../../plugins/db-table-model';
import { parseAttachedComponentBlocks } from '../../plugins/db-table-fragment';
import type { ActionHandler } from './types';

const loadDbTableRuntime = () => import('../../plugins/db-table');

const dbTableAddRow: ActionHandler = ({ actionButton }) => {
  const tableName = actionButton.dataset.tableName ?? '';
  if (tableName.length === 0) {
    return;
  }
  recordHistory(`db-table-add-row:${tableName}`);
  void loadDbTableRuntime()
    .then(({ addDbTableRow }) => addDbTableRow(tableName))
    .then(() => {
      getRenderApp()();
    })
    .catch((error) => {
      console.error('[hvy:db-table-plugin] add row failed', error);
    });
};

const dbTableAddColumn: ActionHandler = ({ actionButton }) => {
  const tableName = actionButton.dataset.tableName ?? '';
  if (tableName.length === 0) {
    return;
  }
  recordHistory(`db-table-add-column:${tableName}`);
  void loadDbTableRuntime()
    .then(({ addDbTableColumn }) => addDbTableColumn(tableName))
    .then(() => {
      getRenderApp()();
    })
    .catch((error) => {
      console.error('[hvy:db-table-plugin] add column failed', error);
    });
};

const dbTableCreateTable: ActionHandler = ({ actionButton }) => {
  const tableName = actionButton.dataset.tableName ?? '';
  if (tableName.length === 0) {
    return;
  }
  recordHistory(`db-table-create-table:${tableName}`);
  void loadDbTableRuntime()
    .then(({ createDbTable }) => createDbTable(tableName))
    .then(() => {
      getRenderApp()();
    })
    .catch((error) => {
      console.error('[hvy:db-table-plugin] create table failed', error);
      window.alert(error instanceof Error ? error.message : 'Failed to create table.');
      getRenderApp()();
    });
};

const dbTableDropColumn: ActionHandler = ({ actionButton }) => {
  const tableName = actionButton.dataset.tableName ?? '';
  const columnName = actionButton.dataset.columnName ?? '';
  if (tableName.length === 0 || columnName.length === 0) {
    return;
  }
  recordHistory(`db-table-column-drop:${tableName}:${columnName}`);
  void loadDbTableRuntime()
    .then(({ dropDbTableColumn }) => dropDbTableColumn(tableName, columnName))
    .then(() => {
      getRenderApp()();
    })
    .catch((error) => {
      console.error('[hvy:db-table-plugin] column drop failed', error);
      window.alert(error instanceof Error ? error.message : 'Failed to delete column.');
      getRenderApp()();
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
  'db-table-create-table': dbTableCreateTable,
  'db-table-add-row': dbTableAddRow,
  'db-table-add-column': dbTableAddColumn,
  'db-table-drop-column': dbTableDropColumn,
  'db-table-open-query-editor': dbTableOpenQueryEditor,
  'db-table-toggle-sort': dbTableToggleSort,
  'db-table-open-row-component-editor': dbTableOpenRowComponent('db-table-open-row-component-editor'),
  'db-table-open-row-component-view': dbTableOpenRowComponent('db-table-open-row-component-view'),
  'db-table-row-component-add-block': dbTableRowComponentAddBlock,
};
