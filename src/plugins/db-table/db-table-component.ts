import type { HvyPlugin, HvyPluginContext, HvyPluginInstance } from '../types';
import type { VisualBlock } from '../../editor/types';
import type { VisualDocument } from '../../types';
import { createBuiltInPluginMetadata, DB_TABLE_PLUGIN_ID, DB_TABLE_PLUGIN_VERSION, FORM_PLUGIN_ID } from '../registry';
import { refreshMountedPlugins } from '../mount';
import { arrowDownIcon, arrowLeftIcon, arrowRightIcon, arrowUpIcon, closeIcon, plusIcon } from '../../icons';
import { escapeAttr, escapeHtml } from '../../utils';
import {
  humanizeDbColumnName,
  DEFAULT_DB_TABLE_MAX_COLUMN_WIDTH,
  normalizeDbTableMaxColumnWidth,
  readDbTableColumnConfig,
  readDbTableConfig,
  removeDbTableColumnConfig,
  renameDbTableSourceColumnConfig,
  updateDbTableColumnConfig,
  type DbTableColumnConfig,
  type DbTableConfig,
} from './db-table-config';
import {
  coerceDbTableInput,
  decodeDbTableOptionValue,
  encodeDbTableOptionValue,
  getDbTableWriter,
  loadDbTableSourcePage,
  stringifyDbTableValue,
  type DbTableColumnSchema,
  type DbTableSourcePage,
  type DbTableValue,
} from './db-table-data';
import { getDatabaseTableSources, type HvyDatabaseTableWriter } from '../database-table-source';
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
import dbTableDocumentation from './about-db-table.txt?raw';
import { inferDocumentChangeSource, notifyDocumentMayHaveChanged } from '../../document-change';
import { clampTableColumnWidth, measureTableColumnTextSamples, type TableColumnTextSample } from '../../table-column-sizing';

import './db-table-component.css';

