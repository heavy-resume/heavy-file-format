import { expect, test } from 'vitest';

import { getAttachment, setAttachment } from '../src/attachments';
import { createScriptingDbRuntime } from '../src/plugins/db-table';
import { deserializeDocument } from '../src/serialization';
import type { VisualDocument } from '../src/types';

async function createDocumentWithTasks() {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const seed = await createScriptingDbRuntime(document);
  seed.api.execute('CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)');
  seed.api.execute("INSERT INTO tasks (title) VALUES ('Alpha')");
  seed.dispose();
  return document;
}

/** Reads the titles the saved attachment holds, ignoring anything only in the live connection. */
async function readSavedTitles(document: VisualDocument): Promise<unknown[]> {
  const saved = getAttachment(document, 'db')!;
  setAttachment(document, 'db', saved.meta, Uint8Array.from(saved.bytes));
  const reader = await createScriptingDbRuntime(document);
  const titles = reader.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title);
  reader.dispose();
  return titles;
}

test('a transaction spanning several execute calls is saved once when it commits', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const bytesBeforeTransaction = getAttachment(document, 'db')!.bytes;
  const runtime = await createScriptingDbRuntime(document);

  // ACTION
  runtime.api.execute('BEGIN');
  runtime.api.execute("INSERT INTO tasks (title) VALUES ('Bravo')");
  runtime.api.execute("INSERT INTO tasks (title) VALUES ('Charlie')");
  expect(getAttachment(document, 'db')!.bytes).toBe(bytesBeforeTransaction);
  runtime.api.execute('COMMIT');
  runtime.dispose();

  // AFTER
  expect(await readSavedTitles(document)).toEqual(['Alpha', 'Bravo', 'Charlie']);
});

test('a transaction rolled back through execute leaves the saved database unchanged', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const runtime = await createScriptingDbRuntime(document);
  runtime.api.execute('BEGIN');
  runtime.api.execute("INSERT INTO tasks (title) VALUES ('Discarded')");

  // ACTION
  runtime.api.execute('ROLLBACK');
  runtime.dispose();

  // AFTER
  expect(await readSavedTitles(document)).toEqual(['Alpha']);
});

test('disposing a runtime rolls back only the transaction that runtime left open', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const transactionOwner = await createScriptingDbRuntime(document);
  transactionOwner.api.execute('BEGIN');
  transactionOwner.api.execute("INSERT INTO tasks (title) VALUES ('Unfinished')");
  const bystander = await createScriptingDbRuntime(document);

  // ACTION
  bystander.dispose();
  expect(transactionOwner.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title)).toEqual(['Alpha', 'Unfinished']);
  transactionOwner.dispose();

  // AFTER
  const reader = await createScriptingDbRuntime(document);
  expect(reader.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title)).toEqual(['Alpha']);
  reader.dispose();
  expect(await readSavedTitles(document)).toEqual(['Alpha']);
});

test('connection settings survive saving the database', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const runtime = await createScriptingDbRuntime(document);
  runtime.api.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id))');
  runtime.api.query('PRAGMA foreign_keys = ON');

  // ACTION
  runtime.api.execute('INSERT INTO notes (task_id) VALUES (1)');

  // AFTER
  expect(runtime.api.query('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1, 0: 1 }]);
  expect(() => runtime.api.execute('INSERT INTO notes (task_id) VALUES (999)')).toThrow(/FOREIGN KEY constraint failed/u);
  runtime.api.query('PRAGMA foreign_keys = OFF');
  runtime.dispose();
});

test('settling an unfinished transaction with commit saves its changes', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const runtime = await createScriptingDbRuntime(document);
  runtime.api.execute('BEGIN');
  runtime.api.execute("INSERT INTO tasks (title) VALUES ('Kept')");

  // ACTION
  expect(runtime.settleUnfinishedTransaction('commit')).toBe(true);
  runtime.dispose();

  // AFTER
  expect(await readSavedTitles(document)).toEqual(['Alpha', 'Kept']);
});

test('settling with a commit SQLite rejects rolls back and rethrows the error', async () => {
  // BEFORE
  const document = await createDocumentWithTasks();
  const runtime = await createScriptingDbRuntime(document);
  runtime.api.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id))');
  runtime.api.query('PRAGMA foreign_keys = ON');
  runtime.api.execute('BEGIN');
  runtime.api.query('PRAGMA defer_foreign_keys = ON');
  runtime.api.execute("INSERT INTO tasks (title) VALUES ('Rejected')");
  runtime.api.execute('INSERT INTO notes (task_id) VALUES (999)');

  // ACTION
  expect(() => runtime.settleUnfinishedTransaction('commit')).toThrow(/FOREIGN KEY constraint failed/u);

  // AFTER
  expect(runtime.api.query('SELECT title FROM tasks ORDER BY id').map((row) => row.title)).toEqual(['Alpha']);
  runtime.api.query('PRAGMA foreign_keys = OFF');
  runtime.dispose();
  expect(await readSavedTitles(document)).toEqual(['Alpha']);
});
