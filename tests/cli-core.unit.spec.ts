import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument, serializeDocument } from '../src/serialization';

function createCliTestDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
title: CLI Test
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro","css":"margin: 0.5rem 0;"}-->
 Hello world
`, '.hvy');
}

function createResumeCliTestDocument() {
  return deserializeDocument(readFileSync(fileURLToPath(new URL('../examples/resume.hvy', import.meta.url)), 'utf8'), '.hvy');
}

test('cli can navigate and read virtual component files', () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  expect(executeHvyCliCommand(document, session, 'ls /').output).toContain('body');
  expect(executeHvyCliCommand(document, session, 'cd /body/summary').cwd).toBe('/body/summary');
  expect(executeHvyCliCommand(document, session, 'cat intro/body.txt').output).toBe('Hello world');
  expect(executeHvyCliCommand(document, session, 'cat intro/text.json').output).toContain('"css": "margin: 0.5rem 0;"');
});

test('cli sed updates writable virtual files', () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const result = executeHvyCliCommand(document, session, 'sed s/world/there/ /body/summary/intro/body.txt');

  expect(result.mutated).toBe(true);
  expect(result.output).toContain('updated');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Hello there');
});

test('cli exposes resume component-list items by stable section paths', () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  expect(executeHvyCliCommand(document, session, 'ls /body').output).toContain('dir  tools-technologies');
  expect(executeHvyCliCommand(document, session, 'cd tools-technologies').cwd).toBe('/body/tools-technologies');
  expect(executeHvyCliCommand(document, session, 'pwd').output).toBe('/body/tools-technologies');
  expect(executeHvyCliCommand(document, session, 'find tool-typescript -name body.txt').output).toContain(
    '/body/tools-technologies/tool-typescript/body.txt'
  );
  expect(executeHvyCliCommand(document, session, 'cat tool-typescript/body.txt').output).toContain('Primary application language.');
});

test('cli accepts body section aliases from root and mutates resume virtual files', () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  expect(executeHvyCliCommand(document, session, 'cd /tools-technologies').cwd).toBe('/body/tools-technologies');

  const before = executeHvyCliCommand(document, session, 'find /body/tools-technologies/tool-typescript -name body.txt');
  expect(before.output).toContain('/body/tools-technologies/tool-typescript/body.txt');

  const result = executeHvyCliCommand(document, session, 'sed s/Primary/Core/ /body/tools-technologies/tool-typescript/body.txt');
  expect(result.mutated).toBe(true);
  expect(result.output).toBe('/body/tools-technologies/tool-typescript/body.txt: updated');
  expect(executeHvyCliCommand(document, session, 'cat /tools-technologies/tool-typescript/body.txt').output).toContain(
    'Core application language.'
  );
});

test('deserializing custom resume components does not warn about missing app state', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  createResumeCliTestDocument();

  expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('[hvy:component-defs]'));
  consoleError.mockRestore();
});

test('cli commands can create a chore chart with tables and form plugins', () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const session = createHvyCliSession();
  const run = (command: string) => executeHvyCliCommand(document, session, command);

  expect(run('hvy section add /body chore-chart "Chore Chart"').output).toBe('/body/chore-chart');
  run('hvy text add /chore-chart overview "Track active chores, assignments, completion forms, and weekly leaders."');
  run(
    'hvy table add /chore-chart active-chores "Chore,Dad,Mom,Child" --row "Dishes,,,Child" --row "Trash,Dad,," --row "Laundry,,Mom,"'
  );
  run('form add /chore-chart add-chore-form "Add chore" "description:Description:textarea:required"');
  run('form add /chore-chart assign-chore-form "Assign chore" "chore:Chore:text:required" "assignee:Assignee:select:required:Dad|Mom|Child"');
  run(
    'form add /chore-chart complete-chore-form "Complete chore" "chore:Chore:text:required" "completed_by:Completed by:select:required:Dad|Mom|Child"'
  );
  run('db-table add /chore-chart weekly-leaders weekly_chore_leaders "SELECT person, completed_count FROM weekly_chore_leaders ORDER BY completed_count DESC"');

  expect(run('find /chore-chart -name body.txt').output).toContain('/body/chore-chart/add-chore-form/body.txt');
  expect(run('cat /chore-chart/active-chores/table.json').output).toContain('"tableColumns": "Chore,Dad,Mom,Child"');
  expect(run('cat /chore-chart/assign-chore-form/body.txt').output).toContain('submitLabel: Assign chore');
  expect(run('cat /chore-chart/weekly-leaders/plugin.json').output).toContain('"table": "weekly_chore_leaders"');

  const serialized = serializeDocument(document);
  expect(serialized).toContain('<!--hvy:plugin {"id":"assign-chore-form","plugin":"dev.heavy.form"');
  expect(serialized).toContain('<!--hvy:plugin {"id":"weekly-leaders","plugin":"dev.heavy.db-table"');
  expect(serialized).toContain('"tableRows":[{"cells":["Dishes","","","Child"]}');
});
