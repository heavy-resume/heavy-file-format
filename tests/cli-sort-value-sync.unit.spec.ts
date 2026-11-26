import { expect, test } from 'vitest';

import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument } from '../src/serialization';
import { syncSortValuesForDocument } from '../src/sort-values';

function createFakeRecordDocument() {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-record
    baseType: container
    sortValueDefs:
      Fake Rank: {type: number}
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

 <!--hvy:component-list {"id":"fake-list","componentListComponent":"fake-record","componentListDefaultSortKey":"Fake Rank"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:fake-record {"id":"fake-item-a"}-->

    <!--hvy:text {"id":"fake-ranked-text"}-->
     Rank <!--hvy:sort-value {"key":"Fake Rank"}-->12<!--/hvy:sort-value-->

  <!--hvy:component-list:1 {}-->

   <!--hvy:fake-record {"id":"fake-item-b"}-->

    <!--hvy:text {"id":"fake-plain-text"}-->
     No rank yet
`, '.hvy');
  syncSortValuesForDocument(document);
  return document;
}

function sortKeysOf(document: ReturnType<typeof createFakeRecordDocument>) {
  return Object.fromEntries(document.sections[0]!.blocks[0]!.schema.componentListBlocks.map((item) => [item.schema.id, item.schema.sortKeys]));
}

async function writeThroughHeredoc(document: ReturnType<typeof createFakeRecordDocument>, session: ReturnType<typeof createHvyCliSession>, path: string, content: string) {
  await executeHvyCliCommand(document, session, `cat > ${path} <<'FAKE_EOF'\n${content}\nFAKE_EOF`);
}

test('moving a sort source between list items updates both items', async () => {
  const document = createFakeRecordDocument();
  const session = createHvyCliSession();
  expect(sortKeysOf(document)).toEqual({ 'fake-item-a': { 'Fake Rank': 12 }, 'fake-item-b': {} });

  await executeHvyCliCommand(document, session, 'mv /body/fake-section/fake-list/fake-item-a/container/fake-ranked-text /body/fake-section/fake-list/fake-item-b/container');

  expect(sortKeysOf(document)).toEqual({ 'fake-item-a': {}, 'fake-item-b': { 'Fake Rank': 12 } });
});

test('copying a sort source into another list item updates that item', async () => {
  const document = createFakeRecordDocument();
  const session = createHvyCliSession();

  await executeHvyCliCommand(document, session, 'cp -r /id/fake-ranked-text /id/fake-item-b/container/copied-rank');

  expect(sortKeysOf(document)).toEqual({ 'fake-item-a': { 'Fake Rank': 12 }, 'fake-item-b': { 'Fake Rank': 12 } });
});

test('rewriting a component through raw.hvy updates its list item', async () => {
  const document = createFakeRecordDocument();
  const session = createHvyCliSession();
  const raw = (await executeHvyCliCommand(document, session, 'cat /id/fake-ranked-text/raw.hvy')).output;

  await writeThroughHeredoc(document, session, '/id/fake-ranked-text/raw.hvy', raw.replace('>12<', '>15<'));

  expect(sortKeysOf(document)).toEqual({ 'fake-item-a': { 'Fake Rank': 15 }, 'fake-item-b': {} });
});

test('rewriting a section through raw.hvy updates the list items in it', async () => {
  const document = createFakeRecordDocument();
  const session = createHvyCliSession();
  const raw = (await executeHvyCliCommand(document, session, 'cat /body/fake-section/raw.hvy')).output;

  await writeThroughHeredoc(document, session, '/body/fake-section/raw.hvy', raw.replace('>12<', '>15<').replace('No rank yet', 'Rank <!--hvy:sort-value {"key":"Fake Rank"}-->40<!--/hvy:sort-value-->'));

  expect(sortKeysOf(document)).toEqual({ 'fake-item-a': { 'Fake Rank': 15 }, 'fake-item-b': { 'Fake Rank': 40 } });
});

test('rewriting the document through raw.hvy updates every list item', async () => {
  const document = createFakeRecordDocument();
  const session = createHvyCliSession();
  const raw = (await executeHvyCliCommand(document, session, 'cat /raw.hvy')).output;

  await writeThroughHeredoc(document, session, '/raw.hvy', raw.replace('>12<', '>15<'));

  expect(sortKeysOf(document)).toEqual({ 'fake-item-a': { 'Fake Rank': 15 }, 'fake-item-b': {} });
});

test('inserting a component and writing a sort source into it updates its list item', async () => {
  const document = createFakeRecordDocument();
  const session = createHvyCliSession();

  await executeHvyCliCommand(document, session, 'hvy insert -1 text /id/fake-item-b/container fake-new-text');
  await executeHvyCliCommand(document, session, `echo 'Rank <!--hvy:sort-value {"key":"Fake Rank"}-->7<!--/hvy:sort-value-->' > /id/fake-new-text/text.txt`);

  expect(sortKeysOf(document)).toEqual({ 'fake-item-a': { 'Fake Rank': 12 }, 'fake-item-b': { 'Fake Rank': 7 } });
});

test('removing a sort source clears its list item', async () => {
  const document = createFakeRecordDocument();
  const session = createHvyCliSession();

  await executeHvyCliCommand(document, session, 'rm -r /body/fake-section/fake-list/fake-item-a/container/fake-ranked-text');

  expect(sortKeysOf(document)).toEqual({ 'fake-item-a': {}, 'fake-item-b': {} });
});

test('inserting a section from a template syncs the list items it brings', async () => {
  const document = createFakeRecordDocument();
  const session = createHvyCliSession();
  await executeHvyCliCommand(document, session, 'cp -r /body/fake-section /templates/sections/fake-ranked-section');
  await executeHvyCliCommand(document, session, "sed -i 's/>12</>55</' /templates/sections/fake-ranked-section/template/fake-list/fake-item-a/container/fake-ranked-text/text.txt");

  await executeHvyCliCommand(document, session, 'hvy insert -1 section /body --from-template fake-ranked-section');

  const insertedItems = document.sections.at(-1)!.blocks[0]!.schema.componentListBlocks;
  expect(insertedItems.map((item) => item.schema.sortKeys)).toEqual([{ 'Fake Rank': 55 }, {}]);
});
