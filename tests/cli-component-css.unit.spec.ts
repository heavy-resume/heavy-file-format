import { expect, test } from 'vitest';

import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument, serializeDocument } from '../src/serialization';

function createCssCliTestDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
title: CLI CSS Test
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro","css":"margin: 0.5rem 0;"}-->
 Hello world
`, '.hvy');
}

test('component css file mirrors the component json css field', async () => {
  const document = createCssCliTestDocument();
  const session = createHvyCliSession();

  const listResult = await executeHvyCliCommand(document, session, 'ls /body/summary/intro');
  const cssResult = await executeHvyCliCommand(document, session, 'cat /body/summary/intro/text.css');

  expect(listResult.output).toContain('file text.css [w] | text component CSS mirrored from config');
  expect(cssResult.output).toBe('margin: 0.5rem 0;');
});

test('component css file writes back to the component json config', async () => {
  const document = createCssCliTestDocument();
  const session = createHvyCliSession();

  const writeResult = await executeHvyCliCommand(document, session, 'printf "margin: 0.25rem 0;" > /body/summary/intro/text.css');
  const cssResult = await executeHvyCliCommand(document, session, 'cat /body/summary/intro/text.css');
  const jsonResult = await executeHvyCliCommand(document, session, 'cat /body/summary/intro/text.json');
  const serialized = serializeDocument(document);

  expect(writeResult.output).toBe('/body/summary/intro/text.css: written');
  expect(writeResult.mutated).toBe(true);
  expect(cssResult.output).toBe('margin: 0.25rem 0;');
  expect(jsonResult.output).toContain('"css": "margin: 0.25rem 0;"');
  expect(serialized).toContain('<!--hvy:text {"id":"intro","css":"margin: 0.25rem 0;"}-->');
});
