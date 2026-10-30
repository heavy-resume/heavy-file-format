import type { VisualBlock } from '../editor/types';
import { state } from '../state';
import type { VisualDocument } from '../types';
import type { JsonObject } from '../hvy/types';
import { DB_ATTACHMENT_ID, getAttachment } from '../attachments';
import { DB_TABLE_PLUGIN_ID } from './registry';
import { validateAttachedComponentHvy } from './db-table-fragment';
import { formatQueryResultTable } from './db-table-format';
import type { ScriptingDatabaseTableHandle, ScriptingDbApi } from './scripting/runtime';
import type { DatabaseChangeSnapshot } from '../database-change-tracker';
import {
  clampDbTableOffset,
  DB_TABLE_MAX_QUERY_ROWS,
  DB_TABLE_WINDOW_SIZE,
  getDbTableQueryDynamicWindow,
  getDbTableQueryLimit,
  getDocumentDbTableNames,
  getPluginConfigValue,
} from './db-table-model';
import { formatEffectiveDbTableColumns, parseSparseDbTableColumns, readDbTableConfig } from './db-table/db-table-config';
import {
  openDocumentDatabase,
  type SqliteBindParams,
  type SqliteBindValue,
  type SqlJsDatabase,
} from './db-table/document-database';

const SQLITE_ROW_COMPONENTS_TABLE = '__hvy_row_components';

