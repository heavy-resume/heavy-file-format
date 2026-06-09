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

class TestInputElement {
  dataset: Record<string, string> = {};
  value = '';
  checked = false;
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
  if (!('HTMLInputElement' in globalThis)) {
    Object.defineProperty(globalThis, 'HTMLInputElement', {
      configurable: true,
      value: TestInputElement,
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

test('grid editor renders default stack width as blank and never as a disabled checkbox state', () => {
  const grid = state.document.sections[0]!.blocks[0]!;

  const defaultResult = renderGridEditor('section-summary', grid, createHelpers());

  expect(defaultResult).toContain('data-field="block-grid-stack-width" value=""');
  expect(defaultResult).toContain('data-field="block-grid-stack-never"');
  expect(defaultResult).toContain('<span>Never</span>');
  expect(defaultResult).not.toContain('Never Stack');
  expect(defaultResult).not.toContain('data-field="block-grid-stack-width" value="" disabled');

  grid.schema.gridStackWidth = 'never';

  const neverResult = renderGridEditor('section-summary', grid, createHelpers());

  expect(neverResult).toContain('data-field="block-grid-stack-width" value="" disabled');
  expect(neverResult).toContain('data-field="block-grid-stack-never" checked');
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

test('grid stack width input can be cleared to use the default without rewriting the field', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridStackWidth = '30rem';
  const input = new TestInputElement() as unknown as HTMLInputElement;
  input.dataset.field = 'block-grid-stack-width';
  input.dataset.sectionKey = 'section-summary';
  input.dataset.blockId = 'grid-block';
  input.value = '';

  handleBlockFieldInput(input);

  expect(grid.schema.gridStackWidth).toBe('50rem');
  expect(input.value).toBe('');
});

test('grid stack never checkbox disables automatic stacking', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  const input = new TestInputElement() as unknown as HTMLInputElement;
  input.dataset.field = 'block-grid-stack-never';
  input.dataset.sectionKey = 'section-summary';
  input.dataset.blockId = 'grid-block';
  input.checked = true;

  handleBlockFieldInput(input);

  expect(grid.schema.gridStackWidth).toBe('never');
});

test('component-list component switch stores an inferred item label when label is automatic', () => {
  const section = state.document.sections[0]!;
  const list = createEmptyBlock('component-list');
  list.id = 'component-list-block';
  list.schema.componentListComponent = 'text';
  list.schema.componentListItemLabel = '';
  section.blocks = [list];
  const select = new TestSelectElement() as unknown as HTMLSelectElement;
  select.dataset.field = 'block-component-list-component';
  select.dataset.sectionKey = 'section-summary';
  select.dataset.blockId = 'component-list-block';
  select.value = 'Resume Item';

  handleBlockFieldInput(select);

  expect(list.schema.componentListComponent).toBe('Resume Item');
  expect(list.schema.componentListItemLabel).toBe('Resume Item');
});

test('component-list component switch preserves a manually edited item label', () => {
  const section = state.document.sections[0]!;
  const list = createEmptyBlock('component-list');
  list.id = 'component-list-block';
  list.schema.componentListComponent = 'text';
  list.schema.componentListItemLabel = 'job';
  section.blocks = [list];
  const select = new TestSelectElement() as unknown as HTMLSelectElement;
  select.dataset.field = 'block-component-list-component';
  select.dataset.sectionKey = 'section-summary';
  select.dataset.blockId = 'component-list-block';
  select.value = 'Resume Item';

  handleBlockFieldInput(select);

  expect(list.schema.componentListComponent).toBe('Resume Item');
  expect(list.schema.componentListItemLabel).toBe('job');
});

test('grid reader renders grid cells without slot alignment metadata', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridItems.push({
    id: 'left-item',
    block: createEmptyBlock('text'),
  });
  grid.schema.gridItems.push({
    id: 'right-item',
    block: createEmptyBlock('text'),
  });

  const expectedResult = renderGridReader(state.document.sections[0]!, grid, {
    ...createHelpers(),
    renderReaderBlock: (_section, block) => `<p>${block.id}</p>`,
  });

  expect(expectedResult).toContain('grid-column: 2 / span 1;');
  expect(expectedResult).not.toContain('text-align: right;');
});

test('grid reader uses default stack behavior without generated CSS', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridItems.push({
    id: 'left-item',
    block: createEmptyBlock('text'),
  });

  const expectedResult = renderGridReader(state.document.sections[0]!, grid, {
    ...createHelpers(),
    renderReaderBlock: (_section, block) => `<p>${block.id}</p>`,
  });

  expect(expectedResult).toContain('class="reader-grid-layout grid-stack-');
  expect(expectedResult).not.toContain('has-custom-grid-stack');
  expect(expectedResult).not.toContain('<style>');
});

test('grid reader emits scoped container CSS for custom stack width', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridStackWidth = '30rem';
  grid.schema.gridItems.push({
    id: 'left-item',
    block: createEmptyBlock('text'),
  });

  const expectedResult = renderGridReader(state.document.sections[0]!, grid, {
    ...createHelpers(),
    renderReaderBlock: (_section, block) => `<p>${block.id}</p>`,
  });

  expect(expectedResult).toContain('@container hvy-surface (inline-size <= 30rem)');
  expect(expectedResult).toContain('has-custom-grid-stack');
  expect(expectedResult).toContain('grid-column: 1 / -1 !important;');
});

test('grid reader preserves columns when stack width is never', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridStackWidth = 'never';
  grid.schema.gridItems.push({
    id: 'left-item',
    block: createEmptyBlock('text'),
  });

  const expectedResult = renderGridReader(state.document.sections[0]!, grid, {
    ...createHelpers(),
    renderReaderBlock: (_section, block) => `<p>${block.id}</p>`,
  });

  expect(expectedResult).toContain('has-custom-grid-stack');
  expect(expectedResult).toContain('grid-stack-never');
  expect(expectedResult).not.toContain('<style>');
});

test('grid reader trims vertical edge margins from direct cell blocks', () => {
  const grid = state.document.sections[0]!.blocks[0]!;
  grid.schema.gridItems.push({
    id: 'left-item',
    block: createEmptyBlock('expandable'),
  });
  grid.schema.gridItems[0]!.block.schema.css = 'margin: 0.5rem 0;';

  const expectedResult = renderGridReader(state.document.sections[0]!, grid, {
    ...createHelpers(),
    renderReaderBlock: (_section, block, options) => `<div style="${block.schema.css}${options?.trimVerticalEdgeMargin ? ' margin-top: 0; margin-bottom: 0;' : ''}"></div>`,
  });

  expect(expectedResult).toContain('margin: 0.5rem 0; margin-top: 0; margin-bottom: 0;');
});
