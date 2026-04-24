import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

import type { ComponentRenderHelpers } from '../editor/component-helpers';
import type { VisualBlock, VisualSection } from '../editor/types';
import { deserializeDocumentWithDiagnostics, wrapHvyFragmentAsDocument } from '../serialization';
import { visitBlocks } from '../section-ops';
import { getRenderApp, state } from '../state';
import type { DocumentTailAttachment, VisualDocument } from '../types';
import { DB_TABLE_PLUGIN_ID } from './registry';

import './db-table.css';

const SQLITE_ROW_COMPONENTS_TABLE = '__hvy_row_components';

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;
type SqlJsDatabase = InstanceType<SqlJsStatic['Database']>;

interface SqliteTableSnapshot {
  columns: string[];
  rowIds: number[];
  rows: string[][];
  rowHasAttachedComponent: boolean[];
  totalRows: number;
  offset: number;
  queryActive: boolean;
  dynamicWindow: boolean;
  queryLimit: number;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
}

interface SqliteRuntime {
  documentRef: VisualDocument | null;
  db: SqlJsDatabase | null;
  loading: boolean;
  loadError: string | null;
  loadPromise: Promise<void> | null;
  persistPromise: Promise<void> | null;
}

const runtime: SqliteRuntime = {
  documentRef: null,
  db: null,
  loading: false,
  loadError: null,
  loadPromise: null,
  persistPromise: null,
};

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
const DB_TABLE_WINDOW_SIZE = 50;
const DB_TABLE_MAX_QUERY_ROWS = 99;
const DB_TABLE_DEFAULT_STATIC_QUERY_LIMIT = 50;
const DB_TABLE_FORWARD_SCROLL_TRIGGER = 75;
const DB_TABLE_BACKWARD_SCROLL_TRIGGER = 25;
const DB_TABLE_ESTIMATED_ROW_HEIGHT = 40;

interface DbTableViewState {
  offset: number;
  scrollTop: number;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
}

const dbTableViewState = new Map<string, DbTableViewState>();

function getDbTableViewKey(sectionKey: string, blockId: string): string {
  return `${sectionKey}:${blockId}`;
}

function getDbTableViewState(sectionKey: string, blockId: string): DbTableViewState {
  const key = getDbTableViewKey(sectionKey, blockId);
  const existing = dbTableViewState.get(key);
  if (existing) {
    return existing;
  }
  const created: DbTableViewState = {
    offset: 0,
    scrollTop: 0,
    sortColumn: null,
    sortDirection: null,
  };
  dbTableViewState.set(key, created);
  return created;
}

