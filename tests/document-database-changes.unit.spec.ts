import { expect, test } from 'vitest';

import { getDatabaseChangeRevision, getDatabaseChangesSince } from '../src/database-change-tracker';
import { createScriptingDbRuntime, materializeDocumentDbTables } from '../src/plugins/db-table';
import { deserializeDocument } from '../src/serialization';

async function createDocumentWithSchema(statements: string[], source = '---\nhvy_version: 0.1\n---\n') {
  const document = deserializeDocument(source, '.hvy');
  const seed = await createScriptingDbRuntime(document);
  seed.api.query('PRAGMA foreign_keys = ON');
  for (const statement of statements) seed.api.execute(statement);
  seed.dispose();
  return document;
}

test('a cascading delete reports the child table it changed', async () => {
  // BEFORE
  const document = await createDocumentWithSchema([
    'CREATE TABLE fake_orgs (id INTEGER PRIMARY KEY, name TEXT)',
    'CREATE TABLE fake_contacts (id INTEGER PRIMARY KEY, org_id INTEGER REFERENCES fake_orgs(id) ON DELETE CASCADE)',
    "INSERT INTO fake_orgs (name) VALUES ('Fake Org')",
    'INSERT INTO fake_contacts (org_id) VALUES (1)',
  ]);
  const revision = getDatabaseChangeRevision(document);
  const runtime = await createScriptingDbRuntime(document);

  // ACTION
  runtime.api.query('PRAGMA foreign_keys = ON');
  runtime.api.execute('DELETE FROM fake_orgs WHERE id = 1');
  runtime.dispose();

  // AFTER
  expect(getDatabaseChangesSince(document, revision)).toMatchObject({ tables: ['fake_contacts', 'fake_orgs'], complete: true });
});

test('a write that fires a trigger reports exactly the tables it changed', async () => {
  // BEFORE
  const document = await createDocumentWithSchema([
    'CREATE TABLE fake_orgs (id INTEGER PRIMARY KEY, name TEXT)',
    'CREATE TABLE fake_audit (message TEXT)',
    'CREATE TABLE fake_unrelated (value TEXT)',
    "CREATE TRIGGER fake_orgs_audit AFTER UPDATE ON fake_orgs BEGIN INSERT INTO fake_audit VALUES ('renamed'); END",
    "INSERT INTO fake_orgs (name) VALUES ('Fake Org')",
  ]);
  const revision = getDatabaseChangeRevision(document);
  const runtime = await createScriptingDbRuntime(document);

  // ACTION
  runtime.api.execute("UPDATE fake_orgs SET name = 'Renamed Org'");
  runtime.dispose();

  // AFTER
  expect(getDatabaseChangesSince(document, revision)).toMatchObject({ tables: ['fake_audit', 'fake_orgs'], complete: true });
});

test('schema changes report the table they changed', async () => {
  // BEFORE
  const document = await createDocumentWithSchema(['CREATE TABLE fake_orgs (id INTEGER PRIMARY KEY, name TEXT)']);
  const revision = getDatabaseChangeRevision(document);
  const runtime = await createScriptingDbRuntime(document);

  // ACTION
  runtime.api.execute('CREATE INDEX fake_orgs_by_name ON fake_orgs (name)');
  runtime.dispose();

  // AFTER
  expect(getDatabaseChangesSince(document, revision)).toMatchObject({ tables: ['fake_orgs'], complete: true });
});

test('row changes the update hook cannot see report every table', async () => {
  // BEFORE
  const document = await createDocumentWithSchema([
    'CREATE TABLE fake_tags (name TEXT PRIMARY KEY) WITHOUT ROWID',
    'CREATE TABLE fake_unrelated (value TEXT)',
  ]);
  const revision = getDatabaseChangeRevision(document);
  const runtime = await createScriptingDbRuntime(document);

  // ACTION
  runtime.api.execute("INSERT INTO fake_tags VALUES ('fake-tag')");
  runtime.dispose();

  // AFTER
  expect(getDatabaseChangesSince(document, revision)).toMatchObject({ complete: false });
});

test('creating configured db-table tables reports them as changed', async () => {
  // BEFORE
  const document = deserializeDocument(
    '---\nhvy_version: 0.1\n---\n\n#! Tasks\n\n <!--hvy:plugin {"plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"fake_tasks"}}-->\n',
    '.hvy'
  );
  const revision = getDatabaseChangeRevision(document);

  // ACTION
  await materializeDocumentDbTables(document);

  // AFTER
  expect(getDatabaseChangesSince(document, revision)).toMatchObject({ tables: ['fake_tasks'], complete: true });
});
