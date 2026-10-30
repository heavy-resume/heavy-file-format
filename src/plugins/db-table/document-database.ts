import { gunzipSync, gzipSync } from 'fflate';
import { state } from '../../state';
import type { DocumentAttachment, VisualDocument } from '../../types';
import { DB_ATTACHMENT_ID, setAttachment } from '../../attachments';
import { ensureDocumentAttachmentStore, materializeDocumentAttachment, type AttachmentStore } from '../../attachment-store';
import { markDatabaseAttachmentChanged, recordDatabaseAttachmentHistory } from '../../history';
import { recordDatabaseTablesChanged } from '../../database-change-tracker';
import { DB_TABLE_PLUGIN_ID } from '../registry';

export type SqliteBindValue = number | string | Uint8Array | null;
export type SqliteBindParams = SqliteBindValue[] | Record<string, SqliteBindValue> | null;
interface SqlJsQueryResult {
  columns: string[];
  values: unknown[][];
}
export interface SqlJsStatement {
  bind(params?: SqliteBindParams): boolean;
  getColumnNames(): string[];
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}
export interface SqlJsDatabase {
  close(): void;
  export(): Uint8Array;
  exec(sql: string, params?: SqliteBindParams): SqlJsQueryResult[];
  prepare(sql: string, params?: SqliteBindParams): SqlJsStatement;
  run(sql: string, params?: SqliteBindParams): void;
  getRowsModified(): number;
  updateHook(callback: ((operation: string, database: string, table: string, rowId: number) => void) | null): SqlJsDatabase;
}
interface SqlJsStatic {
  Database: new (bytes?: Uint8Array) => SqlJsDatabase;
}
type InitSqlJs = (config: { locateFile: () => string }) => Promise<SqlJsStatic>;

/**
 * The single live SQLite database for a document's `db` attachment. Every reader and
 * writer shares it, so a long-lived holder (a script callback, a power script) always
 * sees current rows. The attachment stays the persisted form: commits write it back,
 * and when anyone else replaces the attachment bytes (undo/redo, document load, host
 * recall) the live database is rebuilt from them on next access. Each save records which
 * tables changed for `doc.db.get_updated_tables`.
 */
export interface DocumentDatabase {
  current(): SqlJsDatabase;
  isInTransaction(): boolean;
  /**
   * Writes the live database back to the attachment. While a transaction is open the
   * write waits for the commit that ends it, because exporting would roll it back.
   */
  commit(options?: { recordHistoryCheckpoint?: boolean }): 'saved' | 'deferred';
  /** Rolls back the open transaction, leaving the live database equal to the saved attachment. */
  rollback(): void;
}

interface LiveDatabaseEntry {
  db: SqlJsDatabase | null;
  syncedBytes: Uint8Array | null;
  pendingHistoryCheckpoint: boolean;
  /** Tables SQLite reported row changes for since the last save, including trigger and cascade effects. */
  changedTables: Set<string>;
  reportedRowChanges: number;
  totalChangesAtLastSave: number;
  /** sqlite_schema entries (name -> table and definition) as of the last save. */
  savedSchema: Map<string, string>;
}

// sql.js closes and reopens its connection to export, which resets connection-scoped
// settings. These are restored so a save never changes how later statements behave.
const CONNECTION_FLAG_PRAGMAS = [
  'automatic_index',
  'cell_size_check',
  'foreign_keys',
  'ignore_check_constraints',
  'legacy_alter_table',
  'query_only',
  'recursive_triggers',
  'reverse_unordered_selects',
  'trusted_schema',
] as const;
const UNLOADED_ATTACHMENT_BYTES = new Uint8Array();
const liveDatabases = new WeakMap<AttachmentStore, LiveDatabaseEntry>();
const closeCollectedDatabases = new FinalizationRegistry<LiveDatabaseEntry>((entry) => {
  closeLiveDatabase(entry);
});
let sqlJsPromise: Promise<SqlJsStatic> | null = null;
let loadedSqlJs: SqlJsStatic | null = null;