function getPluginConfigValue(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

export function getDbTableQueryDynamicWindow(config: Record<string, unknown>): boolean {
  return typeof config.queryDynamicWindow === 'boolean' ? config.queryDynamicWindow : true;
}

export function getDbTableQueryLimit(config: Record<string, unknown>): number {
  const rawValue = config.queryLimit;
  const parsed = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string'
      ? Number.parseInt(rawValue, 10)
      : NaN;
  if (!Number.isFinite(parsed)) {
    return DB_TABLE_DEFAULT_STATIC_QUERY_LIMIT;
  }
  return clampDbTableQueryLimit(parsed);
}

export function renderDbTablePluginEditor(sectionKey: string, block: VisualBlock, helpers: ComponentRenderHelpers): string {
  const tableName = getPluginConfigValue(block.schema.pluginConfig, 'table');
  ensureSqliteRuntime();

  const content = renderDbTablePluginContent(sectionKey, block, helpers, tableName, false);
  const query = block.text.trim();

  return `
    <span class="db-table-info">
      <label>
        <span>Table</span>
        <input
          data-section-key="${helpers.escapeAttr(sectionKey)}"
          data-block-id="${helpers.escapeAttr(block.id)}"
          data-field="block-plugin-db-table"
          value="${helpers.escapeAttr(tableName)}"
          placeholder="job_applications"
        />
      </label>
      <button
        type="button"
        class="ghost db-table-query-button${query.length > 0 ? ' db-table-query-button-active' : ''}"
        data-action="db-table-open-query-editor"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
      >${query.length > 0 ? 'Edit Query' : 'Query'}</button>
    </span>
    ${content}
  `;
}

export function renderDbTablePluginReader(section: VisualSection, block: VisualBlock, helpers: ComponentRenderHelpers): string {
  const tableName = getPluginConfigValue(block.schema.pluginConfig, 'table');
  ensureSqliteRuntime();
  return renderDbTablePluginContent(section.key, block, helpers, tableName, true);
}

function renderDbTablePluginContent(
  sectionKey: string,
  block: VisualBlock,
  helpers: ComponentRenderHelpers,
  tableName: string,
  readOnly: boolean
): string {
  if (tableName.trim().length === 0) {
    return '<div class="plugin-placeholder">Choose a table name to start working with this DB table.</div>';
  }

  if (runtime.loadError) {
    return `<div class="plugin-placeholder">DB table error: ${helpers.escapeHtml(runtime.loadError)}</div>`;
  }

  if (runtime.loading || !runtime.db) {
    return '<div class="plugin-placeholder">Loading database table…</div>';
  }

  try {
    if (ensureTableExists(runtime.db, tableName)) {
      void persistRuntimeDatabase();
    }
    const viewState = getDbTableViewState(sectionKey, block.id);
    const snapshot = readTableSnapshot(runtime.db, tableName, {
      query: block.text,
      offset: viewState.offset,
      dynamicWindow: getDbTableQueryDynamicWindow(block.schema.pluginConfig),
      queryLimit: getDbTableQueryLimit(block.schema.pluginConfig),
      sortColumn: viewState.sortColumn,
      sortDirection: viewState.sortDirection,
    });
    if (readOnly) {
      return renderReadOnlyTable(sectionKey, block.id, tableName, snapshot, helpers);
    }
    return renderEditableTable(sectionKey, block.id, tableName, snapshot, helpers);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error.';
    return `<div class="plugin-placeholder">DB table error: ${helpers.escapeHtml(message)}</div>`;
  }
}

function renderEditableTable(
  sectionKey: string,
  blockId: string,
  tableName: string,
  snapshot: SqliteTableSnapshot,
  helpers: ComponentRenderHelpers
): string {
  const queryActive = snapshot.queryActive;
  const tableDisabledAttr = queryActive ? ' disabled' : '';
  const topSpacerHeight = snapshot.offset * DB_TABLE_ESTIMATED_ROW_HEIGHT;
  const remainingRows = Math.max(snapshot.totalRows - (snapshot.offset + snapshot.rows.length), 0);
  const bottomSpacerHeight = remainingRows * DB_TABLE_ESTIMATED_ROW_HEIGHT;
  const hasRows = snapshot.rows.length > 0;
  const renderedRows = hasRows
    ? snapshot.rows.map(
        (row, rowIndex) => `
          <tr class="table-row-editor table-row-editor-main">
            <td class="table-row-utility sqlite-plugin-row-number">${rowIndex + 1}</td>
            ${snapshot.columns
              .map(
                (column, cellIndex) => `
                  <td>
                    <input
                      class="sqlite-plugin-grid-input"
                      data-field="sqlite-cell"
                      data-section-key="${helpers.escapeAttr(sectionKey)}"
                      data-block-id="${helpers.escapeAttr(blockId)}"
                      data-table-name="${helpers.escapeAttr(tableName)}"
                      data-rowid="${helpers.escapeAttr(String(snapshot.rowIds[rowIndex] ?? ''))}"
                      data-column-name="${helpers.escapeAttr(column)}"
                      value="${helpers.escapeAttr(row[cellIndex] ?? '')}"
                      ${tableDisabledAttr}
                    />
                  </td>`
              )
              .join('')}
                    <td class="table-row-utility table-row-remove-cell">
                      <button
                        type="button"
                        class="ghost sqlite-row-component-button${snapshot.rowHasAttachedComponent[rowIndex] ? ' sqlite-row-component-button-attached' : ''}"
                        data-action="sqlite-open-row-component-editor"
                        data-section-key="${helpers.escapeAttr(sectionKey)}"
                        data-block-id="${helpers.escapeAttr(blockId)}"
                        data-table-name="${helpers.escapeAttr(tableName)}"
                        data-rowid="${helpers.escapeAttr(String(snapshot.rowIds[rowIndex] ?? ''))}"
                        title="${snapshot.rowHasAttachedComponent[rowIndex] ? 'Edit attached component' : 'Attach component'}"
                        ${tableDisabledAttr}
                      >…</button>
                    </td>
                  </tr>`
      ).join('')
    : `
      <tr class="table-row-editor table-row-editor-main sqlite-plugin-draft-row">
        <td class="table-row-utility sqlite-plugin-row-number"></td>
        ${snapshot.columns
          .map(
            (column) => `
              <td>
                <input
                  class="sqlite-plugin-grid-input"
                  data-field="sqlite-cell"
                  data-section-key="${helpers.escapeAttr(sectionKey)}"
                  data-block-id="${helpers.escapeAttr(blockId)}"
                  data-table-name="${helpers.escapeAttr(tableName)}"
                  data-rowid=""
                  data-column-name="${helpers.escapeAttr(column)}"
                  data-sqlite-draft-row="true"
                  value=""
                  ${tableDisabledAttr}
                />
              </td>`
          )
          .join('')}
        <td class="table-row-utility table-row-remove-cell"></td>
      </tr>`;

  return `
    <div class="table-editor sqlite-plugin-editor">
      <div class="table-editor-head">
        <strong>DB Table</strong>
        <span>${
          queryActive
            ? snapshot.dynamicWindow
              ? 'Query preview is read-only and is capped to fewer than 100 rows.'
              : `Query preview is read-only. Rows limited to ${snapshot.queryLimit}.`
            : 'Rows and columns persist in the attached database file.'
        }</span>
      </div>
      <div
        class="table-editor-frame db-table-frame${queryActive ? ' db-table-frame-query-active' : ''}"
        data-db-table-frame="true"
        data-db-table-dynamic-window="${!queryActive || snapshot.dynamicWindow ? 'true' : 'false'}"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(blockId)}"
      >
        <table class="table-editor-grid sqlite-plugin-grid">
          <thead>
            <tr>
              <th class="table-utility-cell"></th>
              ${snapshot.columns
                .map(
                  (column) => `
                    <th>
                      <input
                        class="sqlite-plugin-grid-input sqlite-plugin-grid-header"
                        data-field="sqlite-column-name"
                        data-section-key="${helpers.escapeAttr(sectionKey)}"
                        data-block-id="${helpers.escapeAttr(blockId)}"
                        data-table-name="${helpers.escapeAttr(tableName)}"
                        data-old-column-name="${helpers.escapeAttr(column)}"
                        value="${helpers.escapeAttr(column)}"
                        ${tableDisabledAttr}
                      />
                      <button
                        type="button"
                        class="ghost db-table-sort-button${snapshot.sortColumn === column ? ' db-table-sort-button-active' : ''}"
                        data-action="db-table-toggle-sort"
                        data-section-key="${helpers.escapeAttr(sectionKey)}"
                        data-block-id="${helpers.escapeAttr(blockId)}"
                        data-column-name="${helpers.escapeAttr(column)}"
                        title="Sort by ${helpers.escapeAttr(column)}"
                        ${queryActive ? 'disabled' : ''}
                      >${snapshot.sortColumn === column ? (snapshot.sortDirection === 'desc' ? '↓' : '↑') : '↕'}</button>
                    </th>`
                )
                .join('')}
              <th class="table-add-column-cell">
                <button
                  type="button"
                  class="ghost table-add-button"
                  data-action="sqlite-add-column"
                  data-section-key="${helpers.escapeAttr(sectionKey)}"
                  data-block-id="${helpers.escapeAttr(blockId)}"
                  data-table-name="${helpers.escapeAttr(tableName)}"
                  title="Add column"
                  ${tableDisabledAttr}
                >+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            ${topSpacerHeight > 0 ? `<tr class="db-table-spacer-row"><td colspan="${snapshot.columns.length + 2}" style="height:${topSpacerHeight}px"></td></tr>` : ''}
            ${renderedRows}
            ${bottomSpacerHeight > 0 ? `<tr class="db-table-spacer-row"><td colspan="${snapshot.columns.length + 2}" style="height:${bottomSpacerHeight}px"></td></tr>` : ''}
            <tr class="table-add-row-line">
              <td colspan="${snapshot.columns.length + 2}">
                <button
                  type="button"
                  class="ghost"
                  data-action="sqlite-add-row"
                  data-section-key="${helpers.escapeAttr(sectionKey)}"
                  data-block-id="${helpers.escapeAttr(blockId)}"
                  data-table-name="${helpers.escapeAttr(tableName)}"
                  ${tableDisabledAttr}
                >+ Add Row</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderReadOnlyTable(
  sectionKey: string,
  blockId: string,
  tableName: string,
  snapshot: SqliteTableSnapshot,
  helpers: ComponentRenderHelpers
): string {
  const topSpacerHeight = snapshot.offset * DB_TABLE_ESTIMATED_ROW_HEIGHT;
  const remainingRows = Math.max(snapshot.totalRows - (snapshot.offset + snapshot.rows.length), 0);
  const bottomSpacerHeight = remainingRows * DB_TABLE_ESTIMATED_ROW_HEIGHT;
  return `<div
    class="table-editor-frame db-table-frame db-table-frame-readonly${snapshot.queryActive ? ' db-table-frame-query-active' : ''}"
    data-db-table-frame="true"
    data-db-table-dynamic-window="${!snapshot.queryActive || snapshot.dynamicWindow ? 'true' : 'false'}"
    data-section-key="${helpers.escapeAttr(sectionKey)}"
    data-block-id="${helpers.escapeAttr(blockId)}"
  ><table class="reader-table">
    <thead>
      <tr>${snapshot.columns.map((column) => `<th>${helpers.escapeHtml(column)}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${topSpacerHeight > 0 ? `<tr class="db-table-spacer-row"><td colspan="${snapshot.columns.length}" style="height:${topSpacerHeight}px"></td></tr>` : ''}
      ${snapshot.rows
        .map(
          (row, rowIndex) => `
            <tr
              class="table-main-row table-main-row-${rowIndex % 2 === 0 ? 'even' : 'odd'}${snapshot.rowHasAttachedComponent[rowIndex] ? ' sqlite-plugin-row-has-component' : ''}"
              ${snapshot.rowHasAttachedComponent[rowIndex]
                ? `data-action="sqlite-open-row-component-view" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" data-table-name="${helpers.escapeAttr(tableName)}" data-rowid="${helpers.escapeAttr(String(snapshot.rowIds[rowIndex] ?? ''))}"`
                : ''
              }
            >
              ${row
                .map((cell) => {
                  const value = helpers.escapeHtml(cell);
                  return value ? `<td>${value}</td>` : '<td></td>';
                })
                .join('')}
            </tr>`
        )
        .join('')}
      ${bottomSpacerHeight > 0 ? `<tr class="db-table-spacer-row"><td colspan="${snapshot.columns.length}" style="height:${bottomSpacerHeight}px"></td></tr>` : ''}
    </tbody>
  </table></div>`;
}

export async function addDbTableRow(tableName: string): Promise<void> {
  const db = await getLoadedDatabase();
  ensureTableExists(db, tableName);
  db.run(`INSERT INTO ${quoteIdentifier(tableName)} DEFAULT VALUES`);
  await persistRuntimeDatabase();
}

export async function materializeDbTableDraftRow(tableName: string, columnName: string, value: string): Promise<number | null> {
  if (value.length === 0) {
    return null;
  }

  const db = await getLoadedDatabase();
  ensureTableExists(db, tableName);
  db.run(`INSERT INTO ${quoteIdentifier(tableName)} DEFAULT VALUES`);
  const rowIdResult = db.exec('SELECT last_insert_rowid()');
  const rowId = Number(rowIdResult[0]?.values[0]?.[0] ?? 0);
  if (!Number.isFinite(rowId) || rowId <= 0) {
    throw new Error('Failed to create a database row.');
  }
  db.run(`UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(columnName)} = ? WHERE rowid = ?`, [value, rowId]);
  await persistRuntimeDatabase();
  return rowId;
}

export async function addDbTableColumn(tableName: string): Promise<void> {
  const db = await getLoadedDatabase();
  ensureTableExists(db, tableName);
  const nextName = getNextColumnName(getTableColumns(db, tableName));
  db.run(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(nextName)} TEXT`);
  await persistRuntimeDatabase();
}

export async function renameDbTableColumn(tableName: string, oldName: string, nextName: string): Promise<void> {
  const trimmedNext = nextName.trim();
  if (trimmedNext.length === 0 || trimmedNext === oldName) {
    return;
  }

  const db = await getLoadedDatabase();
  const columns = getTableColumns(db, tableName);
  if (columns.includes(trimmedNext)) {
    throw new Error(`Column "${trimmedNext}" already exists.`);
  }
  db.run(`ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(oldName)} TO ${quoteIdentifier(trimmedNext)}`);
  await persistRuntimeDatabase();
}

export async function updateDbTableCell(tableName: string, rowId: number, columnName: string, value: string): Promise<void> {
  const db = await getLoadedDatabase();
  db.run(`UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(columnName)} = ? WHERE rowid = ?`, [value, rowId]);
  await persistRuntimeDatabase();
}

export async function getSqliteRowComponent(tableName: string, rowId: number): Promise<string | null> {
  const db = await getLoadedDatabase();
  ensureRowComponentsTableExists(db);
  const statement = db.prepare(
    `SELECT hvy FROM ${quoteIdentifier(SQLITE_ROW_COMPONENTS_TABLE)} WHERE table_name = ? AND row_id = ?`
  );

  try {
    statement.bind([tableName, rowId]);
    if (!statement.step()) {
      return null;
    }
    const row = statement.getAsObject() as Record<string, unknown>;
    return typeof row.hvy === 'string' ? row.hvy : null;
  } finally {
    statement.free();
  }
}

export async function setSqliteRowComponent(tableName: string, rowId: number, hvy: string): Promise<void> {
  const db = await getLoadedDatabase();
  ensureRowComponentsTableExists(db);
  const trimmed = hvy.trim();
  if (trimmed.length === 0) {
    db.run(`DELETE FROM ${quoteIdentifier(SQLITE_ROW_COMPONENTS_TABLE)} WHERE table_name = ? AND row_id = ?`, [tableName, rowId]);
    await persistRuntimeDatabase();
    return;
  }

  validateAttachedComponentHvy(trimmed);
  db.run(
    `INSERT INTO ${quoteIdentifier(SQLITE_ROW_COMPONENTS_TABLE)} (table_name, row_id, hvy)
     VALUES (?, ?, ?)
     ON CONFLICT(table_name, row_id) DO UPDATE SET hvy = excluded.hvy`,
    [tableName, rowId, trimmed]
  );
  await persistRuntimeDatabase();
}

export function parseAttachedComponentBlocks(hvy: string): VisualBlock[] {
  const trimmed = hvy.trim();
  if (trimmed.length === 0) {
    return [];
  }

  validateAttachedComponentHvy(trimmed);
  const parsed = deserializeDocumentWithDiagnostics(wrapHvyFragmentAsDocument(trimmed), '.hvy');
  return parsed.document.sections[0]?.blocks ?? [];
}

function ensureSqliteRuntime(): void {
  if (runtime.documentRef === state.document && (runtime.db || runtime.loading || runtime.loadError)) {
    return;
  }

  if (runtime.documentRef !== state.document) {
    resetRuntime();
    runtime.documentRef = state.document;
  }

  runtime.loading = true;
  runtime.loadError = null;
  runtime.loadPromise = loadRuntimeDatabase()
    .then(() => {
      runtime.loading = false;
      runtime.loadError = null;
      getRenderApp()();
    })
    .catch((error) => {
      runtime.loading = false;
      runtime.loadError = error instanceof Error ? error.message : 'Failed to load the database runtime.';
      getRenderApp()();
    });
}

async function getLoadedDatabase(): Promise<SqlJsDatabase> {
  ensureSqliteRuntime();
  if (runtime.loadPromise) {
    await runtime.loadPromise;
  }
  if (!runtime.db) {
    throw new Error(runtime.loadError || 'Database attachment is unavailable.');
  }
  return runtime.db;
}

async function loadRuntimeDatabase(): Promise<void> {
  const SQL = await getSqlJs();
  const bytes = await getAttachmentDatabaseBytes(state.document.attachmentTail ?? null);
  runtime.db = bytes.length > 0 ? new SQL.Database(bytes) : new SQL.Database();
}

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: () => sqlWasmUrl,
    });
  }
  return sqlJsPromise;
}

async function getAttachmentDatabaseBytes(attachmentTail: DocumentTailAttachment | null): Promise<Uint8Array> {
  if (!attachmentTail || attachmentTail.bytes.length === 0) {
    return new Uint8Array();
  }

  const encoding = typeof attachmentTail.meta.encoding === 'string' ? attachmentTail.meta.encoding : '';
  if (encoding === 'gzip') {
    return ungzipBytes(attachmentTail.bytes);
  }

  return Uint8Array.from(attachmentTail.bytes);
}

async function persistRuntimeDatabase(): Promise<void> {
  if (!runtime.db) {
    return;
  }

  const databaseBytes = runtime.db.export();
  runtime.persistPromise = (async () => {
    const encoded = await encodeAttachmentBytes(databaseBytes);
    const previousMeta = state.document.attachmentTail?.meta ?? {};
    state.document.attachmentTail = {
      meta: {
        ...previousMeta,
        plugin: DB_TABLE_PLUGIN_ID,
        mediaType: 'application/vnd.sqlite3',
        ...(encoded.encoding ? { encoding: encoded.encoding } : {}),
      },
      bytes: encoded.bytes,
    };
  })();

  await runtime.persistPromise;
}

async function encodeAttachmentBytes(bytes: Uint8Array): Promise<{ bytes: Uint8Array; encoding?: string }> {
  if (typeof CompressionStream === 'undefined') {
    return {
      bytes: Uint8Array.from(bytes),
    };
  }

  const compressed = await transformBytes(bytes, new CompressionStream('gzip'));
  return {
    bytes: compressed,
    encoding: 'gzip',
  };
}

async function ungzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support gzip decompression for attached database files.');
  }
  return transformBytes(bytes, new DecompressionStream('gzip'));
}

async function transformBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const transformed = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(transformed).arrayBuffer());
}

function resetRuntime(): void {
  try {
    runtime.db?.close();
  } catch {
    // Ignore runtime close failures while swapping documents.
  }
  runtime.db = null;
  runtime.loading = false;
  runtime.loadError = null;
  runtime.loadPromise = null;
  runtime.persistPromise = null;
  dbTableViewState.clear();
}

function readTableSnapshot(
  db: SqlJsDatabase,
  tableName: string,
  options: {
    query: string;
    offset: number;
    dynamicWindow: boolean;
    queryLimit: number;
    sortColumn: string | null;
    sortDirection: 'asc' | 'desc' | null;
  }
): SqliteTableSnapshot {
  const normalizedQuery = options.query.trim().replace(/;+\s*$/u, '');
  const queryActive = normalizedQuery.length > 0;
  const dynamicWindow = queryActive ? options.dynamicWindow : true;
  const queryLimit = clampDbTableQueryLimit(options.queryLimit);
  const columns = queryActive ? getQueryColumns(db, normalizedQuery) : getTableColumns(db, tableName);
  const totalRows = queryActive
    ? getQueryRowCount(db, normalizedQuery, dynamicWindow ? DB_TABLE_MAX_QUERY_ROWS : queryLimit)
    : getTableRowCount(db, tableName);
  const offset = queryActive && !dynamicWindow ? 0 : clampDbTableOffset(options.offset, totalRows);
  const rowIds: number[] = [];
  const rows: string[][] = [];
  const rowComponentIds = queryActive ? new Set<number>() : getRowComponentIdSet(db, tableName);
  const sortColumn = !queryActive && options.sortColumn && columns.includes(options.sortColumn) ? options.sortColumn : null;
  const sortDirection = sortColumn ? (options.sortDirection === 'desc' ? 'desc' : 'asc') : null;
  const statement = db.prepare(
    queryActive
      ? `SELECT * FROM (${normalizedQuery}) AS hvy_query LIMIT ${dynamicWindow ? DB_TABLE_WINDOW_SIZE : queryLimit} OFFSET ${offset}`
      : `SELECT rowid AS "__hvy_rowid__", * FROM ${quoteIdentifier(tableName)}${buildSortClause(sortColumn, sortDirection)} LIMIT ${DB_TABLE_WINDOW_SIZE} OFFSET ${offset}`
  );

  try {
    while (statement.step()) {
      const row = statement.getAsObject() as Record<string, unknown>;
      if (!queryActive) {
        rowIds.push(Number(row.__hvy_rowid__ ?? 0));
      }
      rows.push(columns.map((column) => stringifySqliteValue(row[column])));
    }
  } finally {
    statement.free();
  }

  return {
    columns,
    rowIds,
    rows,
    rowHasAttachedComponent: queryActive ? rows.map(() => false) : rowIds.map((rowId) => rowComponentIds.has(rowId)),
    totalRows,
    offset,
    queryActive,
    dynamicWindow,
    queryLimit,
    sortColumn,
    sortDirection,
  };
}

function getTableRowCount(db: SqlJsDatabase, tableName: string): number {
  const result = db.exec(`SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}`);
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

function getQueryColumns(db: SqlJsDatabase, query: string): string[] {
  const statement = db.prepare(`SELECT * FROM (${query}) AS hvy_query LIMIT 0`);
  try {
    return statement.getColumnNames().filter((column) => column.trim().length > 0);
  } finally {
    statement.free();
  }
}

function getQueryRowCount(db: SqlJsDatabase, query: string, limit: number): number {
  const result = db.exec(`SELECT COUNT(*) FROM (SELECT * FROM (${query}) AS hvy_query LIMIT ${limit}) AS hvy_query_count`);
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

function getTableColumns(db: SqlJsDatabase, tableName: string): string[] {
  const result = db.exec(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  const rows = result[0]?.values ?? [];
  return rows.map((row) => String(row[1] ?? '')).filter((value) => value.trim().length > 0);
}

function ensureTableExists(db: SqlJsDatabase, tableName: string): boolean {
  if (tableExists(db, tableName)) {
    return false;
  }

  const columns = getDefaultColumnsForTable(tableName);
  db.run(`CREATE TABLE ${quoteIdentifier(tableName)} (${columns.map((column) => `${quoteIdentifier(column)} TEXT`).join(', ')})`);
  return true;
}

function ensureRowComponentsTableExists(db: SqlJsDatabase): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(SQLITE_ROW_COMPONENTS_TABLE)} (
      table_name TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      hvy TEXT NOT NULL,
      PRIMARY KEY (table_name, row_id)
    )`
  );
}

