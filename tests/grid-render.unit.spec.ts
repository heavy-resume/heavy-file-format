import { beforeAll, beforeEach, expect, test } from 'vitest';

import { handleBlockFieldInput } from '../src/block-ops';
import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import { renderGridEditor, renderGridReader } from '../src/editor/components/grid/grid';
import { renderTextEditor } from '../src/editor/components/text/text';
import { initCallbacks, initState, state } from '../src/state';
import type { VisualDocument } from '../src/types';
import { createTestState } from './serialization-test-helpers';

class TestSelectElement {
  dataset: Record<string, string> = {};
  value = '';
}

function createHelpers(): ComponentRenderHelpers {
  return {
    escapeAttr: (value) => value,
    escapeHtml: (value) => value,
    markdownToEditorHtml: (markdown) => markdown,
    renderRichToolbar: () => '',
    renderEditorBlock: (_sectionKey, block) => `<div data-rendered="${block.schema.component}"></div>`,
    renderPassiveEditorBlock: () => '',
    renderReaderBlock: () => '',
    renderReaderBlocks: () => '',
    renderReaderListBlocks: () => '',
    orderReaderBlocks: (blocks) => blocks,
    orderReaderListBlocks: (blocks) => blocks,
    isReaderViewPrioritizedBlock: () => false,
    renderComponentFragment: (_componentName, content) => content,
    renderComponentOptions: (selected) => `<option selected>${selected}</option>`,
    renderAddComponentPicker: () => '',
    renderComponentPlacementTarget: () => '',
    renderOption: (value) => value,
    getDocumentComponentCss: () => '',
    getXrefTargetOptions: () => [],
    isXrefTargetValid: () => true,
    getTableColumns: () => ['Column 1', 'Column 2'],
    ensureContainerBlocks: () => {},
    ensureComponentListBlocks: () => {},
    getSelectedAddComponent: (_key, fallback) => fallback,
    getComponentListReaderViewId: () => '',
    getReaderContainerExpanded: (_key, fallback) => fallback,
    isExpandableEditorPanelOpen: () => false,
    isAdvancedEditorMode: () => false,
    isMobileAdjustmentMode: () => false,
  };
}

function createDocument(): VisualDocument {
  const section = createEmptySection(1, '');
  section.key = 'section-summary';
  section.customId = 'summary';
  const grid = createEmptyBlock('grid');
  grid.id = 'grid-block';
  section.blocks = [grid];
  return {
    meta: { hvy_version: 0.1 },
    extension: '.hvy',
    attachments: [],
    sections: [section],
  };
}

beforeAll(() => {
  if (!('HTMLSelectElement' in globalThis)) {
    Object.defineProperty(globalThis, 'HTMLSelectElement', {
      configurable: true,
      value: TestSelectElement,
    });
  }
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
});

beforeEach(() => {
  initState(createTestState(createDocument()));
});

test('grid editor renders a newly added blank text item without reading other component fields', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridItems.push({
    id: 'grid-item',
    block: createEmptyBlock('text'),
  });

  const expectedResult = renderGridEditor('section-summary', grid, createHelpers());

  expect(expectedResult).toContain('data-field="block-grid-item-component"');
  expect(expectedResult).toContain('data-rendered="text"');
});

test('grid editor applies grid item alignment to the edit shell', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridItems.push({
    id: 'right-item',
    align: 'right',
    block: createEmptyBlock('text'),
  });

  const expectedResult = renderGridEditor('section-summary', grid, createHelpers());

  expect(expectedResult).toContain('<div class="grid-item-editor-shell" style="text-align: right;">');
});

test('right-aligned grid item text editor has no default-left child override', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridItems.push({
    id: 'right-item',
    align: 'right',
    block: createEmptyBlock('text'),
  });

  const expectedResult = renderGridEditor('section-summary', grid, {
    ...createHelpers(),
    renderEditorBlock: (sectionKey, block) => renderTextEditor(sectionKey, block, createHelpers()),
  });

  expect(expectedResult).toContain('<div class="grid-item-editor-shell" style="text-align: right;">');
  expect(expectedResult).toContain('<div\n      class="rich-editor"');
  expect(expectedResult).not.toContain('style="text-align: left;"');
});

test('text editor omits inline style for default-left alignment', () => {
  const block = createEmptyBlock('text');
  block.text = 'Text';

  const expectedResult = renderTextEditor('section-summary', block, createHelpers());

  expect(expectedResult).not.toContain('text-align: left');
});

test('grid blank item component switch creates a complete schema for the selected component', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridItems.push({
    id: 'grid-item',
    block: createEmptyBlock('text'),
  });
  const expectedBlockId = grid.schema.gridItems[0]!.block.id;
  const select = new TestSelectElement() as unknown as HTMLSelectElement;
  select.dataset.field = 'block-grid-item-component';
  select.dataset.sectionKey = 'section-summary';
  select.dataset.blockId = 'grid-block';
  select.dataset.gridItemId = 'grid-item';
  select.value = 'image';

  handleBlockFieldInput(select);

  const expectedResult = grid.schema.gridItems[0]!.block;
  expect(expectedResult.id).toBe(expectedBlockId);
  expect(expectedResult.schema.kind).toBe('image');
  expect(expectedResult.schema.component).toBe('image');
  expect(expectedResult.schema.imageFile).toBe('');
});

test('grid reader applies grid item alignment to the cell', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridItems.push({
    id: 'left-item',
    block: createEmptyBlock('text'),
  });
  grid.schema.gridItems.push({
    id: 'right-item',
    align: 'right',
    block: createEmptyBlock('text'),
  });

  const expectedResult = renderGridReader(state.document.sections[0]!, grid, {
    ...createHelpers(),
    renderReaderBlock: (_section, block) => `<p>${block.id}</p>`,
  });

  expect(expectedResult).toContain('grid-column: 2 / span 1; text-align: right;');
});
