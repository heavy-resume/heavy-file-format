import { expect, test } from 'vitest';

import { getAttachment } from '../src/attachments';
import { createScriptingDbRuntime } from '../src/plugins/db-table';
import { deserializeDocument } from '../src/serialization';

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