function getRowComponentIdSet(db: SqlJsDatabase, tableName: string): Set<number> {
  ensureRowComponentsTableExists(db);
  const statement = db.prepare(
    `SELECT row_id FROM ${quoteIdentifier(SQLITE_ROW_COMPONENTS_TABLE)} WHERE table_name = ?`
  );
  const ids = new Set<number>();

  try {
    statement.bind([tableName]);
    while (statement.step()) {
      const row = statement.getAsObject() as Record<string, unknown>;
      ids.add(Number(row.row_id ?? 0));
    }
  } finally {
    statement.free();
  }

  return ids;
}

function tableExists(db: SqlJsDatabase, tableName: string): boolean {
  const result = db.exec('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', tableName]);
  return (result[0]?.values.length ?? 0) > 0;
}

function getDefaultColumnsForTable(tableName: string): string[] {
  if (/\b(job[_ -]?applications?|contacts?)\b/i.test(tableName)) {
    return ['Company', 'URL', 'Status'];
  }
  return ['Column 1', 'Column 2', 'Column 3'];
}

function getNextColumnName(existingColumns: string[]): string {
  let index = existingColumns.length + 1;
  let candidate = `Column ${index}`;
  while (existingColumns.includes(candidate)) {
    index += 1;
    candidate = `Column ${index}`;
  }
  return candidate;
}

