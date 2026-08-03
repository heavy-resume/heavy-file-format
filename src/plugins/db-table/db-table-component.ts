import type { HvyPlugin, HvyPluginContext, HvyPluginInstance } from '../types';
import type { VisualBlock } from '../../editor/types';
import type { VisualDocument } from '../../types';
import { createBuiltInPluginMetadata, DB_TABLE_PLUGIN_ID, DB_TABLE_PLUGIN_VERSION, FORM_PLUGIN_ID } from '../registry';
import { refreshMountedPlugins } from '../mount';
import { arrowDownIcon, arrowLeftIcon, arrowRightIcon, arrowUpIcon, closeIcon, plusIcon } from '../../icons';
import { escapeAttr, escapeHtml } from '../../utils';
import {
  humanizeDbColumnName,
  DEFAULT_DB_TABLE_V2_MAX_COLUMN_WIDTH,
  normalizeDbTableV2MaxColumnWidth,
  readDbTableV2ColumnConfig,
  readDbTableV2Config,
  removeDbTableV2ColumnConfig,
  renameDbTableV2ColumnConfig,
  updateDbTableV2ColumnConfig,
  type DbTableV2ColumnConfig,
  type DbTableV2Config,
} from './db-table-config';
import {
  addDbTableV2Column,
  addNamedDbTableV2Column,
  coerceDbTableV2Input,
  createBasicDbTableV2,
  deleteDbTableV2Row,
  decodeDbTableV2OptionValue,
  dropDbTableV2Column,
  encodeDbTableV2OptionValue,
  insertDbTableV2Row,
  loadDbTableV2Snapshot,
  renameDbTableV2Column,
  restoreDbTableV2Row,
  stringifyDbTableV2Value,
  updateDbTableV2Cell,
  type DbTableV2ColumnSchema,
  type DbTableV2Snapshot,
  type DbTableV2Value,
} from './db-table-data';
import { getDatabaseTableSources } from '../database-table-source';
import { openRemoveConfirmationModal } from '../../bind/handlers/remove-confirmation-modal';
import {
  getDatabaseHistoryQueueStatus,
  runQueuedDatabaseHistoryCommand,
  subscribeDatabaseHistoryQueue,
  type DatabaseHistoryLogicalTransition,
} from '../../database-history-controller';
import {
  captureHistoryStackState,
  clearDatabaseAttachmentChangedForQueuedHistory,
  recordHistory,
  restoreHistoryStackState,
} from '../../history';
import dbTableV2Documentation from './about-db-table.txt?raw';
import { inferDocumentChangeSource, notifyDocumentMayHaveChanged } from '../../document-change';

import './db-table-component.css';

interface DbTableV2UiState {
  offset: number;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
  settingsOpen: boolean;
  draftActive: boolean;
  error: string;
  queuePending: number;
  queueLabel: string;
}

