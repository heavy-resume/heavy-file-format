import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';

import { findBlockInList, indexBlocksById } from '../src/block-ops';
import { deserializeDocumentBytes } from '../src/serialization';
import type { VisualBlock } from '../src/editor/types';

function collectIds(blocks: VisualBlock[], ids: string[] = []): string[] {
  for (const block of blocks) {
    ids.push(block.id);
    collectIds(block.schema.containerBlocks ?? [], ids);
    collectIds(block.schema.componentListBlocks ?? [], ids);
    collectIds(block.schema.expandableStubBlocks?.children ?? [], ids);
    collectIds(block.schema.expandableContentBlocks?.children ?? [], ids);
    collectIds(block.schema.encryptedBlock ? [block.schema.encryptedBlock] : [], ids);
    collectIds((block.schema.gridItems ?? []).map((item) => item.block), ids);
  }
  return ids;
}

const exampleFiles = readdirSync('examples').filter((file) => /\.(hvy|thvy|phvy)$/.test(file));

for (const file of exampleFiles) {
  test(`the block index finds what the block search finds in ${file}`, () => {
    const document = deserializeDocumentBytes(readFileSync(`examples/${file}`), file.slice(file.lastIndexOf('.')) as '.hvy');
    for (const section of document.sections) {
      const expectedResult = indexBlocksById(section.blocks);
      for (const id of collectIds(section.blocks)) {
        expect(expectedResult.get(id)).toBe(findBlockInList(section.blocks, id));
      }
    }
  });
}

test('the index keeps the first block when an id repeats, as the search does', () => {
  const first = { id: 'fake-repeat', schema: {} } as VisualBlock;
  const second = { id: 'fake-repeat', schema: {} } as VisualBlock;

  expect(indexBlocksById([first, second]).get('fake-repeat')).toBe(first);
  expect(findBlockInList([first, second], 'fake-repeat')).toBe(first);
});

test('the index reaches every slot a block can nest in', () => {
  const leaf = (id: string) => ({ id, schema: {} }) as VisualBlock;
  const parent = {
    id: 'fake-parent',
    schema: {
      containerBlocks: [leaf('fake-container')],
      componentListBlocks: [leaf('fake-list')],
      expandableStubBlocks: { children: [leaf('fake-stub')] },
      expandableContentBlocks: { children: [leaf('fake-content')] },
      encryptedBlock: leaf('fake-encrypted'),
      gridItems: [{ block: leaf('fake-grid') }],
    },
  } as unknown as VisualBlock;

  const expectedResult = [...indexBlocksById([parent]).keys()];

  expect(expectedResult.sort()).toEqual(['fake-container', 'fake-content', 'fake-encrypted', 'fake-grid', 'fake-list', 'fake-parent', 'fake-stub'].sort());
});
