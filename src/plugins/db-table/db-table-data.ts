import type { VisualDocument } from '../../types';
import { createScriptingDbRuntime } from '../db-table';
import type { ScriptingDbApi } from '../scripting/runtime';
import { validateDbTableObjectName } from '../db-table-identifiers';
import type { DbTableConfig } from './db-table-config';
import {
  getDatabaseTableSource,
  registerBuiltInDatabaseTableSource,
  type HvyDatabaseTableColumn,
  type HvyDatabaseTableForeignKey,
  type HvyDatabaseTableForeignOption,
  type HvyDatabaseTablePage,
  type HvyDatabaseTablePageRequest,
  type HvyDatabaseTableRow,
  type HvyDatabaseTableValue,
} from '../database-table-source';

export type DbTableValue = HvyDatabaseTableValue;
export type DbTableForeignKey = HvyDatabaseTableForeignKey;
export type DbTableForeignOption = HvyDatabaseTableForeignOption;
export type DbTableColumnSchema = HvyDatabaseTableColumn;
export type DbTableRow = HvyDatabaseTableRow;
export type DbTableSourcePage = HvyDatabaseTablePage;

export interface DbTableInsertedRow {
  rowId: number;
  values: Record<string, DbTableValue>;
}

interface DbTableLoadOptions {
  query: string;
  offset: number;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
}

export async function loadDbTableSourcePage(
  document: VisualDocument,
  config: DbTableConfig,
  options: DbTableLoadOptions
): Promise<DbTableSourcePage> {
  if (!config.table.trim()) throw new Error('Choose a table or view to display.');
  const source = getDatabaseTableSource(config.source);
  if (!source) throw new Error(`DB Table source "${config.source}" is not available.`);
  const page = await source.readPage({
    document,
    table: config.table,
    query: options.query,
    pageSize: config.queryLimit,
    offset: options.offset,
    sortColumn: options.sortColumn,
    sortDirection: options.sortDirection,
    relationshipDisplayColumns: Object.fromEntries(Object.entries(config.columns)
      .flatMap(([columnName, column]) => column.foreignDisplayColumn?.trim()
        ? [[columnName, column.foreignDisplayColumn.trim()]]
        : [])),
  });
  return source.id === 'with-file' ? page : { ...page, editable: false };
}

async function readWithFilePage(request: HvyDatabaseTablePageRequest): Promise<HvyDatabaseTablePage> {
  assertTableName(request.table);
  return withDatabase(request.document, async (db) => {
    const objectType = getObjectType(db, request.table);
    if (!objectType) throw new Error(`Table or view "${request.table}" does not exist.`);
    const normalizedQuery = normalizeReadOnlyQuery(request.query);
    const queryActive = normalizedQuery.length > 0;
    const editable = objectType === 'table' && !queryActive && tableSupportsRowId(db, request.table);
    const baseColumns = readColumnSchema(db, request.table);
    const columns = queryActive
      ? readQueryColumns(db, normalizedQuery, baseColumns)
      : await addForeignKeyMetadata(db, request.table, request.relationshipDisplayColumns, baseColumns);
    const offset = normalizePageOffset(request.offset, request.pageSize);
    const sortColumn = editable && request.sortColumn && columns.some((column) => column.name === request.sortColumn)
      ? request.sortColumn
      : null;
    const sortDirection = sortColumn && request.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const directTableOrder = objectType === 'table' && editable
      ? sortColumn
        ? ` ORDER BY ${quoteIdentifier(sortColumn)} ${sortDirection}`
        : ' ORDER BY rowid ASC'
      : '';
    const fetchLimit = request.pageSize + 1;
    const sql = queryActive
      ? `SELECT * FROM (${normalizedQuery}) AS hvy_query LIMIT ${fetchLimit} OFFSET ${offset}`
      : objectType === 'table' && editable
        ? `SELECT rowid AS "__hvy_rowid__", * FROM ${quoteIdentifier(request.table)}${directTableOrder} LIMIT ${fetchLimit} OFFSET ${offset}`
        : `SELECT * FROM ${quoteIdentifier(request.table)} LIMIT ${fetchLimit} OFFSET ${offset}`;
    const attachedRowIds = editable ? readAttachedRowIds(db, request.table) : new Set<number>();
    const fetchedRows = db.query(sql);
    const rows = fetchedRows.slice(0, request.pageSize).map((row) => {
      const rowId = editable ? readNumber(row.__hvy_rowid__) : null;
      return {
        rowId,
        hasAttachedComponent: rowId !== null && attachedRowIds.has(rowId),
        values: Object.fromEntries(columns.map((column) => [column.name, normalizeValue(row[column.name])])),
      };
    });
    return {
      objectType,
      editable,
      queryActive,
      columns,
      rows,
      offset,
      hasNextPage: fetchedRows.length > request.pageSize,
      hasTriggers: tableHasTriggers(db, request.table),
    };
  });
}

