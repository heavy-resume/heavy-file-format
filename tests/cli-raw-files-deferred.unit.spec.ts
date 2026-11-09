import { beforeEach, expect, test, vi } from 'vitest';

import { createHvyCliSession, executeHvyCliCommand, executeHvyCliCommandSync } from '../src/cli-core/commands';
import { deserializeDocument, serializeBlockFragment } from '../src/serialization';

vi.mock('../src/serialization', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/serialization')>();
  return { ...original, serializeBlockFragment: vi.fn(original.serializeBlockFragment) };
});

const fakeSource = `---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Fake label"}}-->
fields:
  - label: Fake field
    type: text

<!--hvy:text {"id":"fake-text"}-->
Fake text
`;

function createFakeDocument(source = fakeSource) {
  return deserializeDocument(source, '.hvy');
}

beforeEach(() => {
  vi.mocked(serializeBlockFragment).mockClear();
});

test('reading and editing a plugin file does not generate raw files', () => {
  const document = createFakeDocument();
  const session = createHvyCliSession();

  const expectedRead = executeHvyCliCommandSync(document, 'cat /id/fake-form/plugin.json', session);
  executeHvyCliCommandSync(document, `sed -i 's/Fake label/Changed label/' /id/fake-form/plugin.json`, session);

  expect(expectedRead.output).toContain('Fake label');
  expect(executeHvyCliCommandSync(document, 'cat /id/fake-form/plugin.json', session).output).toContain('Changed label');
  expect(vi.mocked(serializeBlockFragment)).not.toHaveBeenCalled();
});

test('listing a component still shows its raw file', () => {
  const document = createFakeDocument();
  const session = createHvyCliSession();
  executeHvyCliCommandSync(document, 'cat /id/fake-form/plugin.json', session);

  expect(executeHvyCliCommandSync(document, 'ls /id/fake-text', session).output).toContain('raw.hvy');
});

test('find and grep still reach raw files', () => {
  const document = createFakeDocument();
  const session = createHvyCliSession();
  executeHvyCliCommandSync(document, 'cat /id/fake-form/plugin.json', session);

  expect(executeHvyCliCommandSync(document, 'find /body', session).output).toContain('raw.hvy');
});

test('a raw file read after an edit shows the edited content', () => {
  const document = createFakeDocument();
  const session = createHvyCliSession();
  executeHvyCliCommandSync(document, `sed -i 's/Fake label/Changed label/' /id/fake-form/plugin.json`, session);

  expect(executeHvyCliCommandSync(document, 'cat /id/fake-form/raw.hvy', session).output).toContain('Changed label');
});

test('a raw file is reachable directly and through its id alias', () => {
  const document = createFakeDocument();
  const session = createHvyCliSession();

  expect(executeHvyCliCommandSync(document, 'cat /id/fake-text/raw.hvy', session).output).toContain('Fake text');
  expect(executeHvyCliCommandSync(document, 'cat /raw.hvy', session).output).toContain('Fake text');
});

test('a component over the raw size limit offers a preview instead', () => {
  const document = createFakeDocument(fakeSource.replace('Fake text', 'Fake text '.repeat(600)));
  const session = createHvyCliSession();

  const expectedListing = executeHvyCliCommandSync(document, 'ls /id/fake-text', session).output;

  expect(expectedListing).toContain('raw-preview.hvy.txt');
  expect(expectedListing).not.toContain('file raw.hvy');
  expect(() => executeHvyCliCommandSync(document, 'cat /id/fake-text/raw.hvy', session)).toThrow();
});

test('a failed raw write keeps its draft across a deferred session', async () => {
  const document = createFakeDocument();
  const session = createHvyCliSession();
  executeHvyCliCommandSync(document, 'cat /id/fake-form/plugin.json', session);

  await expect(executeHvyCliCommand(document, session, 'echo "<!--hvy:nope" > /id/fake-text/raw.hvy')).rejects.toThrow('did not parse');

  expect((await executeHvyCliCommand(document, session, 'cat /id/fake-text/raw.wip.hvy')).output).toBe('<!--hvy:nope\n');
});
