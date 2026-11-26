import { expect, test } from 'vitest';
import { gunzipSync } from 'fflate';

import { getAttachment, setAttachment } from '../src/attachments';
import { createScriptingDbRuntime, getDbTableRenderedText } from '../src/plugins/db-table';
import { loadDbTableSourcePage } from '../src/plugins/db-table/db-table-data';
import { readDbTableConfig } from '../src/plugins/db-table/db-table-config';
import { deserializeDocument } from '../src/serialization';

async function createDocumentWithTasks(source = '---\nhvy_version: 0.1\n---\n') {
  const document = deserializeDocument(source, '.hvy');
  const seed = await createScriptingDbRuntime(document);
  seed.api.execute('CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)');
  seed.api.execute("INSERT INTO tasks (title) VALUES ('Alpha')");
  seed.dispose();
  return document;
}

test('a long-lived script database runtime reads rows written after it opened', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const longLived = await createScriptingDbRuntime(document);
  expect(longLived.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title)).toEqual(['Alpha']);

  // ACTION
  const otherWriter = await createScriptingDbRuntime(document);
  otherWriter.api.execute("INSERT INTO tasks (title) VALUES ('Bravo')");
  otherWriter.dispose();

  // AFTER
  expect(longLived.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title)).toEqual(['Alpha', 'Bravo']);
  longLived.dispose();
});

test('a long-lived script database runtime write keeps rows written after it opened', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const longLived = await createScriptingDbRuntime(document);
  const otherWriter = await createScriptingDbRuntime(document);
  otherWriter.api.execute("INSERT INTO tasks (title) VALUES ('Bravo')");
  otherWriter.dispose();

  // ACTION
  longLived.api.execute("INSERT INTO tasks (title) VALUES ('Charlie')");
  longLived.dispose();

  // AFTER
  const reader = await createScriptingDbRuntime(document);
  expect(reader.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  reader.dispose();
});

test('a long-lived script database runtime follows an attachment replaced from outside', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const replacementAttachment = getAttachment(document, 'db')!;
  const longLived = await createScriptingDbRuntime(document);
  longLived.api.execute("INSERT INTO tasks (title) VALUES ('Replaced')");

  // ACTION
  setAttachment(document, 'db', replacementAttachment.meta, replacementAttachment.bytes);

  // AFTER
  expect(longLived.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title)).toEqual(['Alpha']);
  longLived.api.execute("INSERT INTO tasks (title) VALUES ('Delta')");
  expect(longLived.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title)).toEqual(['Alpha', 'Delta']);
  longLived.dispose();
});

test('a script database write to an uncompressed attachment saves it gzip-encoded', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const { encoding: _encoding, ...uncompressedMeta } = getAttachment(document, 'db')!.meta;
  setAttachment(document, 'db', uncompressedMeta, gunzipSync(getAttachment(document, 'db')!.bytes));

  // ACTION
  const writer = await createScriptingDbRuntime(document);
  writer.api.execute("INSERT INTO tasks (title) VALUES ('Bravo')");
  writer.dispose();

  // AFTER
  expect(getAttachment(document, 'db')!.meta.encoding).toBe('gzip');
  const reader = await createScriptingDbRuntime(document);
  expect(reader.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title)).toEqual(['Alpha', 'Bravo']);
  reader.dispose();
});

test('rendering a db-table does not add internal tables to the shared database', async () => {
  // BEFORE
  const document = await createDocumentWithTasks(
    '---\nhvy_version: 0.1\n---\n\n#! Tasks\n\n <!--hvy:plugin {"plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"tasks"}}-->\n'
  );
  const block = document.sections[0]!.blocks[0]!;

  // ACTION
  expect(await getDbTableRenderedText(document, block)).toContain('Alpha');

  // AFTER
  const reader = await createScriptingDbRuntime(document);
  expect(reader.api.get_tables()).toEqual([{ name: 'tasks', removed: false }]);
  reader.dispose();
});

test('reading a db-table page leaves the shared database foreign key setting as found', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();

  // ACTION
  const page = await loadDbTableSourcePage(document, readDbTableConfig({ table: 'tasks' }), {
    query: '',
    offset: 0,
    sortColumn: null,
    sortDirection: null,
  });

  // AFTER
  expect(page.rows.map((row) => row.values.title)).toEqual(['Alpha']);
  const reader = await createScriptingDbRuntime(document);
  expect(reader.api.query('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 0, 0: 0 }]);
  reader.dispose();
});
