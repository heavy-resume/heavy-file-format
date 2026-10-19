import { expect, test } from 'vitest';

import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument } from '../src/serialization';

// Insert commands must report, and cd into, the directory `ls` shows for the
// new node, even when the id needs path normalization or collides.
function createFakeDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-card
    baseType: container
    schema: {}
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section
`, '.hvy');
}

test.each([
  ['hvy insert -1 text /body/fake-section "Fake Text"', '/body/fake-section/fake-text'],
  ['hvy insert -1 text /body/fake-section --id "-fake-dash"', '/body/fake-section/fake-dash'],
  ['hvy insert -1 plugin /body/fake-section "Fake Plugin" hvy.fake', '/body/fake-section/fake-plugin'],
  ['hvy insert -1 plugin form /body/fake-section "Fake Form"', '/body/fake-section/fake-form'],
  ['hvy insert -1 plugin db-table /body/fake-section "Fake Table"', '/body/fake-section/fake-table'],
  ['hvy insert 0 section /body "Fake Other" "Fake Other"', '/body/fake-other'],
  ['hvy insert -1 text /templates/components/fake-card/schema "Fake Child"', '/templates/components/fake-card/schema/container/fake-child'],
])('%s reports and enters the listed directory', async (command, expectedPath) => {
  const document = createFakeDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, command);

  expect(result.output.split('\n')[0]).toMatch(new RegExp(`^${expectedPath}(: created)?$`));
  expect(session.cwd).toBe(expectedPath);
  expect((await executeHvyCliCommand(document, session, `ls ${expectedPath.replace(/\/[^/]+$/, '')}`)).output)
    .toContain(`dir  ${expectedPath.split('/').pop()}`);
});

test('hvy insert reports the deduplicated directory when a normalized id collides', async () => {
  const document = createFakeDocument();
  const session = createHvyCliSession();
  await executeHvyCliCommand(document, session, 'hvy insert -1 text /body/fake-section "Fake Text"');

  const result = await executeHvyCliCommand(document, session, 'hvy insert -1 text /body/fake-section fake-text');

  expect(result.output.split('\n')[0]).toBe('/body/fake-section/fake-text-2: created');
  expect(session.cwd).toBe('/body/fake-section/fake-text-2');
  expect((await executeHvyCliCommand(document, session, 'cat text.json')).output).toContain('"id": "fake-text"');
});

test('hvy insert under an /id parent reports the normalized, deduplicated directory under that alias', async () => {
  const document = createFakeDocument();
  const session = createHvyCliSession();
  await executeHvyCliCommand(document, session, 'hvy insert -1 text /id/fake-section "Fake Text"');

  const result = await executeHvyCliCommand(document, session, 'hvy insert -1 plugin /id/fake-section fake-text hvy.fake');

  expect(result.output.split('\n')[0]).toBe('/id/fake-section/fake-text-2: created');
  expect(session.cwd).toBe('/id/fake-section/fake-text-2');
  expect((await executeHvyCliCommand(document, session, 'ls /id/fake-section')).output).toContain('dir  fake-text-2');
});
