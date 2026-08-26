import { expect, test } from 'vitest';

import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { createRenderTreeHeightLedger } from '../src/render-tree-window';
import { createReaderSectionRenderTreeNode, READER_SECTION_TREE_LAYOUT } from '../src/reader/reader-render-tree-window';

test('reader section height ledger plans only the visible window for large documents', () => {
  const sections = Array.from({ length: 40 }, (_item, index) => {
    const section = createEmptySection(1, `Section ${index + 1}`);
    section.key = `section-${index + 1}`;
    const block = createEmptyBlock('text');
    block.id = `block-${index + 1}`;
    block.text = `Content ${index + 1}`;
    section.blocks.push(block);
    return section;
  });
  const ledger = createRenderTreeHeightLedger();

  const initialExpectedResult = ledger.plan(sections.map(createReaderSectionRenderTreeNode), { scrollTop: 0, viewportHeight: 800 }, READER_SECTION_TREE_LAYOUT);
  const documentHeight = initialExpectedResult.reduce((total, entry) => total + entry.estimatedHeight, 0);
  const bottomExpectedResult = ledger.plan(sections.map(createReaderSectionRenderTreeNode), {
    scrollTop: documentHeight - 800,
    viewportHeight: 800,
  }, READER_SECTION_TREE_LAYOUT);

  expect(initialExpectedResult.filter((entry) => entry.shouldRender).length).toBeLessThan(sections.length);
  expect(initialExpectedResult[0]?.shouldRender).toBe(true);
  expect(initialExpectedResult.at(-1)?.shouldRender).toBe(false);
  expect(bottomExpectedResult[0]?.shouldRender).toBe(false);
  expect(bottomExpectedResult.at(-1)?.shouldRender).toBe(true);
});

test('reader section height ledger records measurements and always includes forced sections', () => {
  const sections = Array.from({ length: 40 }, (_item, index) => {
    const section = createEmptySection(1, `Section ${index + 1}`);
    section.key = `section-${index + 1}`;
    return section;
  });
  const ledger = createRenderTreeHeightLedger();
  const measuredSection = sections[30];
  if (!measuredSection) throw new Error('Expected measured section');

  ledger.record(createReaderSectionRenderTreeNode(measuredSection), 720);
  const expectedResult = ledger.plan(sections.map(createReaderSectionRenderTreeNode), {
    scrollTop: 0,
    viewportHeight: 800,
    forceNodeKeys: new Set([measuredSection.key]),
  }, READER_SECTION_TREE_LAYOUT);

  expect(expectedResult[30]).toMatchObject({ estimatedHeight: 720, shouldRender: true });
});
