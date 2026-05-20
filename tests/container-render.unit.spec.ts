import { expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import { renderContainerReader } from '../src/editor/components/container/container';
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

function makeContainerBlock(title: string): VisualBlock {
  return {
    id: 'container-test',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('container'),
      css: 'border: 1px solid var(--hvy-border);',
      containerTitle: title,
      containerBlocks: [
        {
          id: 'text-test',
          text: 'Container body',
          schemaMode: false,
          schema: defaultBlockSchema('text'),
        },
      ],
    },
  };
}

const helpers = {
  escapeAttr: (value: string) => value.replace(/"/g, '&quot;'),
  escapeHtml: (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  ensureContainerBlocks: () => {},
  getReaderContainerExpanded: (_key: string, fallback: boolean) => fallback,
  renderReaderBlocks: () => '<p>Container body</p>',
  renderReaderListBlocks: () => '<p>Container body</p>',
} as unknown as ComponentRenderHelpers;

test('reader container omits the title line when no title is configured', () => {
  const block = makeContainerBlock('');
  const html = renderContainerReader(makeSection([block]), block, helpers);

  expect(html).toContain('reader-container');
  expect(html).not.toContain('reader-container-head');
  expect(html).not.toContain('reader-container-title');
  expect(html).not.toContain('has-title');
});

test('reader container marks titled bordered containers for border-straddling label styling', () => {
  const block = makeContainerBlock('Education');
  const html = renderContainerReader(makeSection([block]), block, helpers);

  expect(html).toContain('reader-container has-title');
  expect(html).toContain('<header class="reader-container-head">');
  expect(html).toContain('<div class="reader-container-title">Education</div>');
});
