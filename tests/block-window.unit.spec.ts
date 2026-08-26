import { expect, test } from 'vitest';

import { createEmptyBlock } from '../src/document-factory';
import { createRenderTreeHeightLedger } from '../src/render-tree-window';
import { createEditorBlockRenderTreeNode, EDITOR_BLOCK_TREE_LAYOUT } from '../src/editor/editor-render-tree-window';
import { createReaderBlockRenderTreeNode, READER_BLOCK_TREE_LAYOUT } from '../src/reader/reader-render-tree-window';

function createBlocks(count: number) {
  return Array.from({ length: count }, (_item, index) => {
    const block = createEmptyBlock('text');
    block.id = `block-${index + 1}`;
    block.text = `Block ${index + 1}`;
    return block;
  });
}

test('reader block ledger keeps document-relative offsets while planning a giant section', () => {
  const blocks = createBlocks(100);
  const expectedResult = createRenderTreeHeightLedger().plan(blocks.map(createReaderBlockRenderTreeNode), {
    scrollTop: 3000,
    viewportHeight: 800,
    layoutOffsetTop: 1200,
  }, READER_BLOCK_TREE_LAYOUT);

  expect(expectedResult[0]?.offsetTop).toBe(1200);
  expect(expectedResult[0]?.shouldRender).toBe(false);
  expect(expectedResult.some((entry) => entry.shouldRender)).toBe(true);
  expect(expectedResult.at(-1)?.shouldRender).toBe(false);
});

test('editor block ledger records block measurements and preserves forced active blocks', () => {
  const blocks = createBlocks(100);
  const ledger = createRenderTreeHeightLedger();
  const activeBlock = blocks[90];
  if (!activeBlock) throw new Error('Expected active block');

  ledger.record(createEditorBlockRenderTreeNode(activeBlock), 640);
  const expectedResult = ledger.plan(blocks.map(createEditorBlockRenderTreeNode), {
    scrollTop: 0,
    viewportHeight: 800,
    forceNodeKeys: new Set([activeBlock.id]),
  }, EDITOR_BLOCK_TREE_LAYOUT);

  expect(expectedResult[90]).toMatchObject({ estimatedHeight: 640, shouldRender: true });
});

test('reader block ledger gives cells in the same grid row a shared document offset', () => {
  const expectedResult = createRenderTreeHeightLedger().plan(createBlocks(90).map(createReaderBlockRenderTreeNode), {
    scrollTop: 4000,
    viewportHeight: 800,
    layoutOffsetTop: 200,
    layoutColumns: 3,
  }, READER_BLOCK_TREE_LAYOUT);

  expect(expectedResult[0]?.offsetTop).toBe(200);
  expect(expectedResult[1]?.offsetTop).toBe(200);
  expect(expectedResult[2]?.offsetTop).toBe(200);
  expect(expectedResult[3]?.offsetTop).toBeGreaterThan(200);
});
