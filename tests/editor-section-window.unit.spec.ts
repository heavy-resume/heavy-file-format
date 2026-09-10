import { expect, test } from 'vitest';

import { createEmptySection } from '../src/document-factory';
import { createRenderTreeHeightLedger } from '../src/render-tree-window';
import { createEditorSectionRenderTreeNode, EDITOR_SECTION_TREE_LAYOUT } from '../src/editor/editor-render-tree-window';

test('editor section height ledger plans only the visible window for large documents', () => {
  const sections = Array.from({ length: 40 }, (_item, index) => {
    const section = createEmptySection(1, `Section ${index + 1}`);
    section.key = `section-${index + 1}`;
    return section;
  });
  const ledger = createRenderTreeHeightLedger();

  const initialExpectedResult = ledger.plan(sections.map(createEditorSectionRenderTreeNode), { scrollTop: 0, viewportHeight: 800 }, EDITOR_SECTION_TREE_LAYOUT);
  const documentHeight = initialExpectedResult.reduce((total, entry) => total + entry.estimatedHeight, 0);
  const bottomExpectedResult = ledger.plan(sections.map(createEditorSectionRenderTreeNode), {
    scrollTop: documentHeight - 800,
    viewportHeight: 800,
  }, EDITOR_SECTION_TREE_LAYOUT);

  expect(initialExpectedResult.filter((entry) => entry.shouldRender).length).toBeLessThan(sections.length);
  expect(initialExpectedResult[0]?.shouldRender).toBe(true);
  expect(initialExpectedResult.at(-1)?.shouldRender).toBe(false);
  expect(bottomExpectedResult[0]?.shouldRender).toBe(false);
  expect(bottomExpectedResult.at(-1)?.shouldRender).toBe(true);
});

test('editor section height ledger records measurements and always includes forced sections', () => {
  const sections = Array.from({ length: 40 }, (_item, index) => {
    const section = createEmptySection(1, `Section ${index + 1}`);
    section.key = `section-${index + 1}`;
    return section;
  });
  const ledger = createRenderTreeHeightLedger();
  const measuredSection = sections[30];
  if (!measuredSection) throw new Error('Expected measured section');

  ledger.record(createEditorSectionRenderTreeNode(measuredSection), 920);
  const expectedResult = ledger.plan(sections.map(createEditorSectionRenderTreeNode), {
    scrollTop: 0,
    viewportHeight: 800,
    forceNodeKeys: new Set([measuredSection.key]),
  }, EDITOR_SECTION_TREE_LAYOUT);

  expect(expectedResult[30]).toMatchObject({ estimatedHeight: 920, shouldRender: true });
});
