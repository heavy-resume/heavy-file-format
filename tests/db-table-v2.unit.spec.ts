import { expect, test } from 'vitest';

import { createScriptingDbRuntime } from '../src/plugins/db-table';
import {
  addDbTableV2Column,
  coerceDbTableV2Input,
  deleteDbTableV2Row,
  decodeDbTableV2OptionValue,
  dropDbTableV2Column,
  encodeDbTableV2OptionValue,
  insertDbTableV2Row,
  loadDbTableV2Snapshot,
  renameDbTableV2Column,
  updateDbTableV2Cell,
} from '../src/plugins/db-table-v2/db-table-v2-data';
import {
  normalizeDbTableV2ColumnWidth,
  readDbTableV2ColumnConfig,
  readDbTableV2Config,
  removeDbTableV2ColumnConfig,
  renameDbTableV2ColumnConfig,
  updateDbTableV2ColumnConfig,
} from '../src/plugins/db-table-v2/db-table-v2-config';
import { deserializeDocument } from '../src/serialization';
import { getDocumentDatabaseTableNames } from '../src/plugins/database-table-targets';
import { buildDocumentEditFormatInstructions } from '../src/ai-document-edit-instructions';
import { setHostDatabaseTableSources, type HvyDatabaseTablePageRequest } from '../src/plugins/database-table-source';

