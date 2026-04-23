import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

import type { ComponentRenderHelpers } from './editor/component-helpers';
import type { VisualBlock, VisualSection } from './editor/types';
import { deserializeDocumentWithDiagnostics, wrapHvyFragmentAsDocument } from './serialization';
import { getRenderApp, state } from './state';
import type { DocumentTailAttachment, VisualDocument } from './types';

export const SQLITE_TABLE_PLUGIN_ID = 'dev.heavy.sqlite-table';
const SQLITE_ROW_COMPONENTS_TABLE = '__hvy_row_components';

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;
type SqlJsDatabase = InstanceType<SqlJsStatic['Database']>;

interface SqliteTableSnapshot {
  columns: string[];
  rowIds: number[];
  rows: string[][];
  rowHasAttachedComponent: boolean[];
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

function getPluginConfigValue(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

export function renderSqlitePluginEditor(sectionKey: string, block: VisualBlock, helpers: ComponentRenderHelpers): string {
  const source = getPluginConfigValue(block.schema.pluginConfig, 'source') || 'with-file';
  const tableName = getPluginConfigValue(block.schema.pluginConfig, 'table');
  ensureSqliteRuntime();

  const content = renderSqlitePluginContent(sectionKey, block, helpers, tableName, false);

  return `
    <label>
      <span>Plugin</span>
      <input
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-plugin"
        value="${helpers.escapeAttr(block.schema.plugin)}"
        placeholder="${helpers.escapeAttr(SQLITE_TABLE_PLUGIN_ID)}"
      />
    </label>
    <label>
      <span>Source</span>
      <select disabled>
        <option selected>${helpers.escapeHtml(source)}</option>
      </select>
    </label>
    <label>
      <span>Table Name</span>
      <input
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-plugin-db-table"
        value="${helpers.escapeAttr(tableName)}"
        placeholder="records"
      />
    </label>
    ${content}
  `;
}

export function renderSqlitePluginReader(section: VisualSection, block: VisualBlock, helpers: ComponentRenderHelpers): string {
  const tableName = getPluginConfigValue(block.schema.pluginConfig, 'table');
  ensureSqliteRuntime();
  return renderSqlitePluginContent(section.key, block, helpers, tableName, true);
}

function renderSqlitePluginContent(
  sectionKey: string,
  block: VisualBlock,
  helpers: ComponentRenderHelpers,
  tableName: string,
  readOnly: boolean
): string {
  if (tableName.trim().length === 0) {
    return '<div class="plugin-placeholder">Set a table name to open the SQLite-backed grid.</div>';
  }

  if (runtime.loadError) {
    return `<div class="plugin-placeholder">SQLite plugin error: ${helpers.escapeHtml(runtime.loadError)}</div>`;
  }

  if (runtime.loading || !runtime.db) {
    return '<div class="plugin-placeholder">Loading SQLite table…</div>';
  }

  try {
    if (ensureTableExists(runtime.db, tableName)) {
      void persistRuntimeDatabase();
    }
    const snapshot = readTableSnapshot(runtime.db, tableName);
    if (readOnly) {
      return renderReadOnlyTable(sectionKey, block.id, tableName, snapshot, helpers);
    }
    return renderEditableTable(sectionKey, block.id, tableName, snapshot, helpers);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown SQLite error.';
    return `<div class="plugin-placeholder">SQLite plugin error: ${helpers.escapeHtml(message)}</div>`;
  }
}

function renderEditableTable(
  sectionKey: string,
  blockId: string,
  tableName: string,
  snapshot: SqliteTableSnapshot,
  helpers: ComponentRenderHelpers
): string {
  return `
    <div class="table-editor sqlite-plugin-editor">
      <div class="table-editor-head">
        <strong>SQLite Table Editor</strong>
        <span>Rows and columns persist in the attached SQLite database.</span>
      </div>
      <div class="table-editor-frame">
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
                      />
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
                >+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            ${snapshot.rows
              .map(
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
                            />
                          </td>`
                      )
                      .join('')}
                    <td class="table-row-utility table-row-remove-cell">
                      <button
                        type="button"
                        class="ghost"
                        data-action="sqlite-open-row-component-editor"
                        data-section-key="${helpers.escapeAttr(sectionKey)}"
                        data-block-id="${helpers.escapeAttr(blockId)}"
                        data-table-name="${helpers.escapeAttr(tableName)}"
                        data-rowid="${helpers.escapeAttr(String(snapshot.rowIds[rowIndex] ?? ''))}"
                        title="${snapshot.rowHasAttachedComponent[rowIndex] ? 'Edit attached component' : 'Attach component'}"
                      >${snapshot.rowHasAttachedComponent[rowIndex] ? '…*' : '…'}</button>
                    </td>
                  </tr>`
              )
              .join('')}
            <tr class="table-add-row-line">
              <td colspan="${snapshot.columns.length + 2}">
                <button
                  type="button"
                  class="ghost"
                  data-action="sqlite-add-row"
                  data-section-key="${helpers.escapeAttr(sectionKey)}"
                  data-block-id="${helpers.escapeAttr(blockId)}"
                  data-table-name="${helpers.escapeAttr(tableName)}"
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
  return `<table class="reader-table">
    <thead>
      <tr>${snapshot.columns.map((column) => `<th>${helpers.escapeHtml(column)}</th>`).join('')}</tr>
    </thead>
    <tbody>
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
    </tbody>
  </table>`;
}

export async function addSqlitePluginRow(tableName: string): Promise<void> {
  const db = await getLoadedDatabase();
  ensureTableExists(db, tableName);
  db.run(`INSERT INTO ${quoteIdentifier(tableName)} DEFAULT VALUES`);
  await persistRuntimeDatabase();
}

export async function addSqlitePluginColumn(tableName: string): Promise<void> {
  const db = await getLoadedDatabase();
  ensureTableExists(db, tableName);
  const snapshot = readTableSnapshot(db, tableName);
  const nextName = getNextColumnName(snapshot.columns);
  db.run(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(nextName)} TEXT`);
  await persistRuntimeDatabase();
}

