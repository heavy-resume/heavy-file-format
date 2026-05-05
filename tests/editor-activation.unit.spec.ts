import { beforeAll, beforeEach, expect, test } from 'vitest';

import { setActiveEditorBlock } from '../src/block-ops';
import { deserializeDocument } from '../src/serialization';
import { initCallbacks, initState, state } from '../src/state';
import type { VisualBlock } from '../src/editor/types';
import { createTestState } from './serialization-test-helpers';

beforeAll(() => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
});

beforeEach(() => {
  initState(createTestState(deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:expandable {"id":"details"}-->
  <!--hvy:expandable:stub {}-->
    <!--hvy:text {"id":"stub-text"}-->
    Summary stub
  <!--hvy:expandable:content {}-->
    <!--hvy:expandable {"id":"nested"}-->
      <!--hvy:expandable:stub {}-->
        <!--hvy:text {"id":"nested-stub"}-->
        Nested stub
      <!--hvy:expandable:content {}-->
        <!--hvy:text {"id":"deep-text"}-->
        Deep text
`, '.hvy')));
});

test('setActiveEditorBlock opens expandable editor panels that contain the target block', () => {
  const details = findBlockBySchemaId('details');
  const nested = findBlockBySchemaId('nested');
  const deepText = findBlockBySchemaId('deep-text');
  const sectionKey = state.document.sections[0]?.key ?? '';

  setActiveEditorBlock(sectionKey, deepText.id);

  expect(state.activeEditorBlock).toEqual({ sectionKey, blockId: deepText.id });
  expect(state.expandableEditorPanels[`${sectionKey}:${details.id}`]).toEqual(expect.objectContaining({ expandedOpen: true }));
  expect(state.expandableEditorPanels[`${sectionKey}:${nested.id}`]).toEqual(expect.objectContaining({ expandedOpen: true }));
});

test('setActiveEditorBlock opens stub panels when the target is in expandable stub content', () => {
  const details = findBlockBySchemaId('details');
  const stubText = findBlockBySchemaId('stub-text');
  const sectionKey = state.document.sections[0]?.key ?? '';

  setActiveEditorBlock(sectionKey, stubText.id);

  expect(state.activeEditorBlock).toEqual({ sectionKey, blockId: stubText.id });
  expect(state.expandableEditorPanels[`${sectionKey}:${details.id}`]).toEqual(expect.objectContaining({ stubOpen: true }));
});

function findBlockBySchemaId(schemaId: string): VisualBlock {
  const block = findBlockInList(state.document.sections[0]?.blocks ?? [], schemaId);
  if (!block) {
    throw new Error(`Missing test block ${schemaId}`);
  }
  return block;
}

function findBlockInList(blocks: VisualBlock[], schemaId: string): VisualBlock | null {
  for (const block of blocks) {
    if (block.schema.id === schemaId) {
      return block;
    }
    const child =
      findBlockInList(block.schema.containerBlocks ?? [], schemaId)
      ?? findBlockInList(block.schema.componentListBlocks ?? [], schemaId)
      ?? findBlockInList(block.schema.expandableStubBlocks?.children ?? [], schemaId)
      ?? findBlockInList(block.schema.expandableContentBlocks?.children ?? [], schemaId)
      ?? findBlockInList((block.schema.gridItems ?? []).map((item) => item.block), schemaId);
    if (child) {
      return child;
    }
  }
  return null;
}
