import { expect, test, vi } from 'vitest';

import { createDefaultTextCaption, normalizeTextCaption, serializeTextCaption } from '../src/caption';
import { createDefaultTextComponent, normalizeTextComponent, renderTextComponentElement } from '../src/text-component';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';

test('expected result: text caption payload defaults to centered text component', () => {
  const expectedResult = createDefaultTextCaption('Caption text');

  expect(expectedResult.text).toBe('Caption text');
  expect(expectedResult.schema.kind).toBe('text');
  expect(expectedResult.schema.component).toBe('text');
  expect(expectedResult.schema.align).toBe('center');
});

test('expected result: text caption normalization migrates string captions', () => {
  const expectedResult = normalizeTextCaption('Plain caption');

  expect(expectedResult?.text).toBe('Plain caption');
  expect(expectedResult?.schema.align).toBe('center');
});

test('expected result: empty text caption serializes as absent', () => {
  expect(serializeTextCaption(createDefaultTextCaption(''))).toBeNull();
});

test('expected result: plugin text payload defaults to normal text component formatting', () => {
  const expectedResult = createDefaultTextComponent('Plugin text');

  expect(expectedResult.text).toBe('Plugin text');
  expect(expectedResult.schema.kind).toBe('text');
  expect(expectedResult.schema.component).toBe('text');
  expect(expectedResult.schema.align).toBe('left');
  expect(expectedResult.schema.css).toBe('margin: 0.5rem 0;');
});

test('expected result: plugin text rendering uses reader text classes instead of caption classes', () => {
  vi.stubGlobal('document', createTestDocument());
  try {
    const expectedResult = renderTextComponentElement(createDefaultTextComponent('**Plugin text**'), createTestHelpers());

    expect(expectedResult?.tagName).toBe('DIV');
    expect(expectedResult?.classList.contains('reader-block')).toBe(true);
    expect(expectedResult?.classList.contains('reader-block-text')).toBe(true);
    expect(expectedResult?.classList.contains('hvy-plugin-text-content')).toBe(true);
    expect(expectedResult?.classList.contains('hvy-text-caption-content')).toBe(false);
    expect(expectedResult?.innerHTML).toBe('<p><strong>Plugin text</strong></p>');
  } finally {
    vi.unstubAllGlobals();
  }
});

test('expected result: plugin text normalization keeps empty strings absent', () => {
  expect(normalizeTextComponent('')).toBeNull();
});

function createTestHelpers(): ComponentRenderHelpers {
  return {
    escapeAttr: (value) => value,
    escapeHtml: (value) => value,
    markdownToEditorHtml: (markdown) => markdown,
    renderRichToolbar: () => '',
    renderEditorBlock: () => '',
    renderPassiveEditorBlock: () => '',
    renderReaderBlock: () => '',
    renderReaderBlocks: () => '',
    renderReaderListBlocks: () => '',
    orderReaderBlocks: (blocks) => blocks,
    orderReaderListBlocks: (blocks) => blocks,
    isReaderViewPrioritizedBlock: () => false,
    renderTextFragment: (content) => `<p>${content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`,
    renderComponentFragment: (_componentName, content) => `<p>${content}</p>`,
    renderComponentOptions: () => '',
    renderAddComponentPicker: () => '',
    renderComponentPlacementTarget: () => '',
    renderOption: () => '',
    getDocumentComponentCss: () => '',
    getXrefTargetOptions: () => [],
    isXrefTargetValid: () => false,
    getTableColumns: () => [],
    ensureContainerBlocks: () => undefined,
    ensureComponentListBlocks: () => undefined,
    getSelectedAddComponent: (_key, fallback) => fallback,
    getComponentListReaderViewId: () => '',
    getReaderContainerExpanded: (_key, fallback) => fallback,
    isExpandableEditorPanelOpen: (_sectionKey, _blockId, _panel, fallback) => fallback,
    isAdvancedEditorMode: () => false,
    isMobileAdjustmentMode: () => false,
  };
}

function createTestDocument(): Pick<Document, 'createElement'> {
  return {
    createElement: (tagName: string) => {
      const element = {
        tagName: tagName.toUpperCase(),
        className: '',
        dataset: {},
        innerHTML: '',
        style: {},
        classList: {
          contains(className: string) {
            return element.className.split(/\s+/).includes(className);
          },
        },
      };
      return element as HTMLElement;
    },
  };
}