export async function renameSqlitePluginColumn(tableName: string, oldName: string, nextName: string): Promise<void> {
  const trimmedNext = nextName.trim();
  if (trimmedNext.length === 0 || trimmedNext === oldName) {
    return;
  }

  const db = await getLoadedDatabase();
  const snapshot = readTableSnapshot(db, tableName);
  if (snapshot.columns.includes(trimmedNext)) {
    throw new Error(`Column "${trimmedNext}" already exists.`);
  }
  db.run(`ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(oldName)} TO ${quoteIdentifier(trimmedNext)}`);
  await persistRuntimeDatabase();
}

export async function updateSqlitePluginCell(tableName: string, rowId: number, columnName: string, value: string): Promise<void> {
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

export function parseAttachedComponentBlock(hvy: string): VisualBlock | null {
  const trimmed = hvy.trim();
  if (trimmed.length === 0) {
    return null;
  }

  validateAttachedComponentHvy(trimmed);
  const parsed = deserializeDocumentWithDiagnostics(wrapHvyFragmentAsDocument(trimmed), '.hvy');
  return parsed.document.sections[0]?.blocks[0] ?? null;
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
      runtime.loadError = error instanceof Error ? error.message : 'Failed to load SQLite runtime.';
      getRenderApp()();
    });
}

async function getLoadedDatabase(): Promise<SqlJsDatabase> {
  ensureSqliteRuntime();
  if (runtime.loadPromise) {
    await runtime.loadPromise;
  }
  if (!runtime.db) {
    throw new Error(runtime.loadError || 'SQLite database is unavailable.');
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
        plugin: SQLITE_TABLE_PLUGIN_ID,
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
    throw new Error('This browser does not support gzip decompression for SQLite attachments.');
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
}

function readTableSnapshot(db: SqlJsDatabase, tableName: string): SqliteTableSnapshot {
  const columns = getTableColumns(db, tableName);
  const statement = db.prepare(`SELECT rowid AS "__hvy_rowid__", * FROM ${quoteIdentifier(tableName)}`);
  const rowIds: number[] = [];
  const rows: string[][] = [];
  const rowComponentIds = getRowComponentIdSet(db, tableName);

  try {
    while (statement.step()) {
      const row = statement.getAsObject() as Record<string, unknown>;
      rowIds.push(Number(row.__hvy_rowid__ ?? 0));
      rows.push(columns.map((column) => stringifySqliteValue(row[column])));
    }
  } finally {
    statement.free();
  }

  return {
    columns,
    rowIds,
    rows,
    rowHasAttachedComponent: rowIds.map((rowId) => rowComponentIds.has(rowId)),
  };
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
  if (!section || section.children.length > 0 || section.blocks.length !== 1) {
    throw new Error('Attached row HVY must contain exactly one HVY component fragment.');
  }
}
