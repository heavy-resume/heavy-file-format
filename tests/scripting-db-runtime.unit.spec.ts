import { expect, test } from 'vitest';

import { getAttachment } from '../src/attachments';
import { createScriptingDbRuntime } from '../src/plugins/db-table';
import { deserializeDocument } from '../src/serialization';
import { getDatabaseChangesSince, getDatabaseChangeRevision } from '../src/database-change-tracker';

test('createScriptingDbRuntime exposes query and execute against the document database', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  let mutated = 0;
  const runtime = await createScriptingDbRuntime(document, () => {
    mutated += 1;
  });

  try {
    expect(runtime.api.execute('CREATE TABLE chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL)')).toContain(
      'Rows affected: 0'
    );
    expect(runtime.api.execute('INSERT INTO chores (title) VALUES (:title)', { ':title': 'Sweep' })).toContain(
      'Rows affected: 1'
    );

    const expectedResult = runtime.api.query('SELECT title FROM chores WHERE title = ?', ['Sweep']);

    expect(expectedResult).toEqual([{ title: 'Sweep', 0: 'Sweep' }]);
    expect(mutated).toBe(2);
    expect(getAttachment(document, 'db')).not.toBeNull();
  } finally {
    runtime.dispose();
  }
});

test('createScriptingDbRuntime keeps SELECT statements on query', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const runtime = await createScriptingDbRuntime(document);

  try {
    expect(() => runtime.api.execute('SELECT 1')).toThrow('Use doc.db.query');
  } finally {
    runtime.dispose();
  }
});

test('database scripting lists tables and exposes tables updated since the supplied revision', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const initialRevision = getDatabaseChangeRevision(document);
  const writer = await createScriptingDbRuntime(document);
  try {
    writer.api.execute('CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT)');
    writer.api.execute('INSERT INTO contacts (name) VALUES (?)', ['Avery']);
  } finally {
    writer.dispose();
  }
  const changes = getDatabaseChangesSince(document, initialRevision);
  const reader = await createScriptingDbRuntime(document, undefined, changes);
  try {
    expect(reader.api.get_tables()).toEqual([{ name: 'contacts', removed: false }]);
    expect(reader.api.get_updated_tables()).toEqual([{ name: 'contacts', removed: false }]);
    expect(reader.api.get_updated_tables('contacts')).toEqual([{ name: 'contacts', removed: false }]);
    expect(reader.api.get_updated_tables('unrelated')).toEqual([]);
  } finally {
    reader.dispose();
  }
});

test('database scripting conservatively reports all tables when attribution is incomplete', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const writer = await createScriptingDbRuntime(document);
  try {
    writer.api.execute('CREATE TABLE contacts (id INTEGER PRIMARY KEY)');
    writer.api.execute('CREATE TABLE organizations (id INTEGER PRIMARY KEY)');
  } finally {
    writer.dispose();
  }
  const reader = await createScriptingDbRuntime(document, undefined, {
    revision: 3,
    tables: [],
    complete: false,
  });
  try {
    expect(reader.api.get_updated_tables()).toEqual([
      { name: 'contacts', removed: false },
      { name: 'organizations', removed: false },
    ]);
  } finally {
    reader.dispose();
  }
});
