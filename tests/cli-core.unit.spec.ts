import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument } from '../src/serialization';

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
