import { expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import { hasTemplateFieldBlock, renderTemplateGhosts } from '../src/editor/template';
import type { VisualBlock, VisualSection } from '../src/editor/types';

function makeSection(blocks: VisualBlock[], children: VisualSection[] = []): VisualSection {
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
    children,
  };
}

test('template field detection treats container titles as existing template content', () => {
  const block: VisualBlock = {
    id: 'container-test',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('container'),
      containerTitle: '{{education}}',
      containerBlocks: [],
    },
  };

  expect(hasTemplateFieldBlock('education', [makeSection([block])])).toBe(true);
});

test('template ghosts skip fields already present in nested block schema', () => {
  const block: VisualBlock = {
    id: 'container-test',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('container'),
      containerTitle: '{{education}}',
      containerBlocks: [],
    },
  };

  const html = renderTemplateGhosts(['education', 'summary'], [makeSection([block])], {
    escapeAttr: (value) => value.replace(/"/g, '&quot;'),
    escapeHtml: (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  });

  expect(html).not.toContain('data-template-field="education"');
  expect(html).toContain('data-template-field="summary"');
});
