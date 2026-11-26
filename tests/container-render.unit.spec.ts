import { beforeEach, expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import { renderContainerReader } from '../src/editor/components/container/container';
import { getContainerShellCss } from '../src/editor/components/container/container-css';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import type { VisualBlock, VisualSection } from '../src/editor/types';
import { initState } from '../src/state';
import { createTestState } from './serialization-test-helpers';

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

beforeEach(() => {
  initState(createTestState({ meta: { hvy_version: 0.1 }, extension: '.hvy', sections: [], attachments: [] }));
});

test('reader container omits the title line when no title is configured', () => {
  const block = makeContainerBlock('');
  const html = renderContainerReader(makeSection([block]), block, helpers);

  expect(html).toContain('reader-container');
  expect(html).not.toContain('reader-container-head');
  expect(html).not.toContain('reader-container-title');
  expect(html).not.toContain('has-title');
});

test('reader container marks titled bordered containers for label styling', () => {
  const block = makeContainerBlock('Education');
  const html = renderContainerReader(makeSection([block]), block, helpers);

  expect(html).toContain('reader-container has-title');
  expect(html).toContain('<header class="reader-container-head">');
  expect(html).toContain('<div class="reader-container-title">Education</div>');
});

test('expected result: child layout css lands on the element holding the children', () => {
  const block = makeContainerBlock('');
  block.schema.css = 'display: flex; gap: 1rem; border: 1px solid red;';

  const html = renderContainerReader(makeSection([block]), block, helpers);

  expect(html).toContain('<div class="reader-container-body" style="display: flex;gap: 1rem"');
});

test('expected result: responsive child layout css targets the element holding the children', () => {
  const block = makeContainerBlock('');
  block.schema.css = 'md:flex-direction: row; md:margin: 0;';

  const html = renderContainerReader(makeSection([block]), block, helpers);

  expect(html).toMatch(/@container hvy-surface \(inline-size >= 48rem\) \{ \.surface-responsive-\w+ \{ flex-direction: row; \} \}/);
  expect(html).toMatch(/class="reader-container-body surface-responsive-\w+"/);
  expect(html).not.toContain('margin');
});

test('expected result: a container without child layout css adds nothing to its body element', () => {
  const block = makeContainerBlock('');

  const html = renderContainerReader(makeSection([block]), block, helpers);

  expect(html).toMatch(/<div class="reader-container-body"[^>]*>/);
  expect(html).not.toMatch(/class="reader-container-body"[^>]*style=/);
});

test('expected result: the shell keeps box, placement and display css but not child layout css', () => {
  expect(getContainerShellCss('display: inline-flex; gap: 1rem; flex: 1 1 0; md:align-items: center; md:order: 2; border: 1px solid red', {}))
    .toBe('display: inline-flex; flex: 1 1 0; md:order: 2; border: 1px solid red;');
});
