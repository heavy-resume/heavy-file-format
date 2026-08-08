import { expect, test } from 'vitest';

import { createScriptingDbRuntime } from '../src/plugins/db-table';
import {
  addDbTableColumn,
  coerceDbTableInput,
  deleteDbTableRow,
  decodeDbTableOptionValue,
  dropDbTableColumn,
  encodeDbTableOptionValue,
  getDbTableWriter,
  insertDbTableRow,
  loadDbTableSourcePage,
  renameDbTableColumn,
  updateDbTableCell,
} from '../src/plugins/db-table/db-table-data';
import {
  normalizeDbTableColumnWidth,
  normalizeDbTableMaxColumnWidth,
  readDbTableColumnConfig,
  readDbTableConfig,
  removeDbTableColumnConfig,
  renameDbTableSourceColumnConfig,
  updateDbTableColumnConfig,
} from '../src/plugins/db-table/db-table-config';
import { deserializeDocument } from '../src/serialization';
import { getDocumentDatabaseTableNames } from '../src/plugins/database-table-targets';
import { buildDocumentEditFormatInstructions } from '../src/ai-document-edit-instructions';
import { setHostDatabaseTableSources, type HvyDatabaseTablePageRequest } from '../src/plugins/database-table-source';
import { dbTablePlugin } from '../src/plugins/db-table/db-table-component';

test('canonical db-table uses the promoted plugin id and version', () => {
  expect(dbTablePlugin).toMatchObject({ id: 'hvy.db-table', version: '0.2.0', displayName: 'DB Table' });
});

test('database-table reads simple foreign keys and configured display values', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const setup = await createScriptingDbRuntime(document);
  try {
    // BEFORE
    setup.api.execute('CREATE TABLE relationships (id INTEGER PRIMARY KEY, organization TEXT NOT NULL)');
    setup.api.execute('CREATE TABLE contacts (id INTEGER PRIMARY KEY, contact TEXT NOT NULL, relationship_id INTEGER NOT NULL REFERENCES relationships(id) ON DELETE CASCADE)');
    setup.api.execute("INSERT INTO relationships (organization) VALUES ('Acme Corp'), ('Globex')");
    setup.api.execute("INSERT INTO contacts (contact, relationship_id) VALUES ('Jane Smith', 1)");
  } finally {
    setup.dispose();
  }

  // TOOL CALL
  const expectedResult = await loadDbTableSourcePage(document, readDbTableConfig({
    source: 'with-file',
    table: 'contacts',
    columns: {
      relationship_id: {
        label: 'Organization',
        foreignDisplayColumn: 'organization',
      },
    },
  }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });

  // AFTER
  expect(expectedResult.editable).toBe(true);
  expect(expectedResult.columns.find((column) => column.name === 'id')?.generated).toBe(true);
  expect(expectedResult.columns.find((column) => column.name === 'relationship_id')?.foreignKey).toMatchObject({
    referencedTable: 'relationships',
    referencedColumn: 'id',
    onDelete: 'CASCADE',
    options: [
      { value: 1, label: 'Acme Corp' },
      { value: 2, label: 'Globex' },
    ],
  });
  expect(expectedResult.rows[0]).toMatchObject({
    rowId: 1,
    values: { id: 1, contact: 'Jane Smith', relationship_id: 1 },
  });
});

test('database-table writes numeric relationship values and enforces foreign keys', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const setup = await createScriptingDbRuntime(document);
  try {
    // BEFORE
    setup.api.execute('CREATE TABLE relationships (id INTEGER PRIMARY KEY, organization TEXT NOT NULL)');
    setup.api.execute('CREATE TABLE contacts (id INTEGER PRIMARY KEY, contact TEXT NOT NULL, relationship_id INTEGER NOT NULL REFERENCES relationships(id))');
    setup.api.execute("INSERT INTO relationships (organization) VALUES ('Acme Corp'), ('Globex')");
    setup.api.execute("INSERT INTO contacts (contact, relationship_id) VALUES ('Jane Smith', 1)");
  } finally {
    setup.dispose();
  }
  const snapshot = await loadDbTableSourcePage(document, readDbTableConfig({ table: 'contacts' }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });
  const relationshipColumn = snapshot.columns.find((column) => column.name === 'relationship_id')!;

  // TOOL CALL
  await updateDbTableCell(document, 'contacts', 1, relationshipColumn, 2);

  // AFTER
  const inspection = await createScriptingDbRuntime(document);
  try {
    expect(inspection.api.query('SELECT relationship_id, typeof(relationship_id) AS storage_type FROM contacts')).toEqual([
      { relationship_id: 2, 0: 2, storage_type: 'integer', 1: 'integer' },
    ]);
  } finally {
    inspection.dispose();
  }
  await expect(updateDbTableCell(document, 'contacts', 1, relationshipColumn, 999)).rejects.toThrow(/FOREIGN KEY constraint failed/u);
});