const visualDescriptions = new WeakMap<object, string>();

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-database-table hvy-database-table-${ctx.mode}`;
  const ui: DbTableV2UiState = {
    offset: 0,
    sortColumn: null,
    sortDirection: null,
    settingsOpen: false,
    draftActive: false,
    error: '',
    queuePending: getDatabaseHistoryQueueStatus().pending,
    queueLabel: getDatabaseHistoryQueueStatus().runningLabel,
  };
  let snapshot: DbTableV2Snapshot | null = null;
  let refreshVersion = 0;
  let disposed = false;
  let unsubscribeQueue = () => {};
  let stopColumnResize = () => {};
  let columnEditor: HTMLElement | null = null;

  const closeColumnEditor = () => {
    columnEditor?.remove();
    columnEditor = null;
  };

  const openColumnEditor = (input: HTMLInputElement) => {
    closeColumnEditor();
    const columnName = input.dataset.columnName ?? '';
    const mode = input.dataset.columnEditMode === 'database' ? 'database' : 'display';
    const editor = document.createElement('div');
    editor.className = 'db-v2-column-editor-popover';
    editor.dataset.columnName = columnName;
    editor.innerHTML = `<strong>Edit column header</strong><div class="db-v2-column-editor-modes" role="group" aria-label="Column name type"><button type="button" class="ghost${mode === 'display' ? ' is-active' : ''}" data-db-v2-column-edit-mode="display">Display</button><button type="button" class="ghost${mode === 'database' ? ' is-active' : ''}" data-db-v2-column-edit-mode="database">DB Column</button></div><span>${mode === 'display' ? `Shown to readers · database: ${escapeHtml(columnName)}` : `Stored in the database · display: ${escapeHtml(input.dataset.displayName ?? '')}`}</span>`;
    root.append(editor);
    const rootBox = root.getBoundingClientRect();
    const inputBox = input.getBoundingClientRect();
    const editorBox = editor.getBoundingClientRect();
    editor.style.left = `${Math.max(0, Math.min(inputBox.left - rootBox.left, rootBox.width - editorBox.width))}px`;
    editor.style.top = `${inputBox.bottom - rootBox.top + 6}px`;
    columnEditor = editor;
  };

  const config = (): DbTableV2Config => readDbTableV2Config(ctx.block.schema.pluginConfig);

  const renderCurrent = () => {
    closeColumnEditor();
    root.innerHTML = renderDbTableV2(ctx, config(), snapshot, ui);
  };

  const refresh = () => {
    const version = ++refreshVersion;
    const activeConfig = config();
    if (!activeConfig.table) {
      snapshot = null;
      visualDescriptions.set(ctx.block, 'DB Table v2: no table selected.');
      renderCurrent();
      return;
    }
    root.classList.add('db-v2-loading');
    void loadDbTableV2Snapshot(ctx.rawDocument, activeConfig, {
      query: ctx.block.text,
      offset: ui.offset,
      sortColumn: ui.sortColumn,
      sortDirection: ui.sortDirection,
    }).then((nextSnapshot) => {
      if (disposed || version !== refreshVersion) return;
      snapshot = nextSnapshot;
      ui.offset = nextSnapshot.offset;
      ui.error = '';
      visualDescriptions.set(ctx.block, describeSnapshot(activeConfig, nextSnapshot));
      renderCurrent();
    }).catch((error) => {
      if (disposed || version !== refreshVersion) return;
      snapshot = null;
      ui.error = error instanceof Error ? error.message : 'Unable to load DB Table v2.';
      visualDescriptions.set(ctx.block, `DB Table v2 error: ${ui.error}`);
      renderCurrent();
    }).finally(() => {
      if (!disposed && version === refreshVersion) root.classList.remove('db-v2-loading');
    });
  };

  root.addEventListener('click', (event) => {
    const editMode = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-db-v2-column-edit-mode]');
    if (editMode && snapshot) {
      const columnName = editMode.closest<HTMLElement>('.db-v2-column-editor-popover')?.dataset.columnName ?? '';
      const column = snapshot.columns.find((candidate) => candidate.name === columnName);
      const input = root.querySelector<HTMLInputElement>(`.db-v2-column-name-input[data-column-name="${CSS.escape(columnName)}"]`);
      if (!column || !input) return;
      const mode = editMode.dataset.dbV2ColumnEditMode === 'database' ? 'database' : 'display';
      const presentation = readDbTableV2ColumnConfig(config(), columnName, { generated: column.generated });
      input.dataset.columnEditMode = mode;
      input.dataset.dbV2Field = mode === 'database' ? 'schema-column-name' : 'column-label';
      input.value = mode === 'database' ? columnName : presentation.label;
      input.setAttribute('aria-label', mode === 'database' ? `Database name for ${columnName}` : `Display name for ${columnName}`);
      input.focus({ preventScroll: true });
      input.select();
      openColumnEditor(input);
      return;
    }
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-db-v2-action]');
    if (!button) return;
    const action = button.dataset.dbV2Action ?? '';
    if (action === 'toggle-columns') {
      ui.settingsOpen = !ui.settingsOpen;
      renderCurrent();
      return;
    }
    if (action === 'add-row') {
      ui.draftActive = true;
      ui.error = '';
      renderCurrent();
      root.querySelector<HTMLElement>('[data-db-v2-draft-control]:not([disabled])')?.focus({ preventScroll: true });
      return;
    }
    if (action === 'cancel-row') {
      ui.draftActive = false;
      ui.error = '';
      renderCurrent();
      return;
    }
    if (action === 'save-row') {
      void saveDraftRow(root, ctx, config(), snapshot, ui);
      return;
    }
    if (action === 'previous-page' || action === 'next-page') {
      const pageSize = config().queryLimit;
      ui.offset = Math.max(0, ui.offset + (action === 'previous-page' ? -pageSize : pageSize));
      refresh();
      return;
    }
    if (action === 'sort') {
      const columnName = button.dataset.columnName ?? '';
      if (ui.sortColumn !== columnName) {
        ui.sortColumn = columnName;
        ui.sortDirection = 'asc';
      } else if (ui.sortDirection === 'asc') {
        ui.sortDirection = 'desc';
      } else {
        ui.sortColumn = null;
        ui.sortDirection = null;
      }
      ui.offset = 0;
      refresh();
      return;
    }
    if (action === 'create-basic-table') {
      button.disabled = true;
      void runDbTableV2Mutation(ctx, 'Create database table', 'checkpoint', () => (
        createBasicDbTableV2(ctx.rawDocument, config().table)
      ))
        .then(() => refreshDatabasePlugins())
        .catch((error) => {
          ui.error = error instanceof Error ? error.message : 'Unable to create the basic table.';
          renderCurrent();
        });
      return;
    }
    if (action === 'add-column') {
      button.disabled = true;
      const tableName = config().table;
      void runDbTableV2Mutation(ctx, 'Add database column', 'logical', () => (
        addDbTableV2Column(ctx.rawDocument, tableName)
      ), (columnName) => ({
        undo: () => dropDbTableV2Column(ctx.rawDocument, tableName, columnName),
        redo: () => addNamedDbTableV2Column(ctx.rawDocument, tableName, columnName),
      }))
        .then(() => refreshDatabasePlugins())
        .catch((error) => showOperationError(ui, renderCurrent, error, 'Unable to add the column.'));
      return;
    }
    if (action === 'delete-column') {
      const columnName = button.dataset.columnName ?? '';
      if (!columnName) return;
      openRemoveConfirmationModal(() => {
        const tableName = config().table;
        void runDbTableV2Mutation(ctx, 'Delete database column', 'checkpoint', async () => {
          await dropDbTableV2Column(ctx.rawDocument, tableName, columnName);
            ctx.setConfig(removeDbTableV2ColumnConfig(config(), columnName));
        }).then(() => refreshDatabasePlugins())
          .catch((error) => showOperationError(ui, renderCurrent, error, 'Unable to delete the column.'));
      }, ctx.hostRoot);
      return;
    }
    if (action === 'delete-row') {
      const rowId = Number(button.dataset.rowId);
      if (!Number.isFinite(rowId)) return;
      openRemoveConfirmationModal(() => {
        void runDbTableV2Mutation(ctx, 'Delete database row', 'checkpoint', () => (
          deleteDbTableV2Row(ctx.rawDocument, config().table, rowId)
        ))
          .then(() => refreshDatabasePlugins())
          .catch((error) => showOperationError(ui, renderCurrent, error, 'Unable to delete the row.'));
      }, ctx.hostRoot);
    }
  });

  root.addEventListener('focusin', (event) => {
    const input = (event.target as Element | null)?.closest<HTMLInputElement>('.db-v2-column-name-input');
    if (input) openColumnEditor(input);
  });

  root.addEventListener('focusout', () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active && (active.closest('.db-v2-column-editor-popover') || active.classList.contains('db-v2-column-name-input'))) return;
      closeColumnEditor();
    }, 0);
  });

  root.addEventListener('keydown', (event) => {
    const input = (event.target as Element | null)?.closest<HTMLInputElement>('.db-v2-column-name-input');
    if (!input) return;
    if (event.key === 'Enter') input.blur();
  });

  root.addEventListener('pointerdown', (event) => {
    if ((event.target as Element | null)?.closest('[data-db-v2-column-edit-mode]')) {
      event.preventDefault();
      return;
    }
    const handle = (event.target as Element | null)?.closest<HTMLElement>('.db-v2-resize-handle');
    if (!handle || event.button !== 0 || ctx.mode !== 'editor') return;
    const columnName = handle.dataset.columnName ?? '';
    const column = root.querySelector<HTMLTableColElement>(`col[data-column-name="${CSS.escape(columnName)}"]`);
    const header = handle.closest<HTMLTableCellElement>('th');
    if (!column || !header) return;
    event.preventDefault();
    event.stopPropagation();
    stopColumnResize();
    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;
    const maximumWidth = resolveDbTableV2MaximumColumnWidth(root, ctx.header.get('database_table_max_column_width'));
    let nextWidth = startWidth;
    let moved = false;
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const delta = moveEvent.clientX - startX;
      if (Math.abs(delta) > 1) moved = true;
      nextWidth = Math.max(64, Math.min(startWidth + delta, maximumWidth));
      column.style.width = `${nextWidth}px`;
    };
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      stopColumnResize();
      if (moved) ctx.setConfig(updateDbTableV2ColumnConfig(config(), columnName, { width: `${Math.round(nextWidth)}px` }));
    };
    stopColumnResize = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      stopColumnResize = () => {};
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });

  root.addEventListener('dblclick', (event) => {
    const handle = (event.target as Element | null)?.closest<HTMLElement>('.db-v2-resize-handle');
    if (!handle || ctx.mode !== 'editor') return;
    event.preventDefault();
    event.stopPropagation();
    const columnName = handle.dataset.columnName ?? '';
    const width = measureDbTableV2ColumnContent(root, columnName, ctx.header.get('database_table_max_column_width'));
    if (width !== null) ctx.setConfig(updateDbTableV2ColumnConfig(config(), columnName, { width: `${width}px` }));
  });

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    const field = target.dataset.dbV2Field ?? '';
    if (field === 'source') {
      ui.offset = 0;
      ui.sortColumn = null;
      ui.sortDirection = null;
      ctx.setConfig({ source: target.value });
      return;
    }
    if (field === 'table') {
      ui.offset = 0;
      ui.sortColumn = null;
      ui.sortDirection = null;
      ctx.setConfig({ table: target.value.trim() });
      return;
    }
    if (field === 'query') {
      ui.offset = 0;
      ctx.setText(target.value);
      return;
    }
    if (field === 'query-limit') {
      ui.offset = 0;
      const parsed = Number.parseInt(target.value, 10);
      ctx.setConfig({ queryLimit: Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 1_000)) : 50 });
      return;
    }
    if (field === 'schema-column-name' && snapshot) {
      const oldColumnName = target.dataset.columnName ?? '';
      const nextColumnName = target.value.trim();
      if (!oldColumnName || nextColumnName === oldColumnName) return;
      target.disabled = true;
      const tableName = config().table;
      void runDbTableV2Mutation(ctx, 'Rename database column', 'logical', async () => {
        const renamed = await renameDbTableV2Column(ctx.rawDocument, tableName, oldColumnName, nextColumnName);
        ctx.setConfig(renameDbTableV2ColumnConfig(config(), oldColumnName, renamed));
        return renamed;
      }, (renamed) => ({
        undo: async () => { await renameDbTableV2Column(ctx.rawDocument, tableName, renamed, oldColumnName); },
        redo: async () => { await renameDbTableV2Column(ctx.rawDocument, tableName, oldColumnName, renamed); },
      }))
        .then(() => refreshDatabasePlugins())
        .catch((error) => showOperationError(ui, renderCurrent, error, 'Unable to rename the column.'));
      return;
    }
    if (field === 'cell' && snapshot) {
      const column = snapshot.columns.find((candidate) => candidate.name === target.dataset.columnName);
      const rowId = Number(target.dataset.rowId);
      if (!column || !Number.isFinite(rowId)) return;
      const value = target instanceof HTMLSelectElement
        ? decodeDbTableV2OptionValue(target.value)
        : coerceDbTableV2Input(target.value, column.type);
      target.disabled = true;
      const tableName = config().table;
      const previousValue = cloneDbTableV2Value(snapshot.rows.find((row) => row.rowId === rowId)?.values[column.name] ?? null);
      void runDbTableV2Mutation(ctx, 'Edit database cell', snapshot.hasTriggers ? 'checkpoint' : 'logical', () => (
        updateDbTableV2Cell(ctx.rawDocument, tableName, rowId, column, value)
      ), () => ({
        undo: () => updateDbTableV2Cell(ctx.rawDocument, tableName, rowId, column, previousValue),
        redo: () => updateDbTableV2Cell(ctx.rawDocument, tableName, rowId, column, value),
      }))
        .then(() => refreshDatabasePlugins())
        .catch((error) => {
          ui.error = error instanceof Error ? error.message : 'Unable to update the cell.';
          renderCurrent();
        });
      return;
    }
    if (field.startsWith('column-') && snapshot) {
      const columnName = target.dataset.columnName ?? '';
      const column = snapshot.columns.find((candidate) => candidate.name === columnName);
      if (!column) return;
      let patch: DbTableV2ColumnConfig = {};
      if (field === 'column-label') patch = { label: target.value };
      if (field === 'column-width') patch = { width: target.value };
      if (field === 'column-wrap' && target instanceof HTMLInputElement) patch = { wrap: target.checked };
      if (field === 'column-foreign-display') patch = { foreignDisplayColumn: target.value };
      if (field === 'column-visibility') {
        const visibility = target.value === 'hidden' || target.value === 'compact' ? target.value : 'visible';
        if (visibility === 'hidden' && isRequiredDraftColumn(column)) {
          ui.error = `Required column "${column.name}" cannot be hidden because it has no default.`;
          renderCurrent();
          return;
        }
        patch = { visibility };
      }
      ctx.setConfig(updateDbTableV2ColumnConfig(config(), columnName, patch));
    }
  });

  unsubscribeQueue = subscribeDatabaseHistoryQueue((status) => {
    if (disposed) return;
    ui.queuePending = status.pending;
    ui.queueLabel = status.runningLabel;
    if (status.error) ui.error = status.error;
    renderCurrent();
  });
  refresh();
  return {
    element: root,
    refresh,
    unmount: () => {
      disposed = true;
      refreshVersion += 1;
      stopColumnResize();
      closeColumnEditor();
      unsubscribeQueue();
    },
  };
}

function renderDbTableV2(
  ctx: HvyPluginContext,
  config: DbTableV2Config,
  snapshot: DbTableV2Snapshot | null,
  ui: DbTableV2UiState
): string {
  const toolbar = ctx.mode === 'editor' ? renderEditorToolbar(ctx, config, snapshot, ui) : '';
  if (!config.table) {
    return `${toolbar}<div class="db-v2-placeholder">Choose a table or view to display.</div>`;
  }
  if (!snapshot) {
    const missing = /does not exist/u.test(ui.error);
    return `${toolbar}<div class="db-v2-placeholder db-v2-error">
      <span>${escapeHtml(ui.error || 'Loading table…')}</span>
      ${missing && ctx.mode === 'editor' && config.source === 'with-file'
        ? `<button type="button" class="secondary" data-db-v2-action="create-basic-table">Create Basic Table</button>`
        : ''}
    </div>`;
  }
  const settings = ctx.mode === 'editor' && ui.settingsOpen ? renderColumnSettings(config, snapshot) : '';
  const status = ui.error ? `<div class="db-v2-inline-error" role="alert">${escapeHtml(ui.error)}</div>` : '';
  const queue = ui.queuePending > 0
    ? `<div class="db-v2-queue-status" role="status"><span class="db-v2-queue-pulse"></span>${escapeHtml(ui.queueLabel || 'Database edit queued')}${ui.queuePending > 1 ? ` · ${ui.queuePending - 1} waiting` : ''}</div>`
    : '';
  return `${toolbar}${settings}${queue}${status}${renderTable(ctx, config, snapshot, ui)}`;
}

function renderEditorToolbar(
  ctx: HvyPluginContext,
  config: DbTableV2Config,
  snapshot: DbTableV2Snapshot | null,
  ui: DbTableV2UiState
): string {
  const sources = getDatabaseTableSources();
  const sourceOptions = sources.some((source) => source.id === config.source)
    ? sources
    : [{ id: config.source, label: config.source }, ...sources];
  return `<div class="db-v2-toolbar">
    ${sourceOptions.length > 1 ? `<label class="db-v2-field db-v2-source-field"><span>Source</span><span class="db-v2-select-shell"><select data-db-v2-field="source">${sourceOptions.map((source) => `<option value="${escapeAttr(source.id)}" ${source.id === config.source ? 'selected' : ''}>${escapeHtml(source.label || source.id)}</option>`).join('')}</select>${arrowDownIcon()}</span></label>` : ''}
    <label class="db-v2-field db-v2-table-field"><span>Table or view</span><input data-db-v2-field="table" value="${escapeAttr(config.table)}" placeholder="table_name"></label>
    <button type="button" class="secondary db-v2-columns-button${ui.settingsOpen ? ' is-active' : ''}" data-db-v2-action="toggle-columns" ${snapshot ? '' : 'disabled'}>Columns</button>
    <details class="db-v2-query" ${ctx.block.text.trim() ? 'open' : ''}>
      <summary>Query</summary>
      <label class="db-v2-field"><span>Optional read-only SELECT</span><textarea data-db-v2-field="query" rows="4" placeholder="SELECT * FROM ${escapeAttr(config.table || 'table_name')}">${escapeHtml(ctx.block.text)}</textarea></label>
      <div class="db-v2-query-options">
        <label class="db-v2-field db-v2-query-limit"><span>Rows per page</span><input type="number" min="1" max="1000" data-db-v2-field="query-limit" value="${config.queryLimit}"></label>
      </div>
    </details>
  </div>`;
}

function renderColumnSettings(config: DbTableV2Config, snapshot: DbTableV2Snapshot): string {
  return `<section class="db-v2-column-settings" aria-label="Column settings">
    <div class="db-v2-settings-heading"><div><strong>Column management</strong><span>Database column changes affect the table. Presentation settings affect only this component.</span></div><button type="button" class="ghost db-v2-settings-close" data-db-v2-action="toggle-columns" aria-label="Close column settings">${closeIcon()}</button></div>
    <div class="db-v2-settings-list">
      ${snapshot.columns.map((column) => {
        const presentation = readDbTableV2ColumnConfig(config, column.name, { generated: column.generated });
        const required = isRequiredDraftColumn(column);
        return `<div class="db-v2-column-card">
          <div class="db-v2-column-identity"><strong>${escapeHtml(column.name)}</strong><span>${escapeHtml(column.type || 'untyped')}${column.generated ? ' · generated key' : ''}${column.foreignKey ? ` · references ${escapeHtml(column.foreignKey.referencedTable)}` : ''}</span></div>
          <label class="db-v2-field"><span>Database column</span><input data-db-v2-field="schema-column-name" data-column-name="${escapeAttr(column.name)}" value="${escapeAttr(column.name)}" ${snapshot.editable ? '' : 'disabled'}></label>
          <label class="db-v2-field"><span>Heading</span><input data-db-v2-field="column-label" data-column-name="${escapeAttr(column.name)}" value="${escapeAttr(presentation.label)}"></label>
          <label class="db-v2-field"><span>Visibility</span>${renderSelect(
            'column-visibility',
            column.name,
            presentation.visibility,
            [
              { value: 'visible', label: 'Visible' },
              { value: 'compact', label: 'Compact' },
              ...(!required ? [{ value: 'hidden', label: 'Hidden' }] : []),
            ]
          )}</label>
          <label class="db-v2-field"><span>Width</span><input data-db-v2-field="column-width" data-column-name="${escapeAttr(column.name)}" value="${escapeAttr(presentation.width)}" placeholder="12rem"></label>
          <label class="db-v2-check"><input type="checkbox" data-db-v2-field="column-wrap" data-column-name="${escapeAttr(column.name)}" ${presentation.wrap ? 'checked' : ''}><span>Wrap values</span></label>
          ${column.foreignKey ? `<label class="db-v2-field db-v2-relationship-setting"><span>Display ${escapeHtml(column.foreignKey.referencedTable)} by</span>${renderSelect(
            'column-foreign-display',
            column.name,
            presentation.foreignDisplayColumn ?? '',
            [
              { value: '', label: 'Raw stored value' },
              ...column.foreignKey.displayColumnOptions.map((name) => ({ value: name, label: humanizeDbColumnName(name) })),
            ]
          )}</label>` : ''}
          <button type="button" class="ghost db-v2-delete-column" data-db-v2-action="delete-column" data-column-name="${escapeAttr(column.name)}" aria-label="Delete database column ${escapeAttr(column.name)}" ${!snapshot.editable || snapshot.columns.length <= 1 ? 'disabled' : ''}>${closeIcon()}<span>Delete column</span></button>
        </div>`;
      }).join('')}
    </div>
    <button type="button" class="secondary db-v2-add-column" data-db-v2-action="add-column" ${snapshot.editable ? '' : 'disabled'}>${plusIcon()} Column</button>
  </section>`;
}

function renderTable(ctx: HvyPluginContext, config: DbTableV2Config, snapshot: DbTableV2Snapshot, ui: DbTableV2UiState): string {
  const visibleColumns = snapshot.columns.filter((column) => (
    readDbTableV2ColumnConfig(config, column.name, { generated: column.generated }).visibility !== 'hidden'
  ));
  const hiddenRequired = snapshot.columns.filter((column) => (
    readDbTableV2ColumnConfig(config, column.name, { generated: column.generated }).visibility === 'hidden'
    && isRequiredDraftColumn(column)
  ));
  const editable = ctx.mode === 'editor' && snapshot.editable;
  const showRowActions = editable || snapshot.rows.some((row) => row.hasAttachedComponent);
  return `<div class="db-v2-table-shell">
    <div class="db-v2-table-heading">
      <div><strong>${escapeHtml(config.table)}</strong><span>${snapshot.queryActive ? 'Query result · read-only' : snapshot.objectType === 'view' ? 'Database view · read-only' : snapshot.editable ? 'Database table · editable' : 'Database table · read-only'}</span></div>
      ${snapshot.offset > 0 || snapshot.hasNextPage ? renderPager(snapshot) : ''}
    </div>
    <div class="db-v2-table-frame">
      <table class="db-v2-table${editable ? ' is-editable' : ''}">
        <colgroup>${visibleColumns.map((column) => renderColumnElement(config, column)).join('')}${showRowActions ? '<col class="db-v2-actions-column">' : ''}</colgroup>
        <thead><tr>${visibleColumns.map((column) => renderHeader(config, column, snapshot, ui)).join('')}${showRowActions ? '<th class="db-v2-actions-heading"><span class="db-v2-screen-reader">Actions</span></th>' : ''}</tr></thead>
        <tbody>
          ${snapshot.rows.map((row) => `<tr class="${row.hasAttachedComponent ? 'has-attached-component' : ''}">${visibleColumns.map((column) => renderCell(config, column, row.values[column.name] ?? null, row.rowId, editable)).join('')}${showRowActions ? renderRowActions(ctx, config, row.rowId, row.hasAttachedComponent, editable) : ''}</tr>`).join('')}
          ${ui.draftActive && editable ? renderDraftRow(config, visibleColumns) : ''}
          ${snapshot.rows.length === 0 && !ui.draftActive ? `<tr><td class="db-v2-empty" colspan="${Math.max(visibleColumns.length + (editable ? 1 : 0), 1)}">No rows yet.</td></tr>` : ''}
        </tbody>
      </table>
    </div>
    ${editable ? `<div class="db-v2-table-actions">
      <button type="button" class="secondary db-v2-add-row" data-db-v2-action="add-row" ${ui.draftActive || hiddenRequired.length > 0 ? 'disabled' : ''}>${plusIcon()} Row</button>
      ${hiddenRequired.length > 0 ? `<span class="db-v2-action-note">Show required column${hiddenRequired.length === 1 ? '' : 's'} ${hiddenRequired.map((column) => escapeHtml(column.name)).join(', ')} before adding rows.</span>` : ''}
    </div>` : ''}
  </div>`;
}

function renderRowActions(
  ctx: HvyPluginContext,
  config: DbTableV2Config,
  rowId: number | null,
  hasAttachedComponent: boolean,
  editable: boolean
): string {
  if (rowId === null) return '<td class="db-v2-row-actions"></td>';
  const attachmentAction = editable ? 'sqlite-open-row-component-editor' : 'sqlite-open-row-component-view';
  return `<td class="db-v2-row-actions">
    <div class="db-v2-row-action-group">
      ${editable || hasAttachedComponent ? `<button type="button" class="ghost db-v2-row-component ${hasAttachedComponent ? 'is-attached' : ''}" data-action="${attachmentAction}" data-section-key="${escapeAttr(ctx.sectionKey)}" data-block-id="${escapeAttr(ctx.block.id)}" data-table-name="${escapeAttr(config.table)}" data-rowid="${rowId}">${hasAttachedComponent ? (editable ? 'Edit details' : 'View details') : 'Add details'}</button>` : ''}
      ${editable ? `<button type="button" class="ghost db-v2-delete-row" data-db-v2-action="delete-row" data-row-id="${rowId}" aria-label="Delete row">${closeIcon()}</button>` : ''}
    </div>
  </td>`;
}

function renderColumnElement(config: DbTableV2Config, column: DbTableV2ColumnSchema): string {
  const presentation = readDbTableV2ColumnConfig(config, column.name, { generated: column.generated });
  return `<col data-column-name="${escapeAttr(column.name)}" style="width:${escapeAttr(presentation.width)}">`;
}

function renderHeader(
  config: DbTableV2Config,
  column: DbTableV2ColumnSchema,
  snapshot: DbTableV2Snapshot,
  ui: DbTableV2UiState
): string {
  const presentation = readDbTableV2ColumnConfig(config, column.name, { generated: column.generated });
  const sortIcon = ui.sortColumn === column.name && ui.sortDirection === 'desc' ? arrowDownIcon() : arrowUpIcon();
  const heading = snapshot.editable
    ? `<input class="db-v2-column-name-input" data-db-v2-field="column-label" data-column-edit-mode="display" data-column-name="${escapeAttr(column.name)}" data-display-name="${escapeAttr(presentation.label)}" value="${escapeAttr(presentation.label)}" aria-label="Display name for ${escapeAttr(column.name)}" title="Edit display or DB column name">`
    : `<span>${escapeHtml(presentation.label)}</span>`;
  return `<th class="${presentation.wrap ? 'is-wrapped' : ''}" title="${escapeAttr(presentation.label)}"><div class="db-v2-header-content">${heading}${snapshot.editable ? `<button type="button" class="ghost db-v2-sort" data-db-v2-action="sort" data-column-name="${escapeAttr(column.name)}" aria-label="Sort by ${escapeAttr(presentation.label)}">${sortIcon}</button><span class="db-v2-resize-handle" data-column-name="${escapeAttr(column.name)}" title="Drag to resize; double-click to fit data" aria-hidden="true"></span>` : ''}</div></th>`;
}

function resolveDbTableV2MaximumColumnWidth(root: HTMLElement, configured: unknown): number {
  const width = normalizeDbTableV2MaxColumnWidth(configured) || DEFAULT_DB_TABLE_V2_MAX_COLUMN_WIDTH;
  const probe = document.createElement('span');
  probe.className = 'db-v2-width-probe';
  probe.style.width = width;
  root.append(probe);
  const pixels = probe.getBoundingClientRect().width;
  probe.remove();
  return Number.isFinite(pixels) && pixels > 0 ? pixels : 640;
}

function measureDbTableV2ColumnContent(root: HTMLElement, columnName: string, configuredMaximum: unknown): number | null {
  const column = root.querySelector<HTMLTableColElement>(`col[data-column-name="${CSS.escape(columnName)}"]`);
  const columns = [...root.querySelectorAll<HTMLTableColElement>('.db-v2-table col')];
  const columnIndex = column ? columns.indexOf(column) : -1;
  if (!column || columnIndex < 0) return null;
  const table = column.closest('table');
  const header = table?.querySelectorAll<HTMLTableCellElement>('thead th')[columnIndex];
  if (!table || !header) return null;
  const measurer = document.createElement('span');
  measurer.className = 'db-v2-content-measurer';
  const sample = (text: string, source: Element) => {
    const style = getComputedStyle(source);
    measurer.style.font = style.font;
    measurer.style.letterSpacing = style.letterSpacing;
    measurer.textContent = text || ' ';
    root.append(measurer);
    const width = measurer.getBoundingClientRect().width;
    measurer.remove();
    return width;
  };
  const headerLabel = header.querySelector<HTMLElement>('.db-v2-column-name-input, .db-v2-header-content > span:first-child');
  const headerText = headerLabel instanceof HTMLInputElement ? headerLabel.value : headerLabel?.textContent ?? '';
  let contentWidth = headerLabel ? sample(headerText, headerLabel) + 52 : 64;
  for (const row of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
    const cell = row.cells[columnIndex];
    if (!cell) continue;
    const control = cell.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
    const text = control instanceof HTMLSelectElement
      ? control.selectedOptions[0]?.textContent ?? ''
      : control instanceof HTMLInputElement
        ? control.value
        : cell.textContent ?? '';
    contentWidth = Math.max(contentWidth, sample(text, control ?? cell) + 20);
  }
  return Math.round(Math.max(64, Math.min(contentWidth, resolveDbTableV2MaximumColumnWidth(root, configuredMaximum))));
}

function renderCell(
  config: DbTableV2Config,
  column: DbTableV2ColumnSchema,
  value: DbTableV2Value,
  rowId: number | null,
  editable: boolean
): string {
  const presentation = readDbTableV2ColumnConfig(config, column.name, { generated: column.generated });
  const className = presentation.wrap ? 'is-wrapped' : '';
  if (!editable || column.generated || rowId === null) {
    return `<td class="${className}" title="${escapeAttr(displayDbTableV2Value(column, presentation.foreignDisplayColumn, value))}">${escapeHtml(displayDbTableV2Value(column, presentation.foreignDisplayColumn, value))}</td>`;
  }
  if (column.foreignKey && presentation.foreignDisplayColumn) {
    return `<td class="${className}">${renderRelationshipSelect(column, value, 'cell', rowId)}</td>`;
  }
  return `<td class="${className}"><input class="db-v2-cell-input" data-db-v2-field="cell" data-column-name="${escapeAttr(column.name)}" data-row-id="${rowId}" value="${escapeAttr(stringifyDbTableV2Value(value))}"></td>`;
}

function renderDraftRow(config: DbTableV2Config, columns: DbTableV2ColumnSchema[]): string {
  return `<tr class="db-v2-draft-row">
    ${columns.map((column) => {
      const presentation = readDbTableV2ColumnConfig(config, column.name, { generated: column.generated });
      if (column.generated) return '<td class="db-v2-generated-value">Auto</td>';
      if (column.foreignKey && presentation.foreignDisplayColumn) {
        return `<td>${renderRelationshipSelect(column, null, 'draft', null)}</td>`;
      }
      const required = isRequiredDraftColumn(column);
      const placeholder = column.defaultValue !== null ? `Default: ${stringifyDbTableV2Value(column.defaultValue)}` : '';
      return `<td><input class="db-v2-cell-input" data-db-v2-draft-control="true" data-column-name="${escapeAttr(column.name)}" data-column-type="${escapeAttr(column.type)}" value="" placeholder="${escapeAttr(placeholder)}" ${required ? 'required' : ''}></td>`;
    }).join('')}
    <td class="db-v2-draft-actions"><button type="button" class="primary" data-db-v2-action="save-row">Save</button><button type="button" class="ghost" data-db-v2-action="cancel-row">Cancel</button></td>
  </tr>`;
}

function renderRelationshipSelect(
  column: DbTableV2ColumnSchema,
  value: DbTableV2Value,
  kind: 'cell' | 'draft',
  rowId: number | null
): string {
  const foreignKey = column.foreignKey!;
  const encodedValue = encodeDbTableV2OptionValue(value);
  const known = foreignKey.options.some((option) => encodeDbTableV2OptionValue(option.value) === encodedValue);
  const options = [
    ...(!column.notNull ? [{ value: 'null:', label: `No ${humanizeDbColumnName(foreignKey.referencedTable)}` }] : []),
    ...(!known && value !== null ? [{ value: encodedValue, label: `Missing reference (${stringifyDbTableV2Value(value)})` }] : []),
    ...foreignKey.options.map((option) => ({ value: encodeDbTableV2OptionValue(option.value), label: option.label })),
  ];
  return renderSelect(
    kind === 'cell' ? 'cell' : '',
    column.name,
    kind === 'draft' && column.notNull ? '' : encodedValue,
    options,
    {
      ...(kind === 'draft' ? { draft: true } : {}),
      ...(rowId !== null ? { rowId } : {}),
      placeholder: kind === 'draft' && column.notNull ? `Choose ${humanizeDbColumnName(foreignKey.referencedTable)}` : '',
      required: kind === 'draft' && column.notNull,
    }
  );
}

function renderSelect(
  field: string,
  columnName: string,
  selected: string,
  options: Array<{ value: string; label: string }>,
  extra: { draft?: boolean; rowId?: number; placeholder?: string; required?: boolean } = {}
): string {
  return `<span class="db-v2-select-shell"><select
    ${field ? `data-db-v2-field="${escapeAttr(field)}"` : ''}
    data-column-name="${escapeAttr(columnName)}"
    ${extra.draft ? `data-db-v2-draft-control="true" data-relationship-value="true"` : ''}
    ${typeof extra.rowId === 'number' ? `data-row-id="${extra.rowId}"` : ''}
    ${extra.required ? 'required' : ''}
  >
    ${extra.placeholder ? `<option value="" ${selected === '' ? 'selected' : ''} disabled>${escapeHtml(extra.placeholder)}</option>` : ''}
    ${options.map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === selected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
  </select>${arrowDownIcon()}</span>`;
}

function renderPager(snapshot: DbTableV2Snapshot): string {
  const first = snapshot.rows.length === 0 ? 0 : snapshot.offset + 1;
  const last = snapshot.offset + snapshot.rows.length;
  return `<div class="db-v2-pager"><span>Rows ${first}–${last}</span><button type="button" class="ghost" data-db-v2-action="previous-page" aria-label="Previous rows" ${snapshot.offset === 0 ? 'disabled' : ''}>${arrowLeftIcon()}</button><button type="button" class="ghost" data-db-v2-action="next-page" aria-label="Next rows" ${snapshot.hasNextPage ? '' : 'disabled'}>${arrowRightIcon()}</button></div>`;
}

async function saveDraftRow(
  root: HTMLElement,
  ctx: HvyPluginContext,
  config: DbTableV2Config,
  snapshot: DbTableV2Snapshot | null,
  ui: DbTableV2UiState
): Promise<void> {
  if (!snapshot) return;
  const values: Array<{ column: DbTableV2ColumnSchema; value: DbTableV2Value }> = [];
  let firstInvalid: HTMLInputElement | HTMLSelectElement | null = null;
  for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-db-v2-draft-control]')) {
    const column = snapshot.columns.find((candidate) => candidate.name === control.dataset.columnName);
    if (!column) continue;
    if (!control.checkValidity()) {
      firstInvalid ??= control;
      continue;
    }
    if (control.value.length === 0) continue;
    const value = control instanceof HTMLSelectElement && control.dataset.relationshipValue === 'true'
      ? decodeDbTableV2OptionValue(control.value)
      : coerceDbTableV2Input(control.value, column.type);
    values.push({ column, value });
  }
  if (firstInvalid) {
    ui.error = 'Complete the required fields before saving this row.';
    showInlineDraftError(root, ui.error);
    firstInvalid.reportValidity();
    firstInvalid.focus({ preventScroll: true });
    return;
  }
  const save = root.querySelector<HTMLButtonElement>('[data-db-v2-action="save-row"]');
  if (save) save.disabled = true;
  try {
    const inserted = await runDbTableV2Mutation(ctx, 'Add database row', snapshot.hasTriggers ? 'checkpoint' : 'logical', () => (
      insertDbTableV2Row(ctx.rawDocument, config.table, values)
    ), (row) => ({
      undo: () => deleteDbTableV2Row(ctx.rawDocument, config.table, row.rowId),
      redo: () => restoreDbTableV2Row(ctx.rawDocument, config.table, row),
    }));
    void inserted;
    ui.draftActive = false;
    ui.error = '';
    refreshDatabasePlugins();
  } catch (error) {
    ui.error = error instanceof Error ? error.message : 'Unable to save the row.';
    if (save) save.disabled = false;
    showInlineDraftError(root, ui.error);
  }
}

function runDbTableV2Mutation<T>(
  ctx: HvyPluginContext,
  label: string,
  mode: 'logical' | 'checkpoint',
  execute: () => T | Promise<T>,
  createLogicalTransition?: (result: T) => DatabaseHistoryLogicalTransition
): Promise<T> {
  return runQueuedDatabaseHistoryCommand({
    label,
    reason: label,
    document: ctx.rawDocument,
    mode,
    recordBefore: () => recordHistory(),
    captureHistoryState: captureHistoryStackState,
    rollbackHistory: restoreHistoryStackState,
    clearDatabaseChangedFlag: clearDatabaseAttachmentChangedForQueuedHistory,
    execute,
    createLogicalTransition,
  }).then((result) => {
    const reason = `db-table-v2:${label}`;
    notifyDocumentMayHaveChanged(reason, inferDocumentChangeSource(reason));
    return result;
  });
}

function cloneDbTableV2Value(value: DbTableV2Value): DbTableV2Value {
  return value instanceof Uint8Array ? Uint8Array.from(value) : value;
}

function showInlineDraftError(root: HTMLElement, message: string): void {
  const existing = root.querySelector<HTMLElement>('.db-v2-inline-error');
  if (existing) {
    existing.textContent = message;
    return;
  }
  const error = document.createElement('div');
  error.className = 'db-v2-inline-error';
  error.setAttribute('role', 'alert');
  error.textContent = message;
  root.querySelector('.db-v2-table-shell')?.before(error);
}

function showOperationError(
  ui: DbTableV2UiState,
  render: () => void,
  error: unknown,
  fallback: string
): void {
  ui.error = error instanceof Error ? error.message : fallback;
  render();
}

function displayDbTableV2Value(
  column: DbTableV2ColumnSchema,
  foreignDisplayColumn: string | undefined,
  value: DbTableV2Value
): string {
  if (column.foreignKey && foreignDisplayColumn) {
    return column.foreignKey.options.find((option) => (
      encodeDbTableV2OptionValue(option.value) === encodeDbTableV2OptionValue(value)
    ))?.label ?? (value === null ? '' : `Missing reference (${stringifyDbTableV2Value(value)})`);
  }
  return stringifyDbTableV2Value(value);
}

function isRequiredDraftColumn(column: DbTableV2ColumnSchema): boolean {
  return column.notNull && column.defaultValue === null && !column.generated;
}

function describeSnapshot(config: DbTableV2Config, snapshot: DbTableV2Snapshot): string {
  const columns = snapshot.columns.filter((column) => (
    readDbTableV2ColumnConfig(config, column.name, { generated: column.generated }).visibility !== 'hidden'
  ));
  const headings = columns.map((column) => readDbTableV2ColumnConfig(config, column.name, { generated: column.generated }).label);
  const rows = snapshot.rows.slice(0, 10).map((row) => columns.map((column) => {
    const presentation = readDbTableV2ColumnConfig(config, column.name, { generated: column.generated });
    return displayDbTableV2Value(column, presentation.foreignDisplayColumn, row.values[column.name] ?? null);
  }).join(' | '));
  return [`DB Table v2: ${config.table}`, `Columns: ${headings.join(' | ') || '(none)'}`, ...rows].join('\n');
}

export async function getDbTableV2RenderedText(document: VisualDocument, block: VisualBlock): Promise<string> {
  const config = readDbTableV2Config(block.schema.pluginConfig);
  if (!config.table) return 'DB Table v2 error: no table selected.';
  try {
    return describeSnapshot(config, await loadDbTableV2Snapshot(document, config, {
      query: block.text,
      offset: 0,
      sortColumn: null,
      sortDirection: null,
    }));
  } catch (error) {
    return `DB Table v2 error: ${error instanceof Error ? error.message : 'Unable to render the table.'}`;
  }
}

function refreshDatabasePlugins(): void {
  refreshMountedPlugins(DB_TABLE_PLUGIN_ID);
  refreshMountedPlugins(FORM_PLUGIN_ID);
}

export const dbTablePlugin: HvyPlugin = {
  ...createBuiltInPluginMetadata(DB_TABLE_PLUGIN_ID, DB_TABLE_PLUGIN_VERSION),
  displayName: 'DB Table',
  documentation: {
    filename: 'about-db-table.txt',
    text: dbTableV2Documentation,
  },
  aiHint: (block) => {
    const table = readDbTableV2Config(block.schema.pluginConfig).table || '(unset)';
    return `Relationship-aware configurable database table/view. Target: "${table}".`;
  },
  aiHelp: 'Use pluginConfig.source and pluginConfig.table for the database target, pluginConfig.queryLimit for rows per page, pluginConfig.columns for presentation and relationship labels, and the plugin body for an optional read-only SELECT.',
  visualDescription: {
    describe: ({ block }) => visualDescriptions.get(block) ?? '',
  },
  create: build,
};