registerBuiltInDatabaseTableSource({
  id: 'with-file',
  label: 'Attached database',
  readPage: readWithFilePage,
});

export async function updateDbTableSourceCell(
  document: VisualDocument,
  tableName: string,
  rowId: number,
  column: DbTableColumnSchema,
  value: DbTableValue
): Promise<void> {
  assertTableName(tableName);
  return withDatabase(document, (db) => {
    db.execute(
      `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(column.name)} = ? WHERE rowid = ?`,
      [normalizeWriteValue(value), rowId]
    );
  });
}

export async function insertDbTableRow(
  document: VisualDocument,
  tableName: string,
  values: Array<{ column: DbTableColumnSchema; value: DbTableValue }>
): Promise<DbTableInsertedRow> {
  assertTableName(tableName);
  return withDatabase(document, (db) => {
    if (values.length === 0) {
      db.execute(`INSERT INTO ${quoteIdentifier(tableName)} DEFAULT VALUES`);
    } else {
      db.execute(
        `INSERT INTO ${quoteIdentifier(tableName)} (${values.map(({ column }) => quoteIdentifier(column.name)).join(', ')}) VALUES (${values.map(() => '?').join(', ')})`,
        values.map(({ value }) => normalizeWriteValue(value))
      );
    }
    const rowId = readNumber(db.query(
      `SELECT rowid AS row_id FROM ${quoteIdentifier(tableName)} ORDER BY rowid DESC LIMIT 1`
    )[0]?.row_id);
    const columns = readColumnSchema(db, tableName);
    const row = db.query(`SELECT * FROM ${quoteIdentifier(tableName)} WHERE rowid = ?`, [rowId])[0] ?? {};
    return {
      rowId,
      values: Object.fromEntries(columns.map((column) => [column.name, normalizeValue(row[column.name])])),
    };
  });
}

export async function restoreDbTableRow(
  document: VisualDocument,
  tableName: string,
  row: DbTableInsertedRow
): Promise<void> {
  assertTableName(tableName);
  await withDatabase(document, (db) => {
    requireWritableTable(db, tableName);
    const columns = readColumnSchema(db, tableName).filter((column) => !column.generated);
    db.execute(
      `INSERT INTO ${quoteIdentifier(tableName)} (rowid${columns.length ? `, ${columns.map((column) => quoteIdentifier(column.name)).join(', ')}` : ''}) VALUES (?${columns.map(() => ', ?').join('')})`,
      [row.rowId, ...columns.map((column) => normalizeWriteValue(row.values[column.name] ?? null))]
    );
  });
}

export async function createBasicDbTable(document: VisualDocument, tableName: string): Promise<void> {
  assertTableName(tableName);
  await withDatabase(document, (db) => {
    db.execute(`CREATE TABLE ${quoteIdentifier(tableName)} ("Column 1" TEXT, "Column 2" TEXT)`);
  });
}

export async function addDbTableSourceColumn(document: VisualDocument, tableName: string): Promise<string> {
  assertTableName(tableName);
  return withDatabase(document, (db) => {
    requireWritableTable(db, tableName);
    const names = readColumnSchema(db, tableName).map((column) => column.name);
    const nextName = getNextColumnName(names);
    db.execute(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(nextName)} TEXT`);
    return nextName;
  });
}

export async function addNamedDbTableColumn(
  document: VisualDocument,
  tableName: string,
  columnName: string
): Promise<void> {
  assertTableName(tableName);
  await withDatabase(document, (db) => {
    requireWritableTable(db, tableName);
    db.execute(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} TEXT`);
  });
}

export async function renameDbTableSourceColumn(
  document: VisualDocument,
  tableName: string,
  oldColumnName: string,
  nextColumnName: string
): Promise<string> {
  assertTableName(tableName);
  const trimmed = nextColumnName.trim();
  if (!trimmed) throw new Error('Database column names cannot be empty.');
  if (trimmed === oldColumnName) return trimmed;
  return withDatabase(document, (db) => {
    requireWritableTable(db, tableName);
    const names = readColumnSchema(db, tableName).map((column) => column.name);
    if (!names.includes(oldColumnName)) throw new Error(`Column "${oldColumnName}" does not exist.`);
    if (names.includes(trimmed)) throw new Error(`Column "${trimmed}" already exists.`);
    db.execute(`ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(oldColumnName)} TO ${quoteIdentifier(trimmed)}`);
    return trimmed;
  });
}