test('database-table inserts a complete staged row with one write', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const setup = await createScriptingDbRuntime(document);
  try {
    // BEFORE
    setup.api.execute('CREATE TABLE contacts (id INTEGER PRIMARY KEY, contact TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  } finally {
    setup.dispose();
  }
  const snapshot = await loadDbTableSourcePage(document, readDbTableConfig({ table: 'contacts' }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });

  // TOOL CALL
  const inserted = await insertDbTableRow(document, 'contacts', [{
    column: snapshot.columns.find((column) => column.name === 'contact')!,
    value: 'Jane Smith',
  }]);

  // AFTER
  expect(inserted.rowId).toBe(1);
  expect(inserted.values.contact).toBe('Jane Smith');
  const expectedResult = await loadDbTableSourcePage(document, readDbTableConfig({ table: 'contacts' }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });
  expect(expectedResult.rows).toHaveLength(1);
  expect(expectedResult.rows[0]?.values.contact).toBe('Jane Smith');
  expect(expectedResult.rows[0]?.values.created_at).toEqual(expect.any(String));
});

test('database-table column presentation defaults generated keys to compact and validates widths', () => {
  // BEFORE
  const config = readDbTableConfig({ table: 'contacts' });

  // TOOL CALL
  const expectedResult = readDbTableColumnConfig(config, 'id', { generated: true });

  // AFTER
  expect(expectedResult).toMatchObject({
    label: 'Id',
    visibility: 'compact',
    width: '5rem',
    wrap: false,
  });
  expect(normalizeDbTableColumnWidth('18ch')).toBe('18ch');
  expect(normalizeDbTableColumnWidth('calc(100% - 1rem)')).toBe('');
  expect(normalizeDbTableMaxColumnWidth('40rem')).toBe('40rem');
  expect(normalizeDbTableMaxColumnWidth('80%')).toBe('');
  expect(updateDbTableColumnConfig(config, 'id', { visibility: 'hidden', width: '6rem' })).toEqual({
    columns: {
      id: { visibility: 'hidden', width: '6rem' },
    },
  });
});

test('database-table relationship option values preserve SQLite scalar types', () => {
  expect(decodeDbTableOptionValue(encodeDbTableOptionValue(14))).toBe(14);
  expect(decodeDbTableOptionValue(encodeDbTableOptionValue('14'))).toBe('14');
  expect(decodeDbTableOptionValue(encodeDbTableOptionValue(null))).toBeNull();
  expect(coerceDbTableInput('14', 'INTEGER')).toBe(14);
  expect(coerceDbTableInput('14', 'TEXT')).toBe('14');
});

test('database-table participates in shared database targeting and AI SQL tools', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"crm"}-->
#! CRM

<!--hvy:plugin {"plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"contacts"}}-->
`, '.hvy');

  expect(getDocumentDatabaseTableNames(document)).toEqual(['contacts']);
  expect(buildDocumentEditFormatInstructions({
    dbTableNames: ['contacts'],
    pluginHints: [{ name: 'hvy.db-table', displayName: 'DB Table' }],
    request: 'Create the CRM database schema.',
  })).toContain('`execute_sql`');

  const externalDocument = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy:plugin {"plugin":"hvy.db-table","pluginConfig":{"source":"postgresql","table":"contacts"}}-->
`, '.hvy');
  expect(getDocumentDatabaseTableNames(externalDocument)).toEqual([]);
});

test('database-table retains a migrated query limit as its page size', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const setup = await createScriptingDbRuntime(document);
  try {
    // BEFORE
    setup.api.execute('CREATE TABLE work_items (name TEXT)');
    setup.api.execute("INSERT INTO work_items VALUES ('One'), ('Two'), ('Three'), ('Four')");
  } finally {
    setup.dispose();
  }

  // TOOL CALL
  const migratedConfig = readDbTableConfig({
    source: 'with-file',
    table: 'work_items',
    queryDynamicWindow: false,
    queryLimit: 2,
  });
  const expectedResult = await loadDbTableSourcePage(document, migratedConfig, {
    query: 'SELECT name FROM work_items ORDER BY name LIMIT 3',
    offset: 2,
    sortColumn: null,
    sortDirection: null,
  });

  // AFTER
  expect(migratedConfig).toEqual({ source: 'with-file', table: 'work_items', queryLimit: 2, columns: {} });
  expect(expectedResult.offset).toBe(2);
  expect(expectedResult.hasNextPage).toBe(false);
  expect(expectedResult.rows.map((row) => row.values.name)).toEqual(['Three']);
});

