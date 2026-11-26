import { beforeEach, expect, test, vi } from 'vitest';

import { stringifyYamlUnfolded } from '../src/hvy/yaml-stringify';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import type { JsonObject } from '../src/hvy/types';

vi.mock('../src/hvy/yaml-stringify', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/hvy/yaml-stringify')>();
  return { ...original, stringifyYamlUnfolded: vi.fn(original.stringifyYamlUnfolded) };
});

const fakeSource = `---
hvy_version: 0.1
fake_title: Fake title
component_defs:
  - name: fake-card
    baseType: text
    description: Fake description
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:text {"id":"fake-text"}-->
Fake text

<!--hvy:plugin {"id":"fake-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.2"}}-->
x = 1
`;

beforeEach(() => {
  vi.mocked(stringifyYamlUnfolded).mockClear();
});

test('serializing an unchanged document again reuses the header YAML', () => {
  const document = deserializeDocument(fakeSource, '.hvy');
  const firstResult = serializeDocument(document);
  const yamlCallsAfterFirst = vi.mocked(stringifyYamlUnfolded).mock.calls.length;

  const secondResult = serializeDocument(document);

  expect(secondResult).toBe(firstResult);
  expect(vi.mocked(stringifyYamlUnfolded).mock.calls.length).toBe(yamlCallsAfterFirst);
});

test('editing the body keeps the header YAML and still updates the body', () => {
  const document = deserializeDocument(fakeSource, '.hvy');
  serializeDocument(document);
  const yamlCallsBefore = vi.mocked(stringifyYamlUnfolded).mock.calls.length;

  document.sections[0]!.blocks[0]!.text = 'Changed fake text';

  expect(serializeDocument(document)).toContain('Changed fake text');
  expect(vi.mocked(stringifyYamlUnfolded).mock.calls.length).toBe(yamlCallsBefore);
});

test('a top-level header edit appears in the next serialization', () => {
  const document = deserializeDocument(fakeSource, '.hvy');
  expect(serializeDocument(document)).toContain('fake_title: Fake title');

  document.meta.fake_title = 'Changed title';

  const expectedResult = serializeDocument(document);
  expect(expectedResult).toContain('fake_title: Changed title');
  expect(expectedResult).not.toContain('fake_title: Fake title');
});

test('an in-place edit nested inside a component definition appears in the next serialization', () => {
  const document = deserializeDocument(fakeSource, '.hvy');
  expect(serializeDocument(document)).toContain('Fake description');

  (document.meta.component_defs as JsonObject[])[0]!.description = 'Changed description';

  const expectedResult = serializeDocument(document);
  expect(expectedResult).toContain('Changed description');
  expect(expectedResult).not.toContain('Fake description');
});

test('adding and removing a built-in plugin block updates the declared plugins', () => {
  const document = deserializeDocument(fakeSource.replace(/<!--hvy:plugin[\s\S]*$/, ''), '.hvy');
  expect(serializeDocument(document)).not.toContain('hvy.scripting');
  const withPlugin = deserializeDocument(fakeSource, '.hvy');
  const pluginBlock = withPlugin.sections[0]!.blocks[1]!;

  document.sections[0]!.blocks.push(pluginBlock);
  expect(serializeDocument(document)).toContain('id: hvy.scripting');

  document.sections[0]!.blocks.pop();
  expect(serializeDocument(document)).not.toContain('hvy.scripting');
});

test('two documents do not share a cached header', () => {
  const firstDocument = deserializeDocument(fakeSource, '.hvy');
  const secondDocument = deserializeDocument(fakeSource.replace('Fake title', 'Other title'), '.hvy');

  expect(serializeDocument(firstDocument)).toContain('fake_title: Fake title');
  expect(serializeDocument(secondDocument)).toContain('fake_title: Other title');
  expect(serializeDocument(firstDocument)).toContain('fake_title: Fake title');
});