export async function dropDbTableSourceColumn(document: VisualDocument, tableName: string, columnName: string): Promise<void> {
  assertTableName(tableName);
  await withDatabase(document, (db) => {
    requireWritableTable(db, tableName);
    const names = readColumnSchema(db, tableName).map((column) => column.name);
    if (!names.includes(columnName)) return;
    if (names.length <= 1) throw new Error('Cannot delete the last remaining column.');
    db.execute(`ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(columnName)}`);
  });
}

export async function deleteDbTableRow(document: VisualDocument, tableName: string, rowId: number): Promise<void> {
  assertTableName(tableName);
  await withDatabase(document, (db) => {
    requireWritableTable(db, tableName);
    db.execute(`DELETE FROM ${quoteIdentifier(tableName)} WHERE rowid = ?`, [rowId]);
    if (hasTable(db, '__hvy_row_components')) {
      db.execute('DELETE FROM "__hvy_row_components" WHERE table_name = ? AND row_id = ?', [tableName, rowId]);
    }
  });
}

export function encodeDbTableOptionValue(value: DbTableValue): string {
  if (value === null) return 'null:';
  if (typeof value === 'number') return `number:${value}`;
  if (typeof value === 'string') return `string:${encodeURIComponent(value)}`;
  return `bytes:${Array.from(value).join('.')}`;
}

export function decodeDbTableOptionValue(value: string): DbTableValue {
  const separator = value.indexOf(':');
  const kind = separator >= 0 ? value.slice(0, separator) : '';
  const payload = separator >= 0 ? value.slice(separator + 1) : value;
  if (kind === 'null') return null;
  if (kind === 'number') {
    const parsed = Number(payload);
    if (!Number.isFinite(parsed)) throw new Error('Invalid numeric relationship value.');
    return parsed;
  }
  if (kind === 'string') return decodeURIComponent(payload);
  if (kind === 'bytes') return Uint8Array.from(payload.split('.').filter(Boolean).map((part) => Number(part)));
  throw new Error('Invalid relationship value.');
}

export function stringifyDbTableValue(value: DbTableValue): string {
  if (value === null) return '';
  if (value instanceof Uint8Array) return `[${value.length} bytes]`;
  return String(value);
}