test('database-table uses one bounded page size and preserves configured sources', () => {
  expect(readDbTableConfig({ source: 'postgresql', table: 'work_items' })).toMatchObject({
    source: 'postgresql',
    queryLimit: 50,
  });
  expect(readDbTableConfig({ table: 'work_items', queryLimit: 2_000 }).queryLimit).toBe(1_000);
  expect(readDbTableConfig({ table: 'work_items', queryLimit: 0 }).queryLimit).toBe(1);
});

test('database-table delegates authored queries and paging to the selected source', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const requests: HvyDatabaseTablePageRequest[] = [];
  setHostDatabaseTableSources([{
    id: 'postgresql',
    label: 'PostgreSQL',
    async readPage(request) {
      requests.push(request);
      return {
        objectType: 'view',
        editable: true,
        queryActive: true,
        columns: [{
          name: 'name',
          type: 'text',
          notNull: false,
          defaultValue: null,
          primaryKeyOrder: 0,
          generated: false,
          foreignKey: null,
        }],
        rows: [{ rowId: null, hasAttachedComponent: false, values: { name: 'Example' } }],
        offset: request.offset,
        hasNextPage: true,
        hasTriggers: false,
      };
    },
  }]);

  try {
    // TOOL CALL
    const expectedResult = await loadDbTableSourcePage(document, readDbTableConfig({
      source: 'postgresql',
      table: 'work_items',
      queryLimit: 200,
    }), {
      query: 'SELECT name FROM work_items ORDER BY score DESC LIMIT 500 OFFSET 10',
      offset: 400,
      sortColumn: null,
      sortDirection: null,
    });

    // AFTER
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      table: 'work_items',
      query: 'SELECT name FROM work_items ORDER BY score DESC LIMIT 500 OFFSET 10',
      pageSize: 200,
      offset: 400,
    });
    expect(expectedResult.rows[0]?.values.name).toBe('Example');
    expect(expectedResult.hasNextPage).toBe(true);
    expect(expectedResult.editable).toBe(false);
  } finally {
    setHostDatabaseTableSources([]);
  }
});

test('database-table carries forward schema editing and removes row-attached HVY with its row', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const setup = await createScriptingDbRuntime(document);
  try {
    // BEFORE
    setup.api.execute('CREATE TABLE contacts ("Column 1" TEXT, "Column 2" TEXT)');
    setup.api.execute("INSERT INTO contacts VALUES ('Jane', 'Acme')");
    setup.api.execute('CREATE TABLE "__hvy_row_components" (table_name TEXT NOT NULL, row_id INTEGER NOT NULL, hvy TEXT NOT NULL, PRIMARY KEY (table_name, row_id))');
    setup.api.execute("INSERT INTO \"__hvy_row_components\" VALUES ('contacts', 1, 'Attached details')");
  } finally {
    setup.dispose();
  }

  // TOOL CALL
  expect(await addDbTableColumn(document, 'contacts')).toBe('Column 3');
  await renameDbTableColumn(document, 'contacts', 'Column 3', 'Notes');
  await dropDbTableColumn(document, 'contacts', 'Column 2');
  const beforeDelete = await loadDbTableSourcePage(document, readDbTableConfig({ table: 'contacts' }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });
  await deleteDbTableRow(document, 'contacts', 1);

  // AFTER
  expect(beforeDelete.columns.map((column) => column.name)).toEqual(['Column 1', 'Notes']);
  expect(beforeDelete.rows[0]?.hasAttachedComponent).toBe(true);
  const inspection = await createScriptingDbRuntime(document);
  try {
    expect(inspection.api.query('SELECT COUNT(*) AS total FROM contacts')[0]?.total).toBe(0);
    expect(inspection.api.query('SELECT COUNT(*) AS total FROM "__hvy_row_components"')[0]?.total).toBe(0);
  } finally {
    inspection.dispose();
  }
});