interface DbTableUiState {
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
  const ui: DbTableUiState = {
    offset: 0,
    sortColumn: null,
    sortDirection: null,
    settingsOpen: false,
    draftActive: false,
    error: '',
    queuePending: getDatabaseHistoryQueueStatus().pending,
    queueLabel: getDatabaseHistoryQueueStatus().runningLabel,
  };
  let snapshot: DbTableSourcePage | null = null;
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
    editor.className = 'db-table-column-editor-popover';
    editor.dataset.columnName = columnName;
    editor.innerHTML = `<strong>Edit column header</strong><div class="db-table-column-editor-modes" role="group" aria-label="Column name type"><button type="button" class="ghost${mode === 'display' ? ' is-active' : ''}" data-db-table-column-edit-mode="display">Display</button><button type="button" class="ghost${mode === 'database' ? ' is-active' : ''}" data-db-table-column-edit-mode="database">DB Column</button></div><span>${mode === 'display' ? `Shown to readers · database: ${escapeHtml(columnName)}` : `Stored in the database · display: ${escapeHtml(input.dataset.displayName ?? '')}`}</span>`;
    root.append(editor);
    const rootBox = root.getBoundingClientRect();
    const inputBox = input.getBoundingClientRect();
    const editorBox = editor.getBoundingClientRect();
    editor.style.left = `${Math.max(0, Math.min(inputBox.left - rootBox.left, rootBox.width - editorBox.width))}px`;
    editor.style.top = `${inputBox.bottom - rootBox.top + 6}px`;
    columnEditor = editor;
  };

  const config = (): DbTableConfig => readDbTableConfig(ctx.block.schema.pluginConfig);

  const renderCurrent = () => {
    closeColumnEditor();
    root.innerHTML = renderDbTable(ctx, config(), snapshot, ui);
  };

  const refresh = () => {
    const version = ++refreshVersion;
    const activeConfig = config();
    if (!activeConfig.table) {
      snapshot = null;
      visualDescriptions.set(ctx.block, 'DB Table: no table selected.');
      renderCurrent();
      return;
    }
    root.classList.add('db-table-loading');
    void loadDbTableSourcePage(ctx.rawDocument, activeConfig, {
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
      ui.error = error instanceof Error ? error.message : 'Unable to load DB Table.';
      visualDescriptions.set(ctx.block, `DB Table error: ${ui.error}`);
      renderCurrent();
    }).finally(() => {
      if (!disposed && version === refreshVersion) root.classList.remove('db-table-loading');
    });
  };

  root.addEventListener('click', (event) => {
    const editMode = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-db-table-column-edit-mode]');
    if (editMode && snapshot) {
      const columnName = editMode.closest<HTMLElement>('.db-table-column-editor-popover')?.dataset.columnName ?? '';
      const column = snapshot.columns.find((candidate) => candidate.name === columnName);
      const input = root.querySelector<HTMLInputElement>(`.db-table-column-name-input[data-column-name="${CSS.escape(columnName)}"]`);
      if (!column || !input) return;
      const mode = editMode.dataset.dbTableColumnEditMode === 'database' ? 'database' : 'display';
      const presentation = readDbTableColumnConfig(config(), columnName, { generated: column.generated });
      input.dataset.columnEditMode = mode;
      input.dataset.dbTableField = mode === 'database' ? 'schema-column-name' : 'column-label';
      input.value = mode === 'database' ? columnName : presentation.label;
      input.setAttribute('aria-label', mode === 'database' ? `Database name for ${columnName}` : `Display name for ${columnName}`);
      input.focus({ preventScroll: true });
      input.select();
      openColumnEditor(input);
      return;
    }
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-db-table-action]');
    if (!button) return;
    const action = button.dataset.dbTableAction ?? '';
    if (action === 'toggle-columns') {
      ui.settingsOpen = !ui.settingsOpen;
      renderCurrent();
      return;
    }
    if (action === 'add-row') {
      ui.draftActive = true;
      ui.error = '';
      renderCurrent();
      root.querySelector<HTMLElement>('[data-db-table-draft-control]:not([disabled])')?.focus({ preventScroll: true });
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
      void runDbTableMutation(ctx, 'Create database table', irreversibleUndoMode(config()), () => (
        requireWriter(config()).createTable({ document: ctx.rawDocument, table: config().table })
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
      void runDbTableMutation(ctx, 'Add database column', 'logical', () => (
        requireWriter(config()).addColumn({ document: ctx.rawDocument, table: tableName })
      ), (columnName) => ({
        undo: () => requireWriter(config()).dropColumn({ document: ctx.rawDocument, table: tableName }, columnName),
        redo: () => requireWriter(config()).addNamedColumn({ document: ctx.rawDocument, table: tableName }, columnName),
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
        void runDbTableMutation(ctx, 'Delete database column', irreversibleUndoMode(config()), async () => {
          await requireWriter(config()).dropColumn({ document: ctx.rawDocument, table: tableName }, columnName);
            ctx.setConfig(removeDbTableColumnConfig(config(), columnName));
        }).then(() => refreshDatabasePlugins())
          .catch((error) => showOperationError(ui, renderCurrent, error, 'Unable to delete the column.'));
      }, ctx.hostRoot);
      return;
    }
    if (action === 'delete-row') {
      const rowId = Number(button.dataset.rowId);
      if (!Number.isFinite(rowId)) return;
      openRemoveConfirmationModal(() => {
        void runDbTableMutation(ctx, 'Delete database row', irreversibleUndoMode(config()), () => (
          requireWriter(config()).deleteRow({ document: ctx.rawDocument, table: config().table }, rowId)
        ))
          .then(() => refreshDatabasePlugins())
          .catch((error) => showOperationError(ui, renderCurrent, error, 'Unable to delete the row.'));
      }, ctx.hostRoot);
    }
  });

  root.addEventListener('focusin', (event) => {
    const input = (event.target as Element | null)?.closest<HTMLInputElement>('.db-table-column-name-input');
    if (input) openColumnEditor(input);
  });

  root.addEventListener('focusout', () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active && (active.closest('.db-table-column-editor-popover') || active.classList.contains('db-table-column-name-input'))) return;
      closeColumnEditor();
    }, 0);
  });

  root.addEventListener('keydown', (event) => {
    const input = (event.target as Element | null)?.closest<HTMLInputElement>('.db-table-column-name-input');
    if (!input) return;
    if (event.key === 'Enter') input.blur();
  });

  root.addEventListener('pointerdown', (event) => {
    if ((event.target as Element | null)?.closest('[data-db-table-column-edit-mode]')) {
      event.preventDefault();
      return;
    }
    const handle = (event.target as Element | null)?.closest<HTMLElement>('.db-table-resize-handle');
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
    const maximumWidth = resolveDbTableMaximumColumnWidth(root, ctx.header.get('database_table_max_column_width'));
    let nextWidth = startWidth;
    let moved = false;
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const delta = moveEvent.clientX - startX;
      if (Math.abs(delta) > 1) moved = true;
      nextWidth = clampTableColumnWidth(startWidth + delta, 64, maximumWidth);
      column.style.width = `${nextWidth}px`;
    };
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      stopColumnResize();
      if (moved) ctx.setConfig(updateDbTableColumnConfig(config(), columnName, { width: `${Math.round(nextWidth)}px` }));
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
    const handle = (event.target as Element | null)?.closest<HTMLElement>('.db-table-resize-handle');
    if (!handle || ctx.mode !== 'editor') return;
    event.preventDefault();
    event.stopPropagation();
    const columnName = handle.dataset.columnName ?? '';
    const width = measureDbTableColumnContent(root, columnName, ctx.header.get('database_table_max_column_width'));
    if (width !== null) ctx.setConfig(updateDbTableColumnConfig(config(), columnName, { width: `${width}px` }));
  });

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    const field = target.dataset.dbTableField ?? '';
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
      void runDbTableMutation(ctx, 'Rename database column', 'logical', async () => {
        const renamed = await requireWriter(config()).renameColumn({ document: ctx.rawDocument, table: tableName }, oldColumnName, nextColumnName);
        ctx.setConfig(renameDbTableSourceColumnConfig(config(), oldColumnName, renamed));
        return renamed;
      }, (renamed) => ({
        undo: async () => { await requireWriter(config()).renameColumn({ document: ctx.rawDocument, table: tableName }, renamed, oldColumnName); },
        redo: async () => { await requireWriter(config()).renameColumn({ document: ctx.rawDocument, table: tableName }, oldColumnName, renamed); },
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
        ? decodeDbTableOptionValue(target.value)
        : coerceDbTableInput(target.value, column.type);
      target.disabled = true;
      const tableName = config().table;
      const previousValue = cloneDbTableValue(snapshot.rows.find((row) => row.rowId === rowId)?.values[column.name] ?? null);
      void runDbTableMutation(ctx, 'Edit database cell', snapshot.hasTriggers ? irreversibleUndoMode(config()) : 'logical', () => (
        requireWriter(config()).updateCell({ document: ctx.rawDocument, table: tableName }, rowId, column, value)
      ), () => ({
        undo: () => requireWriter(config()).updateCell({ document: ctx.rawDocument, table: tableName }, rowId, column, previousValue),
        redo: () => requireWriter(config()).updateCell({ document: ctx.rawDocument, table: tableName }, rowId, column, value),
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
      let patch: DbTableColumnConfig = {};
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
      ctx.setConfig(updateDbTableColumnConfig(config(), columnName, patch));
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

function renderDbTable(
  ctx: HvyPluginContext,
  config: DbTableConfig,
  snapshot: DbTableSourcePage | null,
  ui: DbTableUiState
): string {
  const toolbar = ctx.mode === 'editor' ? renderEditorToolbar(ctx, config, snapshot, ui) : '';
  if (!config.table) {
    return `${toolbar}<div class="db-table-placeholder">Choose a table or view to display.</div>`;
  }
  if (!snapshot) {
    const missing = /does not exist/u.test(ui.error);
    return `${toolbar}<div class="db-table-placeholder db-table-error">
      <span>${escapeHtml(ui.error || 'Loading table…')}</span>
      ${missing && ctx.mode === 'editor' && config.source === 'with-file'
        ? `<button type="button" class="secondary" data-db-table-action="create-basic-table">Create Basic Table</button>`
        : ''}
    </div>`;
  }
  const settings = ctx.mode === 'editor' && ui.settingsOpen ? renderColumnSettings(config, snapshot) : '';
  const status = ui.error ? `<div class="db-table-inline-error" role="alert">${escapeHtml(ui.error)}</div>` : '';
  const queue = ui.queuePending > 0
    ? `<div class="db-table-queue-status" role="status"><span class="db-table-queue-pulse"></span>${escapeHtml(ui.queueLabel || 'Database edit queued')}${ui.queuePending > 1 ? ` · ${ui.queuePending - 1} waiting` : ''}</div>`
    : '';
  return `${toolbar}${settings}${queue}${status}${renderTable(ctx, config, snapshot, ui)}`;
}

function renderEditorToolbar(
  ctx: HvyPluginContext,
  config: DbTableConfig,
  snapshot: DbTableSourcePage | null,
  ui: DbTableUiState
): string {
  const sources = getDatabaseTableSources();
  const sourceOptions = sources.some((source) => source.id === config.source)
    ? sources
    : [{ id: config.source, label: config.source }, ...sources];
  return `<div class="db-table-toolbar">
    ${sourceOptions.length > 1 ? `<label class="db-table-field db-table-source-field"><span>Source</span><span class="db-table-select-shell"><select data-db-table-field="source">${sourceOptions.map((source) => `<option value="${escapeAttr(source.id)}" ${source.id === config.source ? 'selected' : ''}>${escapeHtml(source.label || source.id)}</option>`).join('')}</select>${arrowDownIcon()}</span></label>` : ''}
    <label class="db-table-field db-table-table-field"><span>Table or view</span><input data-db-table-field="table" value="${escapeAttr(config.table)}" placeholder="table_name"></label>
    <button type="button" class="secondary db-table-columns-button${ui.settingsOpen ? ' is-active' : ''}" data-db-table-action="toggle-columns" ${snapshot ? '' : 'disabled'}>Columns</button>
    <details class="db-table-query" ${ctx.block.text.trim() ? 'open' : ''}>
      <summary>Query</summary>
      <label class="db-table-field"><span>Optional read-only SELECT</span><textarea data-db-table-field="query" rows="4" placeholder="SELECT * FROM ${escapeAttr(config.table || 'table_name')}">${escapeHtml(ctx.block.text)}</textarea></label>
      <div class="db-table-query-options">
        <label class="db-table-field db-table-query-limit"><span>Rows per page</span><input type="number" min="1" max="1000" data-db-table-field="query-limit" value="${config.queryLimit}"></label>
      </div>
    </details>
  </div>`;
}

function renderColumnSettings(config: DbTableConfig, snapshot: DbTableSourcePage): string {
  return `<section class="db-table-column-settings" aria-label="Column settings">
    <div class="db-table-settings-heading"><div><strong>Column management</strong><span>Database column changes affect the table. Presentation settings affect only this component.</span></div><button type="button" class="ghost db-table-settings-close" data-db-table-action="toggle-columns" aria-label="Close column settings">${closeIcon()}</button></div>
    <div class="db-table-settings-list">
      ${snapshot.columns.map((column) => {
        const presentation = readDbTableColumnConfig(config, column.name, { generated: column.generated });
        const required = isRequiredDraftColumn(column);
        return `<div class="db-table-column-card">
          <div class="db-table-column-identity"><strong>${escapeHtml(column.name)}</strong><span>${escapeHtml(column.type || 'untyped')}${column.generated ? ' · generated key' : ''}${column.foreignKey ? ` · references ${escapeHtml(column.foreignKey.referencedTable)}` : ''}</span></div>
          <label class="db-table-field"><span>Database column</span><input data-db-table-field="schema-column-name" data-column-name="${escapeAttr(column.name)}" value="${escapeAttr(column.name)}" ${snapshot.editable ? '' : 'disabled'}></label>
          <label class="db-table-field"><span>Heading</span><input data-db-table-field="column-label" data-column-name="${escapeAttr(column.name)}" value="${escapeAttr(presentation.label)}"></label>
          <label class="db-table-field"><span>Visibility</span>${renderSelect(
            'column-visibility',
            column.name,
            presentation.visibility,
            [
              { value: 'visible', label: 'Visible' },
              { value: 'compact', label: 'Compact' },
              ...(!required ? [{ value: 'hidden', label: 'Hidden' }] : []),
            ]
          )}</label>
          <label class="db-table-field"><span>Width</span><input data-db-table-field="column-width" data-column-name="${escapeAttr(column.name)}" value="${escapeAttr(presentation.width)}" placeholder="12rem"></label>
          <label class="db-table-check"><input type="checkbox" data-db-table-field="column-wrap" data-column-name="${escapeAttr(column.name)}" ${presentation.wrap ? 'checked' : ''}><span>Wrap values</span></label>
          ${column.foreignKey ? `<label class="db-table-field db-table-relationship-setting"><span>Display ${escapeHtml(column.foreignKey.referencedTable)} by</span>${renderSelect(
            'column-foreign-display',
            column.name,
            presentation.foreignDisplayColumn ?? '',
            [
              { value: '', label: 'Raw stored value' },
              ...column.foreignKey.displayColumnOptions.map((name) => ({ value: name, label: humanizeDbColumnName(name) })),
            ]
          )}</label>` : ''}
          <button type="button" class="ghost db-table-delete-column" data-db-table-action="delete-column" data-column-name="${escapeAttr(column.name)}" aria-label="Delete database column ${escapeAttr(column.name)}" ${!snapshot.editable || snapshot.columns.length <= 1 ? 'disabled' : ''}>${closeIcon()}<span>Delete column</span></button>
        </div>`;
      }).join('')}
    </div>
    <button type="button" class="secondary db-table-add-column" data-db-table-action="add-column" ${snapshot.editable ? '' : 'disabled'}>${plusIcon()} Column</button>
  </section>`;
}

function renderTable(ctx: HvyPluginContext, config: DbTableConfig, snapshot: DbTableSourcePage, ui: DbTableUiState): string {
  const visibleColumns = snapshot.columns.filter((column) => (
    readDbTableColumnConfig(config, column.name, { generated: column.generated }).visibility !== 'hidden'
  ));
  const hiddenRequired = snapshot.columns.filter((column) => (
    readDbTableColumnConfig(config, column.name, { generated: column.generated }).visibility === 'hidden'
    && isRequiredDraftColumn(column)
  ));
  const editable = ctx.mode === 'editor' && snapshot.editable;
  const showRowActions = editable || snapshot.rows.some((row) => row.hasAttachedComponent);
  return `<div class="db-table-table-shell">
    <div class="db-table-table-heading">
      <div><strong>${escapeHtml(config.table)}</strong><span>${snapshot.queryActive ? 'Query result · read-only' : snapshot.objectType === 'view' ? 'Database view · read-only' : snapshot.editable ? 'Database table · editable' : 'Database table · read-only'}</span></div>
      ${snapshot.offset > 0 || snapshot.hasNextPage ? renderPager(snapshot) : ''}
    </div>
    <div class="db-table-table-frame">
      <table class="db-table-table${editable ? ' is-editable' : ''}">
        <colgroup>${visibleColumns.map((column) => renderColumnElement(config, column)).join('')}${showRowActions ? '<col class="db-table-actions-column">' : ''}</colgroup>
        <thead><tr>${visibleColumns.map((column) => renderHeader(config, column, snapshot, ui)).join('')}${showRowActions ? '<th class="db-table-actions-heading"><span class="db-table-screen-reader">Actions</span></th>' : ''}</tr></thead>
        <tbody>
          ${snapshot.rows.map((row) => `<tr class="${row.hasAttachedComponent ? 'has-attached-component' : ''}">${visibleColumns.map((column) => renderCell(config, column, row.values[column.name] ?? null, row.rowId, editable)).join('')}${showRowActions ? renderRowActions(ctx, config, row.rowId, row.hasAttachedComponent, editable) : ''}</tr>`).join('')}
          ${ui.draftActive && editable ? renderDraftRow(config, visibleColumns) : ''}
          ${snapshot.rows.length === 0 && !ui.draftActive ? `<tr><td class="db-table-empty" colspan="${Math.max(visibleColumns.length + (editable ? 1 : 0), 1)}">No rows yet.</td></tr>` : ''}
        </tbody>
      </table>
    </div>
    ${editable ? `<div class="db-table-table-actions">
      <button type="button" class="secondary db-table-add-row" data-db-table-action="add-row" ${ui.draftActive || hiddenRequired.length > 0 ? 'disabled' : ''}>${plusIcon()} Row</button>
      ${hiddenRequired.length > 0 ? `<span class="db-table-action-note">Show required column${hiddenRequired.length === 1 ? '' : 's'} ${hiddenRequired.map((column) => escapeHtml(column.name)).join(', ')} before adding rows.</span>` : ''}
    </div>` : ''}
  </div>`;
}

function renderRowActions(
  ctx: HvyPluginContext,
  config: DbTableConfig,
  rowId: number | null,
  hasAttachedComponent: boolean,
  editable: boolean
): string {
  if (rowId === null) return '<td class="db-table-row-actions"></td>';
  const attachmentAction = editable ? 'db-table-open-row-component-editor' : 'db-table-open-row-component-view';
  return `<td class="db-table-row-actions">
    <div class="db-table-row-action-group">
      ${editable || hasAttachedComponent ? `<button type="button" class="ghost db-table-row-component ${hasAttachedComponent ? 'is-attached' : ''}" data-action="${attachmentAction}" data-section-key="${escapeAttr(ctx.sectionKey)}" data-block-id="${escapeAttr(ctx.block.id)}" data-table-name="${escapeAttr(config.table)}" data-rowid="${rowId}">${hasAttachedComponent ? (editable ? 'Edit details' : 'View details') : 'Add details'}</button>` : ''}
      ${editable ? `<button type="button" class="ghost db-table-delete-row" data-db-table-action="delete-row" data-row-id="${rowId}" aria-label="Delete row">${closeIcon()}</button>` : ''}
    </div>
  </td>`;
}

function renderColumnElement(config: DbTableConfig, column: DbTableColumnSchema): string {
  const presentation = readDbTableColumnConfig(config, column.name, { generated: column.generated });
  return `<col data-column-name="${escapeAttr(column.name)}" style="width:${escapeAttr(presentation.width)}">`;
}

function renderHeader(
  config: DbTableConfig,
  column: DbTableColumnSchema,
  snapshot: DbTableSourcePage,
  ui: DbTableUiState
): string {
  const presentation = readDbTableColumnConfig(config, column.name, { generated: column.generated });
  const sortIcon = ui.sortColumn === column.name && ui.sortDirection === 'desc' ? arrowDownIcon() : arrowUpIcon();
  const heading = snapshot.editable
    ? `<input class="db-table-column-name-input" data-db-table-field="column-label" data-column-edit-mode="display" data-column-name="${escapeAttr(column.name)}" data-display-name="${escapeAttr(presentation.label)}" value="${escapeAttr(presentation.label)}" aria-label="Display name for ${escapeAttr(column.name)}" title="Edit display or DB column name">`
    : `<span>${escapeHtml(presentation.label)}</span>`;
  return `<th class="${presentation.wrap ? 'is-wrapped' : ''}" title="${escapeAttr(presentation.label)}"><div class="db-table-header-content">${heading}${snapshot.editable ? `<button type="button" class="ghost db-table-sort" data-db-table-action="sort" data-column-name="${escapeAttr(column.name)}" aria-label="Sort by ${escapeAttr(presentation.label)}">${sortIcon}</button><span class="db-table-resize-handle" data-column-name="${escapeAttr(column.name)}" title="Drag to resize; double-click to fit data" aria-hidden="true"></span>` : ''}</div></th>`;
}

function resolveDbTableMaximumColumnWidth(root: HTMLElement, configured: unknown): number {
  const width = normalizeDbTableMaxColumnWidth(configured) || DEFAULT_DB_TABLE_MAX_COLUMN_WIDTH;
  const probe = document.createElement('span');
  probe.className = 'db-table-width-probe';
  probe.style.width = width;
  root.append(probe);
  const pixels = probe.getBoundingClientRect().width;
  probe.remove();
  return Number.isFinite(pixels) && pixels > 0 ? pixels : 640;
}

function measureDbTableColumnContent(root: HTMLElement, columnName: string, configuredMaximum: unknown): number | null {
  const column = root.querySelector<HTMLTableColElement>(`col[data-column-name="${CSS.escape(columnName)}"]`);
  const columns = [...root.querySelectorAll<HTMLTableColElement>('.db-table-table col')];
  const columnIndex = column ? columns.indexOf(column) : -1;
  if (!column || columnIndex < 0) return null;
  const table = column.closest('table');
  const header = table?.querySelectorAll<HTMLTableCellElement>('thead th')[columnIndex];
  if (!table || !header) return null;
  const samples: TableColumnTextSample[] = [];
  const headerLabel = header.querySelector<HTMLElement>('.db-table-column-name-input, .db-table-header-content > span:first-child');
  const headerText = headerLabel instanceof HTMLInputElement ? headerLabel.value : headerLabel?.textContent ?? '';
  if (headerLabel) samples.push({ source: headerLabel, text: headerText, padding: 52 });
  for (const row of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
    const cell = row.cells[columnIndex];
    if (!cell) continue;
    const control = cell.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
    const text = control instanceof HTMLSelectElement
      ? control.selectedOptions[0]?.textContent ?? ''
      : control instanceof HTMLInputElement
        ? control.value
        : cell.textContent ?? '';
    samples.push({ source: control ?? cell, text, padding: 20 });
  }
  return measureTableColumnTextSamples(root, samples, {
    maximum: resolveDbTableMaximumColumnWidth(root, configuredMaximum),
  });
}

function renderCell(
  config: DbTableConfig,
  column: DbTableColumnSchema,
  value: DbTableValue,
  rowId: number | null,
  editable: boolean
): string {
  const presentation = readDbTableColumnConfig(config, column.name, { generated: column.generated });
  const className = presentation.wrap ? 'is-wrapped' : '';
  if (!editable || column.generated || rowId === null) {
    return `<td class="${className}" title="${escapeAttr(displayDbTableValue(column, presentation.foreignDisplayColumn, value))}">${escapeHtml(displayDbTableValue(column, presentation.foreignDisplayColumn, value))}</td>`;
  }
  if (column.foreignKey && presentation.foreignDisplayColumn) {
    return `<td class="${className}">${renderRelationshipSelect(column, value, 'cell', rowId)}</td>`;
  }
  return `<td class="${className}"><input class="db-table-cell-input" data-db-table-field="cell" data-column-name="${escapeAttr(column.name)}" data-row-id="${rowId}" value="${escapeAttr(stringifyDbTableValue(value))}"></td>`;
}

function renderDraftRow(config: DbTableConfig, columns: DbTableColumnSchema[]): string {
  return `<tr class="db-table-draft-row">
    ${columns.map((column) => {
      const presentation = readDbTableColumnConfig(config, column.name, { generated: column.generated });
      if (column.generated) return '<td class="db-table-generated-value">Auto</td>';
      if (column.foreignKey && presentation.foreignDisplayColumn) {
        return `<td>${renderRelationshipSelect(column, null, 'draft', null)}</td>`;
      }
      const required = isRequiredDraftColumn(column);
      const placeholder = column.defaultValue !== null ? `Default: ${stringifyDbTableValue(column.defaultValue)}` : '';
      return `<td><input class="db-table-cell-input" data-db-table-draft-control="true" data-column-name="${escapeAttr(column.name)}" data-column-type="${escapeAttr(column.type)}" value="" placeholder="${escapeAttr(placeholder)}" ${required ? 'required' : ''}></td>`;
    }).join('')}
    <td class="db-table-draft-actions"><button type="button" class="primary" data-db-table-action="save-row">Save</button><button type="button" class="ghost" data-db-table-action="cancel-row">Cancel</button></td>
  </tr>`;
}

function renderRelationshipSelect(
  column: DbTableColumnSchema,
  value: DbTableValue,
  kind: 'cell' | 'draft',
  rowId: number | null
): string {
  const foreignKey = column.foreignKey!;
  const encodedValue = encodeDbTableOptionValue(value);
  const known = foreignKey.options.some((option) => encodeDbTableOptionValue(option.value) === encodedValue);
  const options = [
    ...(!column.notNull ? [{ value: 'null:', label: `No ${humanizeDbColumnName(foreignKey.referencedTable)}` }] : []),
    ...(!known && value !== null ? [{ value: encodedValue, label: `Missing reference (${stringifyDbTableValue(value)})` }] : []),
    ...foreignKey.options.map((option) => ({ value: encodeDbTableOptionValue(option.value), label: option.label })),
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
  return `<span class="db-table-select-shell"><select
    ${field ? `data-db-table-field="${escapeAttr(field)}"` : ''}
    data-column-name="${escapeAttr(columnName)}"
    ${extra.draft ? `data-db-table-draft-control="true" data-relationship-value="true"` : ''}
    ${typeof extra.rowId === 'number' ? `data-row-id="${extra.rowId}"` : ''}
    ${extra.required ? 'required' : ''}
  >
    ${extra.placeholder ? `<option value="" ${selected === '' ? 'selected' : ''} disabled>${escapeHtml(extra.placeholder)}</option>` : ''}
    ${options.map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === selected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
  </select>${arrowDownIcon()}</span>`;
}

function renderPager(snapshot: DbTableSourcePage): string {
  const first = snapshot.rows.length === 0 ? 0 : snapshot.offset + 1;
  const last = snapshot.offset + snapshot.rows.length;
  return `<div class="db-table-pager"><span>Rows ${first}–${last}</span><button type="button" class="ghost db-table-page-button" data-db-table-action="previous-page" aria-label="Previous rows" ${snapshot.offset === 0 ? 'disabled' : ''}>${arrowLeftIcon()}</button><button type="button" class="ghost db-table-page-button" data-db-table-action="next-page" aria-label="Next rows" ${snapshot.hasNextPage ? '' : 'disabled'}>${arrowRightIcon()}</button></div>`;
}

async function saveDraftRow(
  root: HTMLElement,
  ctx: HvyPluginContext,
  config: DbTableConfig,
  snapshot: DbTableSourcePage | null,
  ui: DbTableUiState
): Promise<void> {
  if (!snapshot) return;
  const values: Array<{ column: DbTableColumnSchema; value: DbTableValue }> = [];
  let firstInvalid: HTMLInputElement | HTMLSelectElement | null = null;
  for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-db-table-draft-control]')) {
    const column = snapshot.columns.find((candidate) => candidate.name === control.dataset.columnName);
    if (!column) continue;
    if (!control.checkValidity()) {
      firstInvalid ??= control;
      continue;
    }
    if (control.value.length === 0) continue;
    const value = control instanceof HTMLSelectElement && control.dataset.relationshipValue === 'true'
      ? decodeDbTableOptionValue(control.value)
      : coerceDbTableInput(control.value, column.type);
    values.push({ column, value });
  }
  if (firstInvalid) {
    ui.error = 'Complete the required fields before saving this row.';
    showInlineDraftError(root, ui.error);
    firstInvalid.reportValidity();
    firstInvalid.focus({ preventScroll: true });
    return;
  }
  const save = root.querySelector<HTMLButtonElement>('[data-db-table-action="save-row"]');
  if (save) save.disabled = true;
  try {
    const inserted = await runDbTableMutation(ctx, 'Add database row', snapshot.hasTriggers ? irreversibleUndoMode(config) : 'logical', () => (
      requireWriter(config).insertRow({ document: ctx.rawDocument, table: config.table }, values)
    ), (row) => ({
      undo: () => requireWriter(config).deleteRow({ document: ctx.rawDocument, table: config.table }, row.rowId),
      redo: () => requireWriter(config).restoreRow({ document: ctx.rawDocument, table: config.table }, row),
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

/**
 * Undo mode for an operation that has no inverse to replay. Only a source that can
 * snapshot its whole state can reverse these, so a logical-only source gets no undo
 * rather than a checkpoint that would silently do nothing.
 */
function irreversibleUndoMode(config: DbTableConfig): 'logical' | 'checkpoint' {
  return getDbTableWriter(config)?.undo === 'checkpoint' ? 'checkpoint' : 'logical';
}

/** Editing affordances are only rendered for writable sources, so this should never throw. */
function requireWriter(config: DbTableConfig): HvyDatabaseTableWriter {
  const writer = getDbTableWriter(config);
  if (!writer) throw new Error(`DB Table source "${config.source}" is read-only.`);
  return writer;
}

function runDbTableMutation<T>(
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
    const reason = `db-table:${label}`;
    notifyDocumentMayHaveChanged(reason, inferDocumentChangeSource(reason));
    return result;
  });
}

function cloneDbTableValue(value: DbTableValue): DbTableValue {
  return value instanceof Uint8Array ? Uint8Array.from(value) : value;
}

function showInlineDraftError(root: HTMLElement, message: string): void {
  const existing = root.querySelector<HTMLElement>('.db-table-inline-error');
  if (existing) {
    existing.textContent = message;
    return;
  }
  const error = document.createElement('div');
  error.className = 'db-table-inline-error';
  error.setAttribute('role', 'alert');
  error.textContent = message;
  root.querySelector('.db-table-table-shell')?.before(error);
}

function showOperationError(
  ui: DbTableUiState,
  render: () => void,
  error: unknown,
  fallback: string
): void {
  ui.error = error instanceof Error ? error.message : fallback;
  render();
}

function displayDbTableValue(
  column: DbTableColumnSchema,
  foreignDisplayColumn: string | undefined,
  value: DbTableValue
): string {
  if (column.foreignKey && foreignDisplayColumn) {
    return column.foreignKey.options.find((option) => (
      encodeDbTableOptionValue(option.value) === encodeDbTableOptionValue(value)
    ))?.label ?? (value === null ? '' : `Missing reference (${stringifyDbTableValue(value)})`);
  }
  return stringifyDbTableValue(value);
}

function isRequiredDraftColumn(column: DbTableColumnSchema): boolean {
  return column.notNull && column.defaultValue === null && !column.generated;
}

function describeSnapshot(config: DbTableConfig, snapshot: DbTableSourcePage): string {
  const columns = snapshot.columns.filter((column) => (
    readDbTableColumnConfig(config, column.name, { generated: column.generated }).visibility !== 'hidden'
  ));
  const headings = columns.map((column) => readDbTableColumnConfig(config, column.name, { generated: column.generated }).label);
  const rows = snapshot.rows.slice(0, 10).map((row) => columns.map((column) => {
    const presentation = readDbTableColumnConfig(config, column.name, { generated: column.generated });
    return displayDbTableValue(column, presentation.foreignDisplayColumn, row.values[column.name] ?? null);
  }).join(' | '));
  return [`DB Table: ${config.table}`, `Columns: ${headings.join(' | ') || '(none)'}`, ...rows].join('\n');
}

export async function getDbTableComponentRenderedText(document: VisualDocument, block: VisualBlock): Promise<string> {
  const config = readDbTableConfig(block.schema.pluginConfig);
  if (!config.table) return 'DB Table error: no table selected.';
  try {
    return describeSnapshot(config, await loadDbTableSourcePage(document, config, {
      query: block.text,
      offset: 0,
      sortColumn: null,
      sortDirection: null,
    }));
  } catch (error) {
    return `DB Table error: ${error instanceof Error ? error.message : 'Unable to render the table.'}`;
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
    text: dbTableDocumentation,
  },
  aiHint: (block) => {
    const table = readDbTableConfig(block.schema.pluginConfig).table || '(unset)';
    return `Relationship-aware configurable database table/view. Target: "${table}".`;
  },
  aiHelp: 'Use pluginConfig.source and pluginConfig.table for the database target, pluginConfig.queryLimit for rows per page, pluginConfig.columns for presentation and relationship labels, and the plugin body for an optional read-only SELECT.',
  visualDescription: {
    describe: ({ block }) => visualDescriptions.get(block) ?? '',
  },
  create: build,
};
