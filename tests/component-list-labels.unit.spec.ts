import { expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import { getComponentListAddLabel } from '../src/editor/components/component-list/component-list-labels';
import type { VisualBlock } from '../src/editor/types';

function componentListBlock(componentListComponent: string, componentListItemLabel = ''): VisualBlock {
  return {
    id: 'component-list-1',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('component-list'),
      componentListComponent,
      componentListItemLabel,
    },
  };
}

test('component list add labels preserve slashes from custom labels', () => {
  expect(getComponentListAddLabel(componentListBlock('tool-tech-xref-card', 'tool / tech reference'))).toBe(
    'Add Tool / Tech Reference'
  );
});

test('component list add labels infer tool / tech references from component names', () => {
  expect(getComponentListAddLabel(componentListBlock('tool-tech-xref-card'))).toBe('Add Tool / Tech Reference');
});