test('database-table migrates and removes presentation settings when physical columns change', () => {
  const config = readDbTableConfig({
    table: 'contacts',
    columns: { company: { label: 'Organization', width: '14rem' }, notes: { wrap: true } },
  });

  expect(renameDbTableSourceColumnConfig(config, 'company', 'relationship')).toEqual({
    columns: { relationship: { label: 'Organization', width: '14rem' }, notes: { wrap: true } },
  });
  expect(removeDbTableColumnConfig(config, 'company')).toEqual({
    columns: { notes: { wrap: true } },
  });
  expect(renameDbTableSourceColumnConfig(readDbTableConfig({ table: 'contacts' }), 'organization_id', 'company_id')).toEqual({
    columns: { company_id: { label: 'Organization Id' } },
  });
});

test('a host source without writes is read-only even when its page claims to be editable', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  setHostDatabaseTableSources([{
    id: 'read-only-warehouse',
    async readPage(request) {
      return {
        objectType: 'table',
        editable: true,
        queryActive: false,
        columns: [{ name: 'name', type: 'text', notNull: false, defaultValue: null, primaryKeyOrder: 0, generated: false, foreignKey: null }],
        rows: [{ rowId: 1, hasAttachedComponent: false, values: { name: 'Example' } }],
        offset: request.offset,
        hasNextPage: false,
        hasTriggers: false,
      };
    },
  }]);

  try {
    const config = readDbTableConfig({ source: 'read-only-warehouse', table: 'work_items' });

    const expectedResult = await loadDbTableSourcePage(document, config, {
      query: '',
      offset: 0,
      sortColumn: null,
      sortDirection: null,
    });

    expect(expectedResult.editable).toBe(false);
    expect(getDbTableWriter(config)).toBe(null);
  } finally {
    setHostDatabaseTableSources([]);
  }
});

test('a host source that implements writes gets the same editing contract as the attached file', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const calls: string[] = [];
  const column = { name: 'name', type: 'text', notNull: false, defaultValue: null, primaryKeyOrder: 0, generated: false, foreignKey: null };
  setHostDatabaseTableSources([{
    id: 'writable-warehouse',
    async readPage(request) {
      return {
        objectType: 'table',
        editable: true,
        queryActive: false,
        columns: [column],
        rows: [{ rowId: 1, hasAttachedComponent: false, values: { name: 'Example' } }],
        offset: request.offset,
        hasNextPage: false,
        hasTriggers: false,
      };
    },
    write: {
      undo: 'logical',
      async createTable({ table }) { calls.push(`createTable:${table}`); },
      async addColumn({ table }) { calls.push(`addColumn:${table}`); return 'Column 1'; },
      async addNamedColumn({ table }, name) { calls.push(`addNamedColumn:${table}:${name}`); },
      async dropColumn({ table }, name) { calls.push(`dropColumn:${table}:${name}`); },
      async renameColumn({ table }, from, to) { calls.push(`renameColumn:${table}:${from}->${to}`); return to; },
      async updateCell({ table }, rowId, target, value) { calls.push(`updateCell:${table}:${rowId}:${target.name}=${String(value)}`); },
      async insertRow({ table }, values) { calls.push(`insertRow:${table}:${values.length}`); return { rowId: 7, values: {} }; },
      async deleteRow({ table }, rowId) { calls.push(`deleteRow:${table}:${rowId}`); },
      async restoreRow({ table }, row) { calls.push(`restoreRow:${table}:${row.rowId}`); },
    },
  }]);

  try {
    const config = readDbTableConfig({ source: 'writable-warehouse', table: 'work_items' });
    const request = { document, table: 'work_items' };

    const page = await loadDbTableSourcePage(document, config, { query: '', offset: 0, sortColumn: null, sortDirection: null });
    const writer = getDbTableWriter(config);
    if (!writer) throw new Error('A source declaring writes must expose a writer.');

    await writer.createTable(request);
    await writer.addColumn(request);
    await writer.addNamedColumn(request, 'Notes');
    await writer.renameColumn(request, 'Notes', 'Detail');
    await writer.updateCell(request, 1, column, 'Renamed');
    await writer.insertRow(request, [{ column, value: 'New' }]);
    await writer.deleteRow(request, 7);
    await writer.restoreRow(request, { rowId: 7, values: { name: 'New' } });
    await writer.dropColumn(request, 'Detail');

    expect(page.editable).toBe(true);
    expect(calls).toEqual([
      'createTable:work_items',
      'addColumn:work_items',
      'addNamedColumn:work_items:Notes',
      'renameColumn:work_items:Notes->Detail',
      'updateCell:work_items:1:name=Renamed',
      'insertRow:work_items:1',
      'deleteRow:work_items:7',
      'restoreRow:work_items:7',
      'dropColumn:work_items:Detail',
    ]);
  } finally {
    setHostDatabaseTableSources([]);
  }
});