export async function openDocumentDatabase(document: VisualDocument): Promise<DocumentDatabase> {
  await getSqlJs();
  await materializeDocumentAttachment(
    document,
    DB_ATTACHMENT_ID,
    isLiveDocument(document) ? state.attachmentHost : null,
  );
  return {
    current: () => getCurrentDatabase(document),
    isInTransaction: () => isTransactionOpen(getCurrentDatabase(document)),
    commit: (options) => commitDocumentDatabase(document, options?.recordHistoryCheckpoint ?? true),
    rollback: () => rollbackDocumentDatabase(document),
  };
}

function getCurrentDatabase(document: VisualDocument): SqlJsDatabase {
  const store = ensureDocumentAttachmentStore(document);
  const entry = getLiveDatabaseEntry(store);
  const attachment = store.get(DB_ATTACHMENT_ID);
  const bytes = !attachment ? null : store.isMaterialized(DB_ATTACHMENT_ID) ? attachment.bytes : UNLOADED_ATTACHMENT_BYTES;
  if (entry.db && entry.syncedBytes === bytes) {
    return entry.db;
  }
  closeLiveDatabase(entry);
  const decoded = decodeAttachmentDatabaseBytes(attachment);
  const db = decoded.length > 0 ? new (requireSqlJs().Database)(decoded) : new (requireSqlJs().Database)();
  entry.db = db;
  entry.syncedBytes = bytes;
  entry.savedSchema = readSchema(db);
  startChangeTracking(entry, db);
  return db;
}

function commitDocumentDatabase(document: VisualDocument, recordHistoryCheckpoint: boolean): 'saved' | 'deferred' {
  const store = ensureDocumentAttachmentStore(document);
  const db = getCurrentDatabase(document);
  const entry = getLiveDatabaseEntry(store);
  entry.pendingHistoryCheckpoint ||= recordHistoryCheckpoint;
  if (isTransactionOpen(db)) {
    return 'deferred';
  }
  const live = isLiveDocument(document);
  if (live && entry.pendingHistoryCheckpoint) {
    recordDatabaseAttachmentHistory();
  }
  entry.pendingHistoryCheckpoint = false;
  const changes = readChangesSinceLastSave(entry, db);
  const bytes = gzipSync(exportPreservingConnectionSettings(db));
  entry.savedSchema = changes.schema;
  startChangeTracking(entry, db);
  setAttachment(
    document,
    DB_ATTACHMENT_ID,
    {
      ...(store.get(DB_ATTACHMENT_ID)?.meta ?? {}),
      plugin: DB_TABLE_PLUGIN_ID,
      mediaType: 'application/vnd.sqlite3',
      encoding: 'gzip',
    },
    bytes
  );
  entry.syncedBytes = bytes;
  if (live) {
    markDatabaseAttachmentChanged();
  }
  if (changes.tables.length > 0 || !changes.complete) {
    recordDatabaseTablesChanged(document, changes.tables, changes.complete);
  }
  return 'saved';
}

function rollbackDocumentDatabase(document: VisualDocument): void {
  const db = getCurrentDatabase(document);
  const entry = getLiveDatabaseEntry(ensureDocumentAttachmentStore(document));
  const changes = readChangesSinceLastSave(entry, db);
  db.run('ROLLBACK');
  startChangeTracking(entry, db);
  // Readers may have seen the rolled-back rows on the shared connection.
  if (changes.tables.length > 0 || !changes.complete) {
    recordDatabaseTablesChanged(document, changes.tables, changes.complete);
  }
}

function startChangeTracking(entry: LiveDatabaseEntry, db: SqlJsDatabase): void {
  entry.changedTables = new Set();
  entry.reportedRowChanges = 0;
  entry.totalChangesAtLastSave = readTotalChanges(db);
  // Registered again after every export, which reopens the connection without it.
  db.updateHook((_operation, _database, table) => {
    entry.changedTables.add(table);
    entry.reportedRowChanges += 1;
  });
}