function buildSortClause(sortColumn: string | null, sortDirection: 'asc' | 'desc' | null): string {
  if (!sortColumn || !sortDirection) {
    return '';
  }
  return ` ORDER BY ${quoteIdentifier(sortColumn)} ${sortDirection.toUpperCase()}`;
}

function clampDbTableOffset(offset: number, totalRows: number): number {
  const maxOffset = Math.max(totalRows - DB_TABLE_WINDOW_SIZE, 0);
  return Math.max(0, Math.min(offset, maxOffset));
}

function clampDbTableQueryLimit(value: number): number {
  return Math.max(1, Math.min(Math.floor(value), DB_TABLE_MAX_QUERY_ROWS));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function stringifySqliteValue(value: unknown): string {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  if (value instanceof Uint8Array) {
    return '[blob]';
  }
  return String(value);
}

export function resetDbTableViewState(sectionKey: string, blockId: string): void {
  dbTableViewState.set(getDbTableViewKey(sectionKey, blockId), {
    offset: 0,
    scrollTop: 0,
    sortColumn: null,
    sortDirection: null,
  });
}

export function toggleDbTableSort(sectionKey: string, blockId: string, columnName: string): void {
  const viewState = getDbTableViewState(sectionKey, blockId);
  if (viewState.sortColumn !== columnName) {
    viewState.sortColumn = columnName;
    viewState.sortDirection = 'asc';
  } else if (viewState.sortDirection === 'asc') {
    viewState.sortDirection = 'desc';
  } else {
    viewState.sortColumn = null;
    viewState.sortDirection = null;
  }
  viewState.offset = 0;
  viewState.scrollTop = 0;
}

export function handleDbTableFrameScroll(frame: HTMLElement): boolean {
  if (frame.dataset.dbTableDynamicWindow === 'false') {
    return false;
  }
  const sectionKey = frame.dataset.sectionKey ?? '';
  const blockId = frame.dataset.blockId ?? '';
  if (sectionKey.length === 0 || blockId.length === 0) {
    return false;
  }
  const viewState = getDbTableViewState(sectionKey, blockId);
  viewState.scrollTop = frame.scrollTop;
  const firstVisibleRow = Math.floor(frame.scrollTop / DB_TABLE_ESTIMATED_ROW_HEIGHT);
  let nextOffset = viewState.offset;
  if (firstVisibleRow > viewState.offset + DB_TABLE_FORWARD_SCROLL_TRIGGER) {
    nextOffset += DB_TABLE_WINDOW_SIZE;
  } else if (viewState.offset > 0 && firstVisibleRow < viewState.offset + DB_TABLE_BACKWARD_SCROLL_TRIGGER) {
    nextOffset -= DB_TABLE_WINDOW_SIZE;
  }
  nextOffset = Math.max(0, nextOffset);
  if (nextOffset === viewState.offset) {
    return false;
  }
  viewState.offset = nextOffset;
  return true;
}

export function restoreDbTableFrameScroll(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-db-table-frame="true"]').forEach((frame) => {
    const sectionKey = frame.dataset.sectionKey ?? '';
    const blockId = frame.dataset.blockId ?? '';
    if (sectionKey.length === 0 || blockId.length === 0) {
      return;
    }
    const viewState = getDbTableViewState(sectionKey, blockId);
    frame.scrollTop = viewState.scrollTop;
  });
}

