import { expect, test } from 'vitest';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import { resolveTemplateFormTarget } from '../src/template-form-target';
import { registerSerializationTestState } from './serialization-test-helpers';

registerSerializationTestState();

const source = `---
hvy_version: 0.1
component_defs:
  - name: fake-entry
    baseType: text
    text: "{% title %}"
---

#! Fake main

<!--hvy:container {}-->
  <!--hvy:component-list {"id":"fake-list","componentListComponent":"fake-entry"}-->

`;

test('resolves a nested list by type and persisted ID after a save/reload', () => {
  const before = deserializeDocument(source, '.hvy');
  const target = resolveTemplateFormTarget(before, { targetType: 'fake-entry' });
  expect(target.block.schema.id).toBe('fake-list');
  expect(target.block).toBe(before.sections[0]!.blocks[0]!.schema.containerBlocks[0]);
  const after = deserializeDocument(serializeDocument(before), '.hvy');
  expect(resolveTemplateFormTarget(after, { targetId: 'fake-list' }).block.schema.id).toBe('fake-list');
  expect(resolveTemplateFormTarget(after, { targetId: 'fake-list', targetType: 'fake-entry' }).component).toBe('fake-entry');
});

test('requires an ID to disambiguate even when one matching list is locked', () => {
  const document = deserializeDocument(source + '\n<!--hvy:component-list {"id":"fake-other","componentListComponent":"fake-entry","lock":true}-->\n', '.hvy');
  expect(() => resolveTemplateFormTarget(document, { targetType: 'fake-entry' })).toThrow('provide targetId');
  expect(resolveTemplateFormTarget(document, { targetId: 'fake-list' }).component).toBe('fake-entry');
  expect(() => resolveTemplateFormTarget(document, { targetId: 'fake-other' })).toThrow('locked');
});

for (const [options, expected] of [
  [{}, 'requires targetId or targetType'],
  [{ targetId: 'fake-missing' }, 'No component list'],
  [{ targetType: 'fake-missing' }, 'No component list'],
  [{ targetId: 'fake-list', targetType: 'fake-other' }, 'does not match'],
] as const) {
  test(`rejects invalid target ${JSON.stringify(options)}`, () => {
    expect(() => resolveTemplateFormTarget(deserializeDocument(source, '.hvy'), options)).toThrow(expected);
  });
}

test('rejects non-list IDs, duplicate IDs, and templates without fields', () => {
  expect(() => resolveTemplateFormTarget(deserializeDocument(source + '\n<!--hvy:text {"id":"fake-text"}-->\nFake text\n', '.hvy'), { targetId: 'fake-text' })).toThrow('must be a component list');
  expect(() => resolveTemplateFormTarget(deserializeDocument(source + '\n  <!--hvy:component-list {"id":"fake-list","componentListComponent":"fake-entry"}-->\n', '.hvy'), { targetId: 'fake-list' })).toThrow('not unique');
  expect(() => resolveTemplateFormTarget(deserializeDocument(source.replace('{% title %}', 'Fake constant'), '.hvy'), { targetId: 'fake-list' })).toThrow('no form fields');
});


test('a locked ancestor does not lock its component list', () => {
  expect(resolveTemplateFormTarget(deserializeDocument(source.replace('hvy:container {}', 'hvy:container {"lock":true}'), '.hvy'), { targetType: 'fake-entry' }).block.schema.id).toBe('fake-list');
});

test('type-only resolution works without an authored list ID', () => {
  const target = resolveTemplateFormTarget(deserializeDocument(source.replace('"id":"fake-list",', ''), '.hvy'), { targetType: 'fake-entry' });
  expect(target.block.schema.id).toBe('');
  expect(target.component).toBe('fake-entry');
});
