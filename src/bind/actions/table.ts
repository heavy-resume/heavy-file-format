import { getRenderApp } from '../../state';
import { findBlockByIds, resolveBlockContext, setActiveEditorBlock } from '../../block-ops';
import { createDefaultTableRow } from '../../document-factory';
import { recordHistory } from '../../history';
import { syncReusableTemplateForBlock } from '../../reusable';
import { addTableColumn, removeTableColumn, getTableColumns } from '../../table-ops';
import { areTablesEnabled } from '../../reference-config';
import type { ActionHandler } from './types';

const addTableRowAction: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId || !areTablesEnabled()) {
    return;
  }
  recordHistory();
  const block = resolveBlockContext(actionButton)?.block ?? findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  const columnCount = getTableColumns(block.schema).length;
  block.schema.tableRows.push(createDefaultTableRow(columnCount));
  syncReusableTemplateForBlock(sectionKey, block.id);
  setActiveEditorBlock(sectionKey, block.id);
  getRenderApp()();
};

const addTableColumnAction: ActionHandler = ({ sectionKey, blockId }) => {
  if (!blockId || !areTablesEnabled()) {
    return;
  }
  recordHistory();
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.lock) {
    return;
  }
  addTableColumn(block.schema);
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
};

const removeTableColumnAction: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId || !areTablesEnabled()) {
    return;
  }
  recordHistory();
  const columnIndex = Number.parseInt(actionButton.dataset.columnIndex ?? '', 10);
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.lock || Number.isNaN(columnIndex)) {
    return;
  }
  removeTableColumn(block.schema, columnIndex);
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
};

const removeTableRowAction: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!blockId || !areTablesEnabled()) {
    return;
  }
  recordHistory();
  const rowIndex = Number.parseInt(actionButton.dataset.rowIndex ?? '', 10);
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || Number.isNaN(rowIndex)) {
    return;
  }
  block.schema.tableRows.splice(rowIndex, 1);
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
};

export const tableActions: Record<string, ActionHandler> = {
  'add-table-row': addTableRowAction,
  'add-table-column': addTableColumnAction,
  'remove-table-column': removeTableColumnAction,
  'remove-table-row': removeTableRowAction,
};