function validateAttachedComponentHvy(hvy: string): void {
  const parsed = deserializeDocumentWithDiagnostics(wrapHvyFragmentAsDocument(hvy), '.hvy');
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((diagnostic) => diagnostic.message).join(' '));
  }

  if (parsed.document.sections.length !== 1) {
    throw new Error('Attached row HVY must contain exactly one section wrapper after parsing.');
  }

  const section = parsed.document.sections[0];
  if (!section || section.children.length > 0 || section.blocks.length === 0) {
    throw new Error('Attached row HVY must contain one or more HVY component fragments.');
  }
}

export function getDocumentDbTableNames(document: VisualDocument): string[] {
  const tableNames = new Set<string>();
  visitBlocks(document.sections, (block) => {
    if (block.schema.component !== 'plugin' || block.schema.plugin !== DB_TABLE_PLUGIN_ID) {
      return;
    }
    const tableName = getPluginConfigValue(block.schema.pluginConfig, 'table').trim();
    if (tableName.length > 0) {
      tableNames.add(tableName);
    }
  });
  return [...tableNames];
}

export function hasDocumentDbTables(document: VisualDocument): boolean {
  return getDocumentDbTableNames(document).length > 0;
}

export async function executeDbTableQueryTool(
  document: VisualDocument,
  request: { tableName?: string; query?: string; limit?: number }
): Promise<string> {
  const availableTables = getDocumentDbTableNames(document);
  if (availableTables.length === 0) {
    throw new Error('No DB tables are available in this document.');
  }

  const db = await openDocumentDatabase(document);
  try {
    const requestedTable = request.tableName?.trim() ?? '';
    if (requestedTable.length > 0 && !availableTables.includes(requestedTable)) {
      throw new Error(`Unknown DB table "${requestedTable}". Available tables: ${availableTables.join(', ')}.`);
    }

    const normalizedQuery = (request.query ?? '').trim().replace(/;+\s*$/u, '');
    const tableName = requestedTable || (availableTables.length === 1 ? (availableTables[0] ?? '') : '');
    if (normalizedQuery.length === 0 && tableName.length === 0) {
      throw new Error(`Specify table_name when querying DB tables. Available tables: ${availableTables.join(', ')}.`);
    }

    const limit = Math.max(1, Math.min(Math.floor(request.limit ?? 10), 25));
    const query = normalizedQuery.length > 0 ? normalizedQuery : `SELECT * FROM ${quoteIdentifier(tableName)}`;
    const statement = db.prepare(`SELECT * FROM (${query}) AS hvy_query LIMIT ${limit}`);
    const columns = statement.getColumnNames();
    const rows: string[][] = [];

    try {
      while (statement.step()) {
        const row = statement.getAsObject() as Record<string, unknown>;
        rows.push(columns.map((column) => stringifySqliteValue(row[column])));
      }
    } finally {
      statement.free();
    }

    return [
      `Available DB tables: ${availableTables.join(', ')}`,
      `Executed query: ${query}`,
      `Returned rows: ${rows.length}${rows.length === limit ? ` (limited to ${limit})` : ''}`,
      '',
      columns.length === 0
        ? '(no columns returned)'
        : [
            columns.join(' | '),
            columns.map(() => '---').join(' | '),
            ...rows.map((row) => row.map((cell) => cell.replaceAll('\n', '\\n')).join(' | ')),
          ].join('\n'),
    ].join('\n');
  } finally {
    try {
      db.close();
    } catch {
      // Ignore close failures for ephemeral AI query databases.
    }
  }
}