interface DbTableSnapshot {
  objectType: 'table' | 'view';
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

export {
  getDbTableQueryDynamicWindow,
  getDbTableQueryLimit,
  getDocumentDbTableNames,
  resetDbTableViewState,
  restoreDbTableFrameScroll,
  toggleDbTableSort,
} from './db-table-model';

export async function getEffectiveDbTableColumnPresentation(
  document: VisualDocument,
  block: VisualBlock
): Promise<JsonObject> {
  const config = readDbTableConfig(block.schema.pluginConfig);
  const { loadDbTableSourcePage } = await import('./db-table/db-table-data');
  const page = await loadDbTableSourcePage(document, config, {
    query: block.text,
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });
  return formatEffectiveDbTableColumns(config, page.columns);
}

export async function setEffectiveDbTableColumnPresentation(
  document: VisualDocument,
  block: VisualBlock,
  value: JsonObject
): Promise<void> {
  const config = readDbTableConfig(block.schema.pluginConfig);
  const { loadDbTableSourcePage } = await import('./db-table/db-table-data');
  const page = await loadDbTableSourcePage(document, config, {
    query: block.text,
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });
  const columns = parseSparseDbTableColumns(config, value, page.columns);
  const pluginConfig = { ...block.schema.pluginConfig };
  if (Object.keys(columns).length > 0) pluginConfig.columns = columns;
  else delete pluginConfig.columns;
  block.schema.pluginConfig = pluginConfig;
}

export async function getDbTableRowComponent(tableName: string, rowId: number): Promise<string | null> {
  const db = (await openDocumentDatabase(state.document)).current();
  if (!hasRowComponentsTable(db)) {
    return null;
  }
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

export async function setDbTableRowComponent(tableName: string, rowId: number, hvy: string): Promise<void> {
  const database = await openDocumentDatabase(state.document);
  const db = database.current();
  ensureRowComponentsTableExists(db);
  const trimmed = hvy.trim();
  if (trimmed.length === 0) {
    db.run(`DELETE FROM ${quoteIdentifier(SQLITE_ROW_COMPONENTS_TABLE)} WHERE table_name = ? AND row_id = ?`, [tableName, rowId]);
    database.commit();
    return;
  }

  validateAttachedComponentHvy(trimmed);
  db.run(
    `INSERT INTO ${quoteIdentifier(SQLITE_ROW_COMPONENTS_TABLE)} (table_name, row_id, hvy)
     VALUES (?, ?, ?)
     ON CONFLICT(table_name, row_id) DO UPDATE SET hvy = excluded.hvy`,
    [tableName, rowId, trimmed]
  );
  database.commit();
}

function readTableSnapshot(
  db: SqlJsDatabase,
  tableName: string,
  options: {
    objectType?: 'table' | 'view';
    query: string;
    offset: number;
    dynamicWindow: boolean;
    queryLimit: number;
    sortColumn: string | null;
    sortDirection: 'asc' | 'desc' | null;
  }
): DbTableSnapshot {
  const normalizedQuery = options.query.trim().replace(/;+\s*$/u, '');
  const queryActive = normalizedQuery.length > 0;
  const objectType = options.objectType ?? getDbObjectType(db, tableName);
  if (!objectType) {
    throw new Error(`Table or view "${tableName}" does not exist.`);
  }
  const readOnlySource = queryActive || objectType === 'view';
  const dynamicWindow = queryActive ? options.dynamicWindow : true;
  const queryLimit = getDbTableQueryLimit({ queryLimit: options.queryLimit });
  const columns = queryActive ? getQueryColumns(db, normalizedQuery) : getTableColumns(db, tableName);
  const totalRows = queryActive
    ? getQueryRowCount(db, normalizedQuery, dynamicWindow ? DB_TABLE_MAX_QUERY_ROWS : queryLimit)
    : getTableRowCount(db, tableName);
  const offset = queryActive && !dynamicWindow ? 0 : clampDbTableOffset(options.offset, totalRows);
  const rowIds: number[] = [];
  const rows: string[][] = [];
  const rowComponentIds = readOnlySource ? new Set<number>() : getRowComponentIdSet(db, tableName);
  const sortColumn = !readOnlySource && options.sortColumn && columns.includes(options.sortColumn) ? options.sortColumn : null;
  const sortDirection = sortColumn ? (options.sortDirection === 'desc' ? 'desc' : 'asc') : null;
  const statement = db.prepare(
    queryActive
      ? `SELECT * FROM (${normalizedQuery}) AS hvy_query LIMIT ${dynamicWindow ? DB_TABLE_WINDOW_SIZE : queryLimit} OFFSET ${offset}`
      : objectType === 'view'
        ? `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ${DB_TABLE_WINDOW_SIZE} OFFSET ${offset}`
      : `SELECT rowid AS "__hvy_rowid__", * FROM ${quoteIdentifier(tableName)}${buildSortClause(sortColumn, sortDirection)} LIMIT ${DB_TABLE_WINDOW_SIZE} OFFSET ${offset}`
  );

  try {
    while (statement.step()) {
      const row = statement.getAsObject() as Record<string, unknown>;
      if (!readOnlySource) {
        rowIds.push(Number(row.__hvy_rowid__ ?? 0));
      }
      rows.push(columns.map((column) => stringifySqliteValue(row[column])));
    }
  } finally {
    statement.free();
  }

  return {
    objectType,
    columns,
    rowIds,
    rows,
    rowHasAttachedComponent: readOnlySource ? rows.map(() => false) : rowIds.map((rowId) => rowComponentIds.has(rowId)),
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
  if (getDbObjectType(db, tableName)) {
    return false;
  }

  const columns = getDefaultColumnsForTable(tableName);
  db.run(`CREATE TABLE ${quoteIdentifier(tableName)} (${columns.map((column) => `${quoteIdentifier(column)} TEXT`).join(', ')})`);
  return true;
}

function requireExistingDbObject(db: SqlJsDatabase, tableName: string): 'table' | 'view' {
  const objectType = getDbObjectType(db, tableName);
  if (!objectType) {
    throw new Error(`DB object "${tableName}" does not exist. Create a table or view named "${tableName}" first.`);
  }
  return objectType;
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

function hasRowComponentsTable(db: SqlJsDatabase): boolean {
  return getDbObjectType(db, SQLITE_ROW_COMPONENTS_TABLE) === 'table';
}

function getRowComponentIdSet(db: SqlJsDatabase, tableName: string): Set<number> {
  if (!hasRowComponentsTable(db)) {
    return new Set();
  }
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

function getDbObjectType(db: SqlJsDatabase, tableName: string): 'table' | 'view' | null {
  const result = db.exec(
    "SELECT type FROM sqlite_schema WHERE name = ? AND type IN ('table', 'view') ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END LIMIT 1",
    [tableName]
  );
  const type = String(result[0]?.values[0]?.[0] ?? '');
  return type === 'table' || type === 'view' ? type : null;
}

function getDefaultColumnsForTable(tableName: string): string[] {
  if (/\bchores?\b/i.test(tableName)) {
    return ['description', 'assignee', 'status', 'created_at'];
  }
  if (/\bassignments?\b/i.test(tableName)) {
    return ['chore', 'person', 'assigned_at', 'status'];
  }
  if (/\bcompletions?\b/i.test(tableName)) {
    return ['chore', 'person', 'completed_at'];
  }
  if (/\b(job[_ -]?applications?|contacts?)\b/i.test(tableName)) {
    return ['Company', 'URL', 'Status'];
  }
  return ['Column 1', 'Column 2', 'Column 3'];
}

function buildSortClause(sortColumn: string | null, sortDirection: 'asc' | 'desc' | null): string {
  if (!sortColumn || !sortDirection) {
    return '';
  }
  return ` ORDER BY ${quoteIdentifier(sortColumn)} ${sortDirection.toUpperCase()}`;
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

export async function getDocumentDbTableObjectNames(document: VisualDocument): Promise<string[]> {
  const attachment = getAttachment(document, DB_ATTACHMENT_ID);
  if (!attachment || attachment.bytes.length === 0) {
    return [];
  }
  const db = (await openDocumentDatabase(document)).current();
  const result = db.exec(
    "SELECT name FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name != ? ORDER BY name",
    [SQLITE_ROW_COMPONENTS_TABLE]
  );
  return (result[0]?.values ?? [])
    .map((row) => String(row[0] ?? '').trim())
    .filter((name) => name.length > 0);
}

export async function materializeDocumentDbTables(document: VisualDocument): Promise<string[]> {
  const tableNames = getDocumentDbTableNames(document);
  if (tableNames.length === 0) {
    return [];
  }

  const database = await openDocumentDatabase(document);
  const db = database.current();
  const created: string[] = [];
  for (const tableName of tableNames) {
    if (ensureTableExists(db, tableName)) {
      created.push(tableName);
    }
  }
  if (created.length > 0) {
    database.commit();
  }
  return created;
}

export { formatQueryResultTable } from './db-table-format';

export async function executeDbTableQueryTool(
  document: VisualDocument,
  request: { tableName?: string; query?: string; limit?: number }
): Promise<string> {
  const availableTables = await getDocumentDbTableObjectNames(document);
  if (availableTables.length === 0) {
    throw new Error('No SQLite tables or views are available in this document.');
  }

  const db = (await openDocumentDatabase(document)).current();
  const requestedTable = request.tableName?.trim() ?? '';
  if (requestedTable.length > 0 && !availableTables.includes(requestedTable)) {
    throw new Error(`Unknown SQLite table/view "${requestedTable}". Available SQLite tables/views: ${availableTables.join(', ')}.`);
  }
  if (requestedTable.length > 0) {
    requireExistingDbObject(db, requestedTable);
  }

  const normalizedQuery = (request.query ?? '').trim().replace(/;+\s*$/u, '');
  const tableName = requestedTable || (availableTables.length === 1 ? (availableTables[0] ?? '') : '');
  if (normalizedQuery.length === 0 && tableName.length === 0) {
    throw new Error(`Specify table_name when querying SQLite tables/views. Available SQLite tables/views: ${availableTables.join(', ')}.`);
  }

  const limit = Math.max(1, Math.min(Math.floor(request.limit ?? 10), 25));
  if (normalizedQuery.length === 0) {
    requireExistingDbObject(db, tableName);
  }
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
    `Available SQLite tables/views: ${availableTables.join(', ')}`,
    `Executed query: ${query}`,
    `Returned rows: ${rows.length}${rows.length === limit ? ` (limited to ${limit})` : ''}`,
    '',
    columns.length === 0 ? '(no columns returned)' : formatQueryResultTable(columns, rows),
  ].join('\n');
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

  const db = (await openDocumentDatabase(document)).current();
  requireExistingDbObject(db, tableName);
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
}

export async function getDbTableRenderedText(document: VisualDocument, block: VisualBlock): Promise<string> {
  if (block.schema.component !== 'plugin' || block.schema.plugin !== DB_TABLE_PLUGIN_ID) {
    return 'This component is not a DB table plugin.';
  }

  const availableTables = getDocumentDbTableNames(document);
  const tableName = getPluginConfigValue(block.schema.pluginConfig, 'table').trim();
  const query = block.text.trim().replace(/;+\s*$/u, '');
  if (tableName.length === 0) {
    return [
      'DB table plugin rendered output:',
      'Error: missing pluginConfig.table.',
      `Configured db-table component targets: ${availableTables.join(', ') || '(none)'}`,
    ].join('\n');
  }
  if (!availableTables.includes(tableName)) {
    return [
      'DB table plugin rendered output:',
      `Error: unknown table "${tableName}".`,
      `Configured db-table component targets: ${availableTables.join(', ') || '(none)'}`,
    ].join('\n');
  }

  const db = (await openDocumentDatabase(document)).current();
  let objectType: 'table' | 'view';
  try {
    objectType = requireExistingDbObject(db, tableName);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database table render error.';
    return [
      'DB table plugin rendered output:',
      `Table: ${tableName}`,
      `Query: ${query || '(all rows)'}`,
      `DB table error: ${message}`,
    ].join('\n');
  }

  let snapshot: DbTableSnapshot;
  try {
    snapshot = readTableSnapshot(db, tableName, {
      objectType,
      query,
      offset: 0,
      dynamicWindow: getDbTableQueryDynamicWindow(block.schema.pluginConfig),
      queryLimit: getDbTableQueryLimit(block.schema.pluginConfig),
      sortColumn: null,
      sortDirection: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database table render error.';
    const columns = getTableColumns(db, tableName);
    return [
      'DB table plugin rendered output:',
      `Table: ${tableName}`,
      `Query: ${query || '(all rows)'}`,
      `DB table error: ${message}`,
      `Known table columns: ${columns.join(', ') || '(none)'}`,
    ].join('\n');
  }

  const rows = snapshot.rows.slice(0, 10);
  return [
    'DB table plugin rendered output:',
    `Table: ${tableName}`,
    `Query: ${query || '(all rows)'}`,
    `Columns: ${snapshot.columns.join(', ') || '(none)'}`,
    `Rows shown: ${rows.length} of ${snapshot.totalRows}`,
    '',
    snapshot.columns.length === 0 ? '(no columns rendered)' : formatQueryResultTable(snapshot.columns, rows),
  ].join('\n');
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

  const database = await openDocumentDatabase(state.document);
  const db = database.current();
  db.run(trimmed);
  const changes = Number(db.exec('SELECT changes()')[0]?.values[0]?.[0] ?? 0);
  const schemaSummary = summarizeRuntimeDatabaseSchema(db);
  database.commit();
  return [`Executed: ${trimmed}`, `Rows affected: ${changes}`, '', schemaSummary].join('\n');
}

function summarizeRuntimeDatabaseSchema(db: SqlJsDatabase): string {
  const objectRows = db.exec(
    "SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name != ? ORDER BY name",
    [SQLITE_ROW_COMPONENTS_TABLE]
  )[0]?.values ?? [];
  const objects = objectRows
    .map((row) => ({
      name: String(row[0] ?? '').trim(),
      type: String(row[1] ?? '').trim(),
    }))
    .filter((object) => object.name.length > 0);
  if (objects.length === 0) {
    return 'SQLite schema now:\n(none)';
  }
  const lines = objects.map((object) => {
    const columns = getTableColumns(db, object.name);
    const columnSummary = columns.length > 0 ? columns.join(', ') : '(no columns)';
    return `- ${object.name} (${object.type}): ${columnSummary}`;
  });
  return [
    `Available SQLite tables/views: ${objects.map((object) => object.name).join(', ')}`,
    'SQLite schema now:',
    ...lines,
  ].join('\n');
}

function normalizeScriptingSqlParams(params: unknown): SqliteBindParams {
  if (params == null) {
    return null;
  }
  if (Array.isArray(params)) {
    return params.map((value) => normalizeScriptingSqlValue(value));
  }
  if (typeof params === 'object') {
    const normalized: Record<string, SqliteBindValue> = {};
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      normalized[key] = normalizeScriptingSqlValue(value);
    }
    return normalized;
  }
  throw new Error('SQL params must be a list or object.');
}

function normalizeScriptingSqlValue(value: unknown): SqliteBindValue {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  throw new Error('SQL params may only contain strings, numbers, booleans, bytes, or null.');
}

export async function validateDocumentDbSql(
  document: VisualDocument,
  sql: string,
  mode: 'query' | 'execute'
): Promise<void> {
  const trimmed = String(sql ?? '').trim().replace(/;+\s*$/u, '');
  if (trimmed.length === 0) {
    throw new Error(`doc.db.${mode} requires non-empty SQL.`);
  }
  const leading = trimmed.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
  if (mode === 'query' && leading !== 'SELECT' && leading !== 'WITH') {
    throw new Error('doc.db.query should use read-only SELECT/WITH SQL.');
  }
  if (mode === 'execute' && (leading === 'SELECT' || leading === 'WITH')) {
    throw new Error('Use doc.db.query for read-only SELECT/WITH SQL. doc.db.execute is for writes.');
  }
  const db = (await openDocumentDatabase(document)).current();
  const statement = db.prepare(trimmed);
  statement.free();
}

export interface ScriptingDbRuntime {
  api: ScriptingDbApi;
  /**
   * Ends a transaction this runtime opened and left open, by committing or rolling it
   * back. Returns whether one was open. A commit that SQLite rejects is rolled back and
   * its error rethrown.
   */
  settleUnfinishedTransaction(outcome: 'commit' | 'rollback'): boolean;
  dispose(): void;
}

export async function createScriptingDbRuntime(
  document: VisualDocument,
  onMutation?: () => void,
  databaseChanges: DatabaseChangeSnapshot = { revision: 0, tables: [], complete: true }
): Promise<ScriptingDbRuntime> {
  const database = await openDocumentDatabase(document);
  let disposed = false;
  let databaseHistoryCheckpointRecorded = false;
  let ownsOpenTransaction = false;
  const currentDatabase = () => {
    if (disposed) {
      throw new Error('This doc.db runtime has been disposed.');
    }
    return database.current();
  };
  const getTableNames = () => readScriptingDatabaseTableNames(currentDatabase());
  const api: ScriptingDbApi = {
    query: (sql, params) => {
      const trimmed = String(sql ?? '').trim().replace(/;+\s*$/u, '');
      if (trimmed.length === 0) {
        throw new Error('doc.db.query requires a non-empty SQL query.');
      }
      const statement = currentDatabase().prepare(trimmed, normalizeScriptingSqlParams(params));
      const columns = statement.getColumnNames();
      const rows: Record<string, unknown>[] = [];
      try {
        while (statement.step()) {
          const row = statement.getAsObject() as Record<string, unknown>;
          rows.push(Object.fromEntries(columns.flatMap((column, index) => [
            [column, row[column] ?? null],
            [String(index), row[column] ?? null],
          ])));
        }
      } finally {
        statement.free();
      }
      return rows;
    },
    execute: (sql, params) => {
      const trimmed = String(sql ?? '').trim().replace(/;+\s*$/u, '');
      if (trimmed.length === 0) {
        throw new Error('doc.db.execute requires a non-empty SQL statement.');
      }
      const leading = trimmed.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
      if (leading === 'SELECT' || leading === 'WITH') {
        throw new Error('Use doc.db.query for read-only SELECT statements. doc.db.execute is for writes.');
      }
      const db = currentDatabase();
      const transactionWasOpen = database.isInTransaction();
      db.run(trimmed, normalizeScriptingSqlParams(params));
      const rowsAffected = db.getRowsModified();
      const transactionIsOpen = database.commit({ recordHistoryCheckpoint: !databaseHistoryCheckpointRecorded }) === 'deferred';
      databaseHistoryCheckpointRecorded = true;
      ownsOpenTransaction = transactionIsOpen && (ownsOpenTransaction || !transactionWasOpen);
      onMutation?.();
      return `Executed: ${trimmed}\nRows affected: ${rowsAffected}`;
    },
    get_tables: () => getTableNames().map((name) => ({ name, removed: false })),
    get_updated_tables: (tableName = '') => {
      const filter = String(tableName ?? '').trim();
      const currentNames = getTableNames();
      const currentNameSet = new Set(currentNames);
      const changedNames = databaseChanges.complete
        ? databaseChanges.tables
        : [...new Set([...currentNames, ...databaseChanges.tables])];
      return changedNames
        .filter((name) => !filter || name === filter)
        .map<ScriptingDatabaseTableHandle>((name) => ({ name, removed: !currentNameSet.has(name) }));
    },
  };
  const settleUnfinishedTransaction = (outcome: 'commit' | 'rollback') => {
    if (disposed || !ownsOpenTransaction) return false;
    ownsOpenTransaction = false;
    if (!database.isInTransaction()) return false;
    try {
      if (outcome === 'commit') {
        try {
          database.current().run('COMMIT');
        } catch (error) {
          if (database.isInTransaction()) database.rollback();
          throw error;
        }
        database.commit();
      } else {
        database.rollback();
      }
    } finally {
      onMutation?.();
    }
    return true;
  };
  return {
    api,
    settleUnfinishedTransaction,
    dispose: () => {
      settleUnfinishedTransaction('rollback');
      disposed = true;
    },
  };
}

function readScriptingDatabaseTableNames(db: SqlJsDatabase): string[] {
  const result = db.exec(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )[0];
  return (result?.values ?? []).map((row) => String(row[0] ?? '')).filter(Boolean);
}

export function syncDbTableColumnNameInDom(tableName: string, oldColumnName: string, nextColumnName: string, app: HTMLElement): void {
  const escapedTableName = CSS.escape(tableName);
  const escapedOldColumnName = CSS.escape(oldColumnName);

  app
    .querySelectorAll<HTMLElement>(
      `[data-table-name="${escapedTableName}"][data-column-name="${escapedOldColumnName}"]`
    )
    .forEach((element) => {
      element.dataset.columnName = nextColumnName;
    });

  app
    .querySelectorAll<HTMLElement>(
      `[data-table-name="${escapedTableName}"][data-old-column-name="${escapedOldColumnName}"]`
    )
    .forEach((element) => {
      element.dataset.oldColumnName = nextColumnName;
    });
}
