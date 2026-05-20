import { expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import { renderExpandableReader } from '../src/editor/components/expandable/expandable';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import type { VisualBlock, VisualSection } from '../src/editor/types';

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
    level: 1,
    expanded: true,
    highlight: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks,
    children: [],
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
  expect(html).not.toContain('expandable-reader-pane-stub');
});
