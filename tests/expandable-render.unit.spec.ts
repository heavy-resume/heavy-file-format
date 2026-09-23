import { expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import { renderExpandableEditor, renderExpandableReader } from '../src/editor/components/expandable/expandable';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import type { VisualBlock, VisualSection } from '../src/editor/types';
import { initState } from '../src/state';
import { createTestState } from './serialization-test-helpers';
import { EXPANDABLE_CHEVRON_PLACEHOLDER } from '../src/expandable-chevron';

function makeSection(blocks: VisualBlock[]): VisualSection {
  return {
    key: 'section-test',
    customId: '',
    contained: false,
    editorOnly: false,
    lock: false,
    idEditorOpen: false,
    isGhost: false,
    title: 'Test',
    expanded: true,
    highlight: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks,
  };
}

function makeTextBlock(id: string, text: string): VisualBlock {
  return {
    id,
    text,
    schemaMode: false,
    schema: defaultBlockSchema('text'),
  };
}

function makeExpandableBlock(expanded: boolean): VisualBlock {
  return {
    id: 'expandable-test',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('expandable'),
      expandableAlwaysShowStub: true,
      expandableExpanded: expanded,
      expandableStubBlocks: { lock: false, children: [] },
      expandableContentBlocks: { lock: false, children: [makeTextBlock('content-test', 'Expanded content')] },
    },
  };
}

const helpers = {
  escapeAttr: (value: string) => value.replace(/"/g, '&quot;'),
  renderReaderBlocks: (_section: VisualSection, blocks: VisualBlock[]) => blocks.map((block) => `<p>${block.text}</p>`).join(''),
} as unknown as ComponentRenderHelpers;

test('collapsed expandable with empty stub previews content without rendering a stub pane', () => {
  const block = makeExpandableBlock(false);
  const html = renderExpandableReader(makeSection([block]), block, helpers);

  expect(html).toContain('has-empty-stub');
  expect(html).toContain('is-collapsed');
  expect(html).toContain('expandable-reader-pane-content-preview');
  expect(html).toContain('Expanded content');
  expect(html).not.toContain('expandable-reader-cue');
  expect(html).not.toContain('expandable-pane-expanded');
  expect(html).not.toContain('expandable-reader-pane-stub');
});

test('expanded expandable with empty stub omits the stub pane and keeps content clickable', () => {
  const block = makeExpandableBlock(true);
  const html = renderExpandableReader(makeSection([block]), block, helpers);

  expect(html).toContain('has-empty-stub');
  expect(html).toContain('is-expanded');
  expect(html).toContain('data-expandable-content="true"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('Expanded content');
  expect(html).not.toContain('expandable-pane-expanded');
  expect(html).not.toContain('expandable-reader-pane-stub');
});

test('collapsed expandable renders only its visible stub, then renders content on expansion', () => {
  const block = makeExpandableBlock(false);
  block.schema.expandableStubBlocks.children = [makeTextBlock('stub-test', 'Stub content')];
  const renderedIds: string[] = [];
  const countingHelpers = {
    ...helpers,
    renderReaderBlocks(section: VisualSection, blocks: VisualBlock[]) {
      renderedIds.push(...blocks.map((child) => child.id));
      return helpers.renderReaderBlocks(section, blocks);
    },
  };

  const collapsedHtml = renderExpandableReader(makeSection([block]), block, countingHelpers);
  expect(collapsedHtml).toContain('Stub content');
  expect(collapsedHtml).not.toContain('Expanded content');
  expect(renderedIds).toEqual(['stub-test']);

  renderedIds.length = 0;
  block.schema.expandableExpanded = true;
  const expandedHtml = renderExpandableReader(makeSection([block]), block, countingHelpers);
  expect(expandedHtml).toContain('Stub content');
  expect(expandedHtml).toContain('Expanded content');
  expect(renderedIds).toEqual(['stub-test', 'content-test']);
});

test('expandable passes generic chevron placeholder context only to its stub', () => {
  const block = makeExpandableBlock(true);
  block.schema.expandableStubBlocks.children = [makeTextBlock('stub-test', 'Stub content')];
  const contexts: Array<{ ids: string[]; provided: string[]; omitted: string[] }> = [];
  renderExpandableReader(makeSection([block]), block, {
    ...helpers,
    renderReaderBlocks(_section, blocks, options) {
      contexts.push({
        ids: blocks.map((child) => child.id),
        provided: (options?.textPlaceholders ?? []).map((placeholder) => placeholder.name),
        omitted: options?.omitTextPlaceholderNames ?? [],
      });
      return blocks.map((child) => `<p>${child.text}</p>`).join('');
    },
  });

  expect(contexts).toEqual([
    { ids: ['stub-test'], provided: [EXPANDABLE_CHEVRON_PLACEHOLDER.name], omitted: [] },
    { ids: ['content-test'], provided: [], omitted: [EXPANDABLE_CHEVRON_PLACEHOLDER.name] },
  ]);
});

test('collapsed expandable still previews content when stub children render empty', () => {
  const block = makeExpandableBlock(false);
  block.schema.expandableStubBlocks.children = [makeTextBlock('hidden-stub', '')];
  const html = renderExpandableReader(makeSection([block]), block, {
    ...helpers,
    renderReaderBlocks(section, blocks) {
      return helpers.renderReaderBlocks(section, blocks.filter((child) => child.text));
    },
  });
  expect(html).toContain('has-empty-stub');
  expect(html).toContain('Expanded content');
});

test.each([[false, false], [true, false], [false, true], [true, true]])(
  'editor renders only displayed pane bodies or previews (stub open: %s, content open: %s)',
  (stubOpen, contentOpen) => {
    initState(createTestState({ meta: { hvy_version: '0.1' }, extension: '.hvy', attachments: [], sections: [] }));
    const block = makeExpandableBlock(false);
    block.schema.expandableStubBlocks.children = [0, 1, 2].map((index) => makeTextBlock(`stub-${index}`, `Stub ${index}`));
    block.schema.expandableContentBlocks.children = [0, 1, 2].map((index) => makeTextBlock(`content-${index}`, `Content ${index}`));
    const fullRenderIds: string[] = [];
    const previewRenderIds: string[] = [];
    const html = renderExpandableEditor('section-test', block, {
      ...helpers,
      escapeHtml: helpers.escapeAttr,
      isMobileAdjustmentMode: () => false,
      isAdvancedEditorMode: () => false,
      isExpandableEditorPanelOpen: (_sectionKey, _blockId, pane) => pane === 'stub' ? stubOpen : contentOpen,
      renderEditorNestedBlocks: (_sectionKey, blocks) => {
        fullRenderIds.push(...blocks.map((child) => child.id));
        return blocks.map((child) => `<p>${child.text}</p>`).join('');
      },
      renderPassiveEditorBlock: (_sectionKey, child) => {
        previewRenderIds.push(child.id);
        return `<p>${child.text}</p>`;
      },
      renderAddComponentPicker: () => '',
    });

    expect(fullRenderIds).toEqual([
      ...(stubOpen ? ['stub-0', 'stub-1', 'stub-2'] : []),
      ...(contentOpen ? ['content-0', 'content-1', 'content-2'] : []),
    ]);
    expect(previewRenderIds).toEqual([
      ...(stubOpen ? [] : ['stub-0', 'stub-1']),
      ...(contentOpen ? [] : ['content-0', 'content-1']),
    ]);
    expect(html).toContain('Stub 0');
    expect(html).toContain('Content 0');
    expect(html.includes('Stub 2')).toBe(stubOpen);
    expect(html.includes('Content 2')).toBe(contentOpen);
  }
);