test('db-table-v2 reads simple foreign keys and configured display values', async () => {
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
  const expectedResult = await loadDbTableV2Snapshot(document, readDbTableV2Config({
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

test('db-table-v2 writes numeric relationship values and enforces foreign keys', async () => {
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
  const snapshot = await loadDbTableV2Snapshot(document, readDbTableV2Config({ table: 'contacts' }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });
  const relationshipColumn = snapshot.columns.find((column) => column.name === 'relationship_id')!;

  // TOOL CALL
  await updateDbTableV2Cell(document, 'contacts', 1, relationshipColumn, 2);

  // AFTER
  const inspection = await createScriptingDbRuntime(document);
  try {
    expect(inspection.api.query('SELECT relationship_id, typeof(relationship_id) AS storage_type FROM contacts')).toEqual([
      { relationship_id: 2, 0: 2, storage_type: 'integer', 1: 'integer' },
    ]);
  } finally {
    inspection.dispose();
  }
  await expect(updateDbTableV2Cell(document, 'contacts', 1, relationshipColumn, 999)).rejects.toThrow(/FOREIGN KEY constraint failed/u);
});

test('db-table-v2 inserts a complete staged row with one write', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const setup = await createScriptingDbRuntime(document);
  try {
    // BEFORE
    setup.api.execute('CREATE TABLE contacts (id INTEGER PRIMARY KEY, contact TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  } finally {
    setup.dispose();
  }
  const snapshot = await loadDbTableV2Snapshot(document, readDbTableV2Config({ table: 'contacts' }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });

  // TOOL CALL
  const inserted = await insertDbTableV2Row(document, 'contacts', [{
    column: snapshot.columns.find((column) => column.name === 'contact')!,
    value: 'Jane Smith',
  }]);

  // AFTER
  expect(inserted.rowId).toBe(1);
  expect(inserted.values.contact).toBe('Jane Smith');
  const expectedResult = await loadDbTableV2Snapshot(document, readDbTableV2Config({ table: 'contacts' }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });
  expect(expectedResult.rows).toHaveLength(1);
  expect(expectedResult.rows[0]?.values.contact).toBe('Jane Smith');
  expect(expectedResult.rows[0]?.values.created_at).toEqual(expect.any(String));
});

test('db-table-v2 column presentation defaults generated keys to compact and validates widths', () => {
  // BEFORE
  const config = readDbTableV2Config({ table: 'contacts' });

  // TOOL CALL
  const expectedResult = readDbTableV2ColumnConfig(config, 'id', { generated: true });

  // AFTER
  expect(expectedResult).toMatchObject({
    label: 'Id',
    visibility: 'compact',
    width: '5rem',
    wrap: false,
  });
  expect(normalizeDbTableV2ColumnWidth('18ch')).toBe('18ch');
  expect(normalizeDbTableV2ColumnWidth('calc(100% - 1rem)')).toBe('');
  expect(updateDbTableV2ColumnConfig(config, 'id', { visibility: 'hidden', width: '6rem' })).toEqual({
    columns: {
      id: { visibility: 'hidden', width: '6rem' },
    },
  });
});

test('db-table-v2 relationship option values preserve SQLite scalar types', () => {
  expect(decodeDbTableV2OptionValue(encodeDbTableV2OptionValue(14))).toBe(14);
  expect(decodeDbTableV2OptionValue(encodeDbTableV2OptionValue('14'))).toBe('14');
  expect(decodeDbTableV2OptionValue(encodeDbTableV2OptionValue(null))).toBeNull();
  expect(coerceDbTableV2Input('14', 'INTEGER')).toBe(14);
  expect(coerceDbTableV2Input('14', 'TEXT')).toBe('14');
});

test('db-table-v2 participates in shared database targeting and AI SQL tools', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"crm"}-->
#! CRM

<!--hvy:plugin {"plugin":"hvy.db-table-v2","pluginConfig":{"source":"with-file","table":"contacts"}}-->
`, '.hvy');

  expect(getDocumentDatabaseTableNames(document)).toEqual(['contacts']);
  expect(buildDocumentEditFormatInstructions({
    dbTableNames: ['contacts'],
    pluginHints: [{ name: 'hvy.db-table-v2', displayName: 'DB Table v2' }],
    request: 'Create the CRM database schema.',
  })).toContain('`execute_sql`');

  const externalDocument = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy:plugin {"plugin":"hvy.db-table-v2","pluginConfig":{"source":"postgresql","table":"contacts"}}-->
`, '.hvy');
  expect(getDocumentDatabaseTableNames(externalDocument)).toEqual([]);
});

test('db-table-v2 retains a migrated query limit as its page size', async () => {
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
  const migratedConfig = readDbTableV2Config({
    source: 'with-file',
    table: 'work_items',
    queryDynamicWindow: false,
    queryLimit: 2,
  });
  const expectedResult = await loadDbTableV2Snapshot(document, migratedConfig, {
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

test('db-table-v2 uses one bounded page size and preserves configured sources', () => {
  expect(readDbTableV2Config({ source: 'postgresql', table: 'work_items' })).toMatchObject({
    source: 'postgresql',
    queryLimit: 50,
  });
  expect(readDbTableV2Config({ table: 'work_items', queryLimit: 2_000 }).queryLimit).toBe(1_000);
  expect(readDbTableV2Config({ table: 'work_items', queryLimit: 0 }).queryLimit).toBe(1);
});

test('db-table-v2 delegates authored queries and paging to the selected source', async () => {
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
    const expectedResult = await loadDbTableV2Snapshot(document, readDbTableV2Config({
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

test('db-table-v2 carries forward schema editing and removes row-attached HVY with its row', async () => {
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
  expect(await addDbTableV2Column(document, 'contacts')).toBe('Column 3');
  await renameDbTableV2Column(document, 'contacts', 'Column 3', 'Notes');
  await dropDbTableV2Column(document, 'contacts', 'Column 2');
  const beforeDelete = await loadDbTableV2Snapshot(document, readDbTableV2Config({ table: 'contacts' }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });
  await deleteDbTableV2Row(document, 'contacts', 1);

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

test('db-table-v2 migrates and removes presentation settings when physical columns change', () => {
  const config = readDbTableV2Config({
    table: 'contacts',
    columns: { company: { label: 'Organization', width: '14rem' }, notes: { wrap: true } },
  });

  expect(renameDbTableV2ColumnConfig(config, 'company', 'relationship')).toEqual({
    columns: { relationship: { label: 'Organization', width: '14rem' }, notes: { wrap: true } },
  });
  expect(removeDbTableV2ColumnConfig(config, 'company')).toEqual({
    columns: { notes: { wrap: true } },
  });
});