export function coerceDbTableInput(value: string, type: string): DbTableValue {
  const trimmedType = type.trim().toUpperCase();
  if (/INT/u.test(trimmedType) && /^[-+]?\d+$/u.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : value;
  }
  if (/(?:REAL|FLOA|DOUB|NUMERIC|DECIMAL)/u.test(trimmedType) && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function readColumnSchema(db: ScriptingDbApi, tableName: string): DbTableColumnSchema[] {
  const rows = db.query(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  const primaryKeyColumns = rows.filter((row) => readNumber(row.pk) > 0);
  return rows.map((row) => {
    const type = String(row.type ?? '');
    const primaryKeyOrder = readNumber(row.pk);
    return {
      name: String(row.name ?? ''),
      type,
      notNull: readNumber(row.notnull) === 1,
      defaultValue: normalizeValue(row.dflt_value),
      primaryKeyOrder,
      generated: primaryKeyColumns.length === 1 && primaryKeyOrder === 1 && type.trim().toUpperCase() === 'INTEGER',
      foreignKey: null,
    };
  }).filter((column) => column.name.length > 0);
}

async function addForeignKeyMetadata(
  db: ScriptingDbApi,
  tableName: string,
  relationshipDisplayColumns: Record<string, string>,
  columns: DbTableColumnSchema[]
): Promise<DbTableColumnSchema[]> {
  const foreignRows = db.query(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`);
  const grouped = new Map<number, Record<string, unknown>[]>();
  for (const row of foreignRows) {
    const id = readNumber(row.id);
    grouped.set(id, [...(grouped.get(id) ?? []), row]);
  }
  const simpleRows = [...grouped.values()].filter((rows) => rows.length === 1).map((rows) => rows[0]!);
  return Promise.all(columns.map(async (column) => {
    const foreignRow = simpleRows.find((row) => String(row.from ?? '') === column.name);
    if (!foreignRow) return column;
    const referencedTable = String(foreignRow.table ?? '');
    const referencedColumns = readColumnSchema(db, referencedTable);
    const configuredDisplay = relationshipDisplayColumns[column.name] ?? '';
    const referencedColumn = String(foreignRow.to ?? '') || referencedColumns.find((candidate) => candidate.primaryKeyOrder === 1)?.name || '';
    const displayColumnOptions = referencedColumns.map((candidate) => candidate.name);
    const displayColumn = displayColumnOptions.includes(configuredDisplay) ? configuredDisplay : '';
    const options = displayColumn && referencedColumn
      ? db.query(
          `SELECT ${quoteIdentifier(referencedColumn)} AS "__hvy_value__", ${quoteIdentifier(displayColumn)} AS "__hvy_label__" FROM ${quoteIdentifier(referencedTable)} ORDER BY ${quoteIdentifier(displayColumn)}`
        ).map((row) => ({
          value: normalizeValue(row.__hvy_value__),
          label: stringifyDbTableValue(normalizeValue(row.__hvy_label__)),
        }))
      : [];
    return {
      ...column,
      foreignKey: {
        referencedTable,
        localColumn: column.name,
        referencedColumn,
        onDelete: String(foreignRow.on_delete ?? ''),
        options,
        displayColumnOptions,
      },
    };
  }));
}

function readQueryColumns(
  db: ScriptingDbApi,
  query: string,
  fallback: DbTableColumnSchema[]
): DbTableColumnSchema[] {
  const row = db.query(`SELECT * FROM (${query}) AS hvy_columns LIMIT 1`)[0];
  if (!row) return fallback.map((column) => ({ ...column, foreignKey: null }));
  return Object.keys(row)
    .filter((key) => !/^\d+$/u.test(key))
    .map((name) => ({
      name,
      type: '',
      notNull: false,
      defaultValue: null,
      primaryKeyOrder: 0,
      generated: false,
      foreignKey: null,
    }));
}

async function withDatabase<T>(document: VisualDocument, action: (db: ScriptingDbApi) => T | Promise<T>): Promise<T> {
  const runtime = await createScriptingDbRuntime(document);
  try {
    runtime.api.query('PRAGMA foreign_keys = ON');
    return await action(runtime.api);
  } finally {
    runtime.dispose();
  }
}

function getObjectType(db: ScriptingDbApi, tableName: string): 'table' | 'view' | null {
  const type = String(db.query(
    "SELECT type FROM sqlite_schema WHERE name = ? AND type IN ('table', 'view') LIMIT 1",
    [tableName]
  )[0]?.type ?? '');
  return type === 'table' || type === 'view' ? type : null;
}

function tableSupportsRowId(db: ScriptingDbApi, tableName: string): boolean {
  const sql = String(db.query("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?", [tableName])[0]?.sql ?? '');
  return !/\bWITHOUT\s+ROWID\b/iu.test(sql);
}

function requireWritableTable(db: ScriptingDbApi, tableName: string): void {
  const objectType = getObjectType(db, tableName);
  if (objectType === 'view') throw new Error(`Cannot edit database view "${tableName}". Create or edit a source table instead.`);
  if (objectType !== 'table') throw new Error(`Table "${tableName}" does not exist.`);
}

function hasTable(db: ScriptingDbApi, tableName: string): boolean {
  return String(db.query("SELECT type FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1", [tableName])[0]?.type ?? '') === 'table';
}

function tableHasTriggers(db: ScriptingDbApi, tableName: string): boolean {
  return db.query("SELECT 1 FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ? LIMIT 1", [tableName]).length > 0;
}

function readAttachedRowIds(db: ScriptingDbApi, tableName: string): Set<number> {
  if (!hasTable(db, '__hvy_row_components')) return new Set();
  return new Set(db.query('SELECT row_id FROM "__hvy_row_components" WHERE table_name = ?', [tableName]).map((row) => readNumber(row.row_id)));
}

function getNextColumnName(existing: string[]): string {
  let index = 1;
  while (existing.includes(`Column ${index}`)) index += 1;
  return `Column ${index}`;
}

function normalizeReadOnlyQuery(value: string): string {
  const query = value.trim().replace(/;+\s*$/u, '');
  if (!query) return '';
  const token = query.match(/^[A-Za-z]+/u)?.[0]?.toUpperCase() ?? '';
  if (token !== 'SELECT' && token !== 'WITH') throw new Error('DB Table query must start with SELECT or WITH.');
  return query;
}

function assertTableName(tableName: string): void {
  const error = validateDbTableObjectName(tableName);
  if (error) throw new Error(error);
}

function normalizePageOffset(offset: number, pageSize: number): number {
  const normalized = Math.max(0, Math.floor(offset));
  return Math.floor(normalized / pageSize) * pageSize;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function readNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeValue(value: unknown): DbTableValue {
  if (value === null) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (typeof value === 'undefined') return null;
  return String(value);
}

function normalizeWriteValue(value: DbTableValue): DbTableValue {
  return value instanceof Uint8Array ? Uint8Array.from(value) : value;
}
