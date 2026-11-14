import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';

import { createHvyCliSession, executeHvyCliCommand, executeHvyCliCommandSync, writeHvyVirtualFileSync } from '../src/cli-core/commands';
import { defaultBlockSchema } from '../src/document-factory';
import { buildVirtualDirectoryBlockLookup, findVirtualDirectoryForBlock } from '../src/cli-core/virtual-file-system';
import { deserializeDocument, deserializeDocumentBytes } from '../src/serialization';

function createFakeFormDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Fake label"}}-->
fields:
  - label: Fake field
    type: text
`, '.hvy');
}

test('a script added through plugin.txt is listed by the same session', () => {
  const document = createFakeFormDocument();
  const session = createHvyCliSession();
  expect(executeHvyCliCommandSync(document, 'ls /id/fake-form', session).output).not.toContain('fake_script.py');

  writeHvyVirtualFileSync(document, '/id/fake-form/plugin.txt', `fields:
  - label: Fake field
    type: text
scripts:
  fake_script: |
    print("fake")
`, session);

  const expectedResult = 'file fake_script.py [w] | Python/Brython script source exposed from a scripting or form plugin';
  expect(executeHvyCliCommandSync(document, 'ls /id/fake-form', session).output).toContain(expectedResult);
});

test('an edit made outside the CLI is visible to the next command in the same session', () => {
  const document = createFakeFormDocument();
  const session = createHvyCliSession();
  expect(executeHvyCliCommandSync(document, 'ls /body/fake-section', session).output).not.toContain('fake-text');

  document.sections[0]!.blocks.push({ id: 'fake-block', text: 'Fake text', schemaMode: false, schema: { ...defaultBlockSchema('text'), id: 'fake-text' } });

  expect(executeHvyCliCommandSync(document, 'cat /id/fake-text/text.txt', session).output).toBe('Fake text');
});

test('ls lists session files around a node\'s raw files in a fixed order', async () => {
  const document = createFakeFormDocument();
  const session = createHvyCliSession({ readOnlyFiles: { '/fake-readonly.txt': 'fake' } });
  await expect(executeHvyCliCommand(document, session, 'echo "<!--hvy:nope" > /id/fake-form/raw.hvy')).rejects.toThrow('did not parse');
  await expect(executeHvyCliCommand(document, session, 'echo "{ broken" > /id/fake-form/plugin.json')).rejects.toThrow('could not be applied');

  const rootListing = (await executeHvyCliCommand(document, session, 'ls /')).output;
  const formListing = (await executeHvyCliCommand(document, session, 'ls /id/fake-form')).output;

  const expectedRootOrder = ['header.yaml', 'templates', 'id', 'scratchpad.txt', 'fake-readonly.txt', 'raw.hvy'];
  expect(rootListing.split('\n').slice(1).map((line) => line.split(/\s+/)[1]).slice(-expectedRootOrder.length)).toEqual(expectedRootOrder);
  const expectedFormOrder = ['about-plugin.txt', 'raw.hvy', 'raw.wip.hvy', 'plugin.modified.json'];
  expect(formListing.split('\n\n')[0]!.split('\n').slice(1).map((line) => line.split(/\s+/)[1]).slice(-expectedFormOrder.length)).toEqual(expectedFormOrder);
});

const exampleFiles = readdirSync('examples').filter((file) => /\.(hvy|thvy|phvy)$/.test(file));

for (const file of exampleFiles) {
  test(`finding a block's directory from its ancestors gives the path the directory listing shows in ${file}`, () => {
    const document = deserializeDocumentBytes(readFileSync(`examples/${file}`), file.slice(file.lastIndexOf('.')) as '.hvy');
    const expectedResult = buildVirtualDirectoryBlockLookup(document);

    const pathsFromAncestors = new Map([...expectedResult.values()].map((block) => [findVirtualDirectoryForBlock(document, block), block]));

    expect(pathsFromAncestors).toEqual(expectedResult);
  });
}