export interface DbTableAiSummary {
  tableName: string;
  schema: Array<{ name: string; type: string; notNull: boolean; pk: boolean }>;
  sampleRows: string[][];
  totalRows: number;
  activeQuery: string | null;
}

export async function getDbTableAiSummary(
  document: VisualDocument,
  tableName: string,
  options?: { activeQuery?: string; sampleLimit?: number }
): Promise<DbTableAiSummary> {
  const availableTables = getDocumentDbTableNames(document);
  if (!availableTables.includes(tableName)) {
    throw new Error(`Unknown DB table "${tableName}". Available tables: ${availableTables.join(', ') || '(none)'}.`);
  }
  const sampleLimit = Math.max(1, Math.min(Math.floor(options?.sampleLimit ?? 10), 25));
  const activeQuery = options?.activeQuery?.trim().replace(/;+\s*$/u, '') || null;

  const db = await openDocumentDatabase(document);
  try {
    const pragma = db.exec(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
    const pragmaRows = pragma[0]?.values ?? [];
    const schema = pragmaRows.map((row) => ({
      name: String(row[1] ?? ''),
      type: String(row[2] ?? ''),
      notNull: Number(row[3] ?? 0) === 1,
      pk: Number(row[5] ?? 0) > 0,
    }));

    const totalRows = activeQuery
      ? Number(
          db.exec(`SELECT COUNT(*) FROM (${activeQuery}) AS hvy_query`)[0]?.values[0]?.[0] ?? 0
        )
      : Number(db.exec(`SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}`)[0]?.values[0]?.[0] ?? 0);

    const sampleStatement = db.prepare(
      activeQuery
        ? `SELECT * FROM (${activeQuery}) AS hvy_query LIMIT ${sampleLimit}`
        : `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ${sampleLimit}`
    );
    const sampleColumns = sampleStatement.getColumnNames();
    const sampleRows: string[][] = [];
    try {
      while (sampleStatement.step()) {
        const row = sampleStatement.getAsObject() as Record<string, unknown>;
        sampleRows.push(sampleColumns.map((column) => stringifySqliteValue(row[column])));
      }
    } finally {
      sampleStatement.free();
    }

    return { tableName, schema, sampleRows, totalRows, activeQuery };
  } finally {
    try {
      db.close();
    } catch {
      // Ignore close failures for ephemeral summary databases.
    }
  }
}

export async function executeDbTableWriteSql(sql: string): Promise<string> {
  const trimmed = sql.trim().replace(/;+\s*$/u, '');
  if (trimmed.length === 0) {
    throw new Error('execute_sql requires a non-empty SQL statement.');
  }
  const leading = trimmed.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
  if (leading === 'SELECT' || leading === 'WITH') {
    throw new Error('Use query_db_table for read-only SELECT statements. execute_sql is for write statements.');
  }

  const db = await getLoadedDatabase();
  db.run(trimmed);
  const changes = Number(db.exec('SELECT changes()')[0]?.values[0]?.[0] ?? 0);
  await persistRuntimeDatabase();
  return `Executed: ${trimmed}\nRows affected: ${changes}`;
}

async function openDocumentDatabase(document: VisualDocument): Promise<SqlJsDatabase> {
  const SQL = await getSqlJs();
  const bytes = await getAttachmentDatabaseBytes(document.attachmentTail ?? null);
  return bytes.length > 0 ? new SQL.Database(bytes) : new SQL.Database();
}
