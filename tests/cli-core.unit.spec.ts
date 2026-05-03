import { expect, test } from 'vitest';

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