// The update hook misses WITHOUT ROWID tables and truncating deletes, and never reports
// schema changes. total_changes() counts every row change, so a gap means some table
// changed unseen and the change is reported as touching all tables.
function readChangesSinceLastSave(
  entry: LiveDatabaseEntry,
  db: SqlJsDatabase
): { tables: string[]; complete: boolean; schema: Map<string, string> } {
  const schema = readSchema(db);
  const tables = new Set(entry.changedTables);
  for (const name of new Set([...entry.savedSchema.keys(), ...schema.keys()])) {
    const before = entry.savedSchema.get(name);
    const after = schema.get(name);
    if (before === after) continue;
    for (const definition of [before, after]) {
      if (definition) tables.add(JSON.parse(definition)[0] as string);
    }
  }
  const unreportedRowChanges = readTotalChanges(db) - entry.totalChangesAtLastSave - entry.reportedRowChanges;
  return { tables: [...tables], complete: unreportedRowChanges <= 0, schema };
}

function readSchema(db: SqlJsDatabase): Map<string, string> {
  const rows = db.exec('SELECT name, tbl_name, sql FROM sqlite_schema')[0]?.values ?? [];
  return new Map(rows.map((row) => [String(row[0]), JSON.stringify([String(row[1]), row[2] ?? null])]));
}

function readTotalChanges(db: SqlJsDatabase): number {
  return Number(db.exec('SELECT total_changes()')[0]?.values[0]?.[0] ?? 0);
}

function exportPreservingConnectionSettings(db: SqlJsDatabase): Uint8Array {
  const settings = CONNECTION_FLAG_PRAGMAS.map((name) => [name, db.exec(`PRAGMA ${name}`)[0]?.values[0]?.[0]] as const);
  const bytes = db.export();
  for (const [name, value] of settings) {
    if (value !== undefined) db.run(`PRAGMA ${name} = ${Number(value) ? 'ON' : 'OFF'}`);
  }
  return bytes;
}

// sql.js does not expose sqlite3_get_autocommit; BEGIN fails only inside a transaction.
function isTransactionOpen(db: SqlJsDatabase): boolean {
  try {
    db.run('BEGIN');
  } catch {
    return true;
  }
  db.run('ROLLBACK');
  return false;
}

function getLiveDatabaseEntry(store: AttachmentStore): LiveDatabaseEntry {
  let entry = liveDatabases.get(store);
  if (!entry) {
    entry = {
      db: null,
      syncedBytes: null,
      pendingHistoryCheckpoint: false,
      changedTables: new Set(),
      reportedRowChanges: 0,
      totalChangesAtLastSave: 0,
      savedSchema: new Map(),
    };
    liveDatabases.set(store, entry);
    closeCollectedDatabases.register(store, entry);
  }
  return entry;
}

function closeLiveDatabase(entry: LiveDatabaseEntry): void {
  try {
    entry.db?.close();
  } catch {
    // Ignore close failures for replaced live databases.
  }
  entry.db = null;
  entry.syncedBytes = null;
}

function isLiveDocument(document: VisualDocument): boolean {
  const liveDocument = state?.document;
  return Boolean(liveDocument)
    && ensureDocumentAttachmentStore(document) === ensureDocumentAttachmentStore(liveDocument);
}

function decodeAttachmentDatabaseBytes(attachment: DocumentAttachment | null): Uint8Array {
  if (!attachment || attachment.bytes.length === 0) {
    return new Uint8Array();
  }
  return attachment.meta.encoding === 'gzip' ? gunzipSync(attachment.bytes) : Uint8Array.from(attachment.bytes);
}

function requireSqlJs(): SqlJsStatic {
  if (!loadedSqlJs) {
    throw new Error('The SQLite runtime is not loaded. Open the document database before using it.');
  }
  return loadedSqlJs;
}

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const [{ default: initSqlJs }, { default: sqlWasmUrl }] = await Promise.all([
        import('sql.js') as Promise<{ default: InitSqlJs }>,
        import('sql.js/dist/sql-wasm.wasm?url') as Promise<{ default: string }>,
      ]);
      loadedSqlJs = await initSqlJs({
        locateFile: () => locateSqlWasmFile(sqlWasmUrl),
      });
      return loadedSqlJs;
    })();
  }
  return sqlJsPromise;
}

function locateSqlWasmFile(sqlWasmUrl: string): string {
  if (
    typeof process !== 'undefined'
    && process.versions?.node
    && sqlWasmUrl.startsWith('/node_modules/')
  ) {
    return `${process.cwd()}${sqlWasmUrl}`;
  }
  return sqlWasmUrl;
}
