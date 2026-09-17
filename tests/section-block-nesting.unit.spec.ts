import { expect, test } from 'vitest';
import { buildSectionRenderSequence, getSectionInsertionBoundary, insertBlockAtSectionInsertionBoundary, moveBlockInVisualSequence, removeBlockFromSectionRenderSequence, visitBlocksInList, findBlockContainerInList } from '../src/section-ops';
import { findBlockInList, removeBlockFromList } from '../src/block-ops';
import { createEmptyBlock, createEmptySection, parseVisualBlock, schemaFromUnknown } from '../src/document-factory';

const makeBlock = createEmptyBlock;

test('visitBlocksInList skips already visited blocks to avoid recursive cycles', () => {
  const expandable = makeBlock('expandable');
  const child = makeBlock('text');
  expandable.schema.expandableContentBlocks.children = [child, expandable];
  const visited: string[] = [];

  visitBlocksInList([expandable], (block) => {
    visited.push(block.id);
  });

  expect(visited).toEqual([expandable.id, child.id]);
});

test('nested block lookup and removal skip already visited blocks to avoid recursive cycles', () => {
  const expandable = makeBlock('expandable');
  const child = makeBlock('text');
  expandable.schema.expandableContentBlocks.children = [child, expandable];

  expect(findBlockInList([expandable], child.id)).toBe(child);
  expect(findBlockContainerInList([expandable], child.id, null)).toEqual(expect.objectContaining({ ownerBlockId: expandable.id }));
  expect(removeBlockFromList([expandable], child.id)).toBe(true);
  expect(expandable.schema.expandableContentBlocks.children).toEqual([expandable]);
});

test('parseVisualBlock skips recursive raw block references', () => {
  const rawBlock: Record<string, unknown> = {
    id: 'outer',
    text: '',
    schema: {
      component: 'expandable',
      expandableContentBlocks: { children: [] },
    },
  };
  ((rawBlock.schema as Record<string, unknown>).expandableContentBlocks as { children: unknown[] }).children.push(rawBlock);

  const parsed = parseVisualBlock(rawBlock);

  expect(parsed.schema.component).toBe('expandable');
  expect(parsed.schema.expandableContentBlocks.children).toHaveLength(1);
  expect(parsed.schema.expandableContentBlocks.children[0]?.schema.component).toBe('container');
});

test('schemaFromUnknown skips recursive raw grid item references', () => {
  const rawBlock: Record<string, unknown> = {
    id: 'grid-child',
    text: '',
    schema: {
      component: 'grid',
      gridItems: [],
    },
  };
  ((rawBlock.schema as Record<string, unknown>).gridItems as unknown[]).push({ id: 'again', block: rawBlock });

  const schema = schemaFromUnknown(rawBlock.schema);

  expect(schema.gridItems).toHaveLength(1);
  expect(schema.gridItems[0]?.block.schema.component).toBe('container');
});


test('expected result: section insertion, movement, and removal preserve component order', () => {
  const section = createEmptySection('');
  const first = createEmptyBlock('text');
  const last = createEmptyBlock('container');
  section.blocks.push(first, last);
  expect(buildSectionRenderSequence(section).map(item => item.block)).toEqual([first, last]);

  const inserted = createEmptyBlock('text');
  expect(insertBlockAtSectionInsertionBoundary(section, inserted, getSectionInsertionBoundary(section, 1))).toBe(true);
  expect(section.blocks).toEqual([first, inserted, last]);
  expect(moveBlockInVisualSequence([section], section.key, inserted.id, 1)).toBe(true);
  expect(section.blocks).toEqual([first, last, inserted]);
  expect(removeBlockFromSectionRenderSequence(section, first.id)).toBe(true);
  expect(section.blocks).toEqual([last, inserted]);
  expect(moveBlockInVisualSequence([section], section.key, inserted.id, 1)).toBe(false);
  expect(insertBlockAtSectionInsertionBoundary(section, first, { beforeKind: 'block', beforeId: 'fake-missing' })).toBe(false);
  expect(section.blocks).toEqual([last, inserted]);
});
