import { expect, test } from 'vitest';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import { findSortValueOwnerBlock, getListValueBindingChoices, normalizeSortValueDefs, renameListValueKey, setSortValueAnnotationText, syncSortValuesForDocument } from '../src/sort-values';
import { markdownToReaderHtml } from '../src/markdown';
import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { defaultBlockSchema } from '../src/document-factory';
import { applyHvyPatch } from '../src/chat-cli/hvy-patch';
import { createScriptingRuntime } from '../src/plugins/scripting/runtime';

test('binding choices expose manual keys without changing definitions or overriding configured types', () => {
  const document = groupDocument();
  const item = document.sections[0].blocks[0].schema.componentListBlocks[0];
  item.schema.groupKeys.Status = 'waiting';
  item.schema.sortKeys['Fake Rank'] = 12;
  const before = serializeDocument(document);
  expect(getListValueBindingChoices(document.meta, item, 'group')).toEqual({
    Manual: { type: 'text' }, Category: { type: 'text' },
    Status: { type: 'enum', options: [{ label: 'Fake Ready', value: 'ready' }, { label: 'Fake Waiting', value: 'waiting' }] },
  });
  expect(getListValueBindingChoices(document.meta, item, 'sort')).toEqual({
    Category: { type: 'number' }, 'Fake Rank': { type: 'number' },
  });
  expect(serializeDocument(document)).toBe(before);
});

function groupDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-record
    baseType: container
    sortValueDefs:
      Category: {type: number}
    groupValueDefs:
      Category: {type: text}
      Status:
        type: enum
        options:
          - {label: Fake Ready, value: ready}
          - {label: Fake Waiting, value: waiting}
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

 <!--hvy:component-list {"id":"fake-list","componentListComponent":"fake-record","componentListDefaultGroupKey":"Category"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:fake-record {"id":"fake-item","groupKeys":{"Manual":"keep"}}-->

    <!--hvy:text {"id":"fake-text"}-->
     <!--hvy:group-value {"key":"Category"}--> Fake Blue <!--/hvy:group-value-->
     <!--hvy:sort-value {"key":"Category"}-->12<!--/hvy:sort-value-->

    <!--hvy:table {"id":"fake-table","tableColumns":["Status"]}-->
     | Status |
     | --- |
     | <!--hvy:group-value {"key":"Status"}-->Fake Ready<!--/hvy:group-value--> |

    <!--hvy:plugin {"id":"fake-plugin","plugin":"fake.provider","pluginGroupValues":{}}-->
`, '.hvy');
}

test('group annotations in text and table cells update string keys independently of sorting', () => {
  const document = groupDocument();
  const item = document.sections[0].blocks[0].schema.componentListBlocks[0];
  expect(item.schema.groupKeys).toEqual({ Manual: 'keep' });

  expect(syncSortValuesForDocument(document)).toBe(true);

  expect(item.schema.groupKeys).toEqual({ Manual: 'keep', Category: 'Fake Blue', Status: 'ready' });
  expect(item.schema.sortKeys).toEqual({ Category: 12 });
  expect(item.schema.derivedGroupKeyNames).toEqual(['Category', 'Status']);
  expect(syncSortValuesForDocument(document)).toBe(false);
  expect(setSortValueAnnotationText(item, 'Category', 'Fake Green', 'group')).toBe(1);
  syncSortValuesForDocument(document);
  expect(item.schema.groupKeys.Category).toBe('Fake Green');
  expect(item.schema.sortKeys.Category).toBe(12);
});

test('group values and declarations survive serialization and source removal clears only derived keys', () => {
  const document = groupDocument();
  const item = document.sections[0].blocks[0].schema.componentListBlocks[0];
  item.schema.containerBlocks[2].schema.pluginGroupValues = { Status: 'waiting' };
  syncSortValuesForDocument(document);
  expect(item.schema.groupKeys.Status).toBe('waiting');

  const expectedResult = serializeDocument(document);
  expect(expectedResult).toContain('groupValueDefs:');
  expect(expectedResult).toContain('"pluginGroupValues":{"Status":"waiting"}');
  expect(expectedResult).toContain('"derivedGroupKeyNames":["Category","Status"]');
  const restored = deserializeDocument(expectedResult, '.hvy');
  expect(restored.sections[0].blocks[0].schema.componentListBlocks[0].schema.groupKeys).toEqual(item.schema.groupKeys);
  item.schema.containerBlocks = [];
  syncSortValuesForDocument(document);
  expect(item.schema.groupKeys).toEqual({ Manual: 'keep' });
  expect(item.schema.derivedGroupKeyNames).toEqual([]);
});

test('invalid group sources preserve manual values and removed definitions clear derived values', () => {
  const document = groupDocument();
  const item = document.sections[0].blocks[0].schema.componentListBlocks[0];
  item.schema.groupKeys.Status = 'manual';
  setSortValueAnnotationText(item, 'Status', 'Fake Unknown', 'group');
  syncSortValuesForDocument(document);
  expect(item.schema.groupKeys).toEqual({ Manual: 'keep', Category: 'Fake Blue', Status: 'manual' });
  (document.meta.component_defs as Array<{groupValueDefs?: unknown}>)[0].groupValueDefs = {};
  syncSortValuesForDocument(document);
  expect(item.schema.groupKeys).toEqual({ Manual: 'keep', Status: 'manual' });
});

test('group definitions accept text and string enums only', () => {
  expect(normalizeSortValueDefs({
    Text: { type: 'text' }, Number: { type: 'number' },
    Enum: { type: 'enum', options: [{ label: 'Fake A', value: 'a' }, { label: 'Fake B', value: 2 }] },
  }, 'group')).toEqual({ Text: { type: 'text' }, Enum: { type: 'enum', options: [{ label: 'Fake A', value: 'a' }] } });
});

test('group annotation renders visible text in readers and preserves its kind in editor markup', () => {
  const source = '<!--hvy:group-value {"key":"Category"}-->Fake Blue<!--/hvy:group-value-->';
  expect(markdownToReaderHtml(source)).toContain('Fake Blue');
  expect(markdownToReaderHtml(source)).not.toContain('hvy:group-value');
  expect(markdownToReaderHtml(source, { preserveSortValueAnnotations: true })).toContain('data-value-kind="group"');
});

test('CLI edits to group annotation sources update the materialized item key', async () => {
  const document = groupDocument();
  const session = createHvyCliSession();
  syncSortValuesForDocument(document);
  expect(document.sections[0].blocks[0].schema.componentListBlocks[0].schema.groupKeys.Category).toBe('Fake Blue');

  await executeHvyCliCommand(document, session, "sed -i 's/Fake Blue/Fake Green/' /id/fake-text/text.txt");

  expect(document.sections[0].blocks[0].schema.componentListBlocks[0].schema.groupKeys.Category).toBe('Fake Green');
});

test('AI patches and plugin JSON edits materialize group values and clearing declarations restores text sources', async () => {
  const document = groupDocument();
  const session = createHvyCliSession();
  const item = document.sections[0].blocks[0].schema.componentListBlocks[0];
  syncSortValuesForDocument(document);
  expect(item.schema.groupKeys.Category).toBe('Fake Blue');

  expect(applyHvyPatch(document, session, `*** Begin Patch
*** Update File: /id/fake-text/text.txt
@@
-<!--hvy:group-value {"key":"Category"}--> Fake Blue <!--/hvy:group-value-->
+<!--hvy:group-value {"key":"Category"}--> Fake Pink <!--/hvy:group-value-->
*** End Patch`).failedFileCount).toBe(0);

  expect(item.schema.groupKeys.Category).toBe('Fake Pink');
  await executeHvyCliCommand(document, session, `echo '{"id":"fake-plugin","plugin":"fake.provider","pluginGroupValues":{"Status":"waiting"}}' > /id/fake-plugin/plugin.json`);
  expect(item.schema.groupKeys.Status).toBe('waiting');
  await executeHvyCliCommand(document, session, `echo '{"id":"fake-plugin","plugin":"fake.provider","pluginGroupValues":{}}' > /id/fake-plugin/plugin.json`);
  expect(item.schema.groupKeys.Status).toBe('ready');
});

test('removing a source with the CLI clears its derived key and preserves unrelated manual keys', async () => {
  const document = groupDocument();
  const session = createHvyCliSession();
  const item = document.sections[0].blocks[0].schema.componentListBlocks[0];
  syncSortValuesForDocument(document);
  expect(item.schema.groupKeys.Category).toBe('Fake Blue');

  await executeHvyCliCommand(document, session, 'hvy remove /body/fake-section/fake-list/fake-item/container/fake-text');

  expect(item.schema.groupKeys).toEqual({ Manual: 'keep', Status: 'ready' });
  expect(item.schema.derivedGroupKeyNames).toEqual(['Status']);
});

test('renaming a group key updates sources, declarations, derived keys and defaults without renaming the sort key', () => {
  const document = groupDocument();
  const list = document.sections[0].blocks[0];
  const item = list.schema.componentListBlocks[0];
  item.schema.containerBlocks[2].schema.pluginGroupValues.Category = 'Fake Plugin';
  syncSortValuesForDocument(document);
  expect(item.schema.groupKeys.Category).toBe('Fake Plugin');

  expect(renameListValueKey(document, 'fake-record', 'Category', 'Fake Category', 'group')).toBe(true);

  expect(list.schema.componentListDefaultGroupKey).toBe('Fake Category');
  expect(item.schema.groupKeys).toEqual({ Manual: 'keep', Status: 'ready', 'Fake Category': 'Fake Plugin' });
  expect(item.schema.derivedGroupKeyNames).toEqual(['Fake Category', 'Status']);
  expect(item.schema.sortKeys).toEqual({ Category: 12 });
  expect(item.schema.containerBlocks[0].text).toContain('hvy:group-value {"key":"Fake Category"}');
  expect(item.schema.containerBlocks[0].text).toContain('hvy:sort-value {"key":"Category"}');
  expect(item.schema.containerBlocks[2].schema.pluginGroupValues).toEqual({ 'Fake Category': 'Fake Plugin' });
});

test('nested list sources belong to the nearest item only', () => {
  const document = groupDocument();
  const outerItem = document.sections[0].blocks[0].schema.componentListBlocks[0];
  const innerItem = {
    id: 'fake-inner-item', schemaMode: false,
    text: '<!--hvy:group-value {"key":"Category"}-->Fake Inner<!--/hvy:group-value-->',
    schema: defaultBlockSchema('fake-record', 'text'),
  };
  const innerList = { id: 'fake-inner-list', schemaMode: false, text: '', schema: defaultBlockSchema('component-list') };
  innerList.schema.componentListBlocks = [innerItem];
  outerItem.schema.containerBlocks.push(innerList);

  syncSortValuesForDocument(document);

  expect(outerItem.schema.groupKeys.Category).toBe('Fake Blue');
  expect(innerItem.schema.groupKeys.Category).toBe('Fake Inner');
  expect(findSortValueOwnerBlock(document, innerItem.id)).toBe(innerItem);
});

test('scripting group setter changes annotation text and derives the group on commit', () => {
  const document = groupDocument();
  const runtime = createScriptingRuntime({ document });
  const item = document.sections[0].blocks[0].schema.componentListBlocks[0];
  const handle = (runtime.doc.tool('get_components', { component: 'fake-record' }) as Array<{set_group_value(key: string, value: string): number}>)[0];
  expect(item.schema.groupKeys).toEqual({ Manual: 'keep' });

  expect(handle.set_group_value('Category', 'Fake Script')).toBe(1);
  runtime.doc.rerender();

  expect(item.schema.groupKeys.Category).toBe('Fake Script');
  expect(item.schema.containerBlocks[0].text).toContain('<!--hvy:group-value {"key":"Category"}-->Fake Script<!--/hvy:group-value-->');
});
