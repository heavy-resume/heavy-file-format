import { expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import { resolveComponentListItems } from '../src/editor/components/component-list/component-list-view';
import type { VisualBlock } from '../src/editor/types';

function textItem(label: string, sortKeys: VisualBlock['schema']['sortKeys'] = {}): VisualBlock {
  return {
    id: `block-${label}`,
    text: label,
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('text'),
      sortKeys,
    },
  };
}

test('component-list view sorts keyed items before missing-key items', () => {
  const list: VisualBlock = {
    id: 'skills',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('component-list'),
      componentListBlocks: [
        textItem('missing'),
        textItem('middle', { 'Job Match': 20 }),
        textItem('top', { 'Job Match': 90 }),
      ],
      componentListViews: [{ id: 'job', label: 'Job', sortKey: 'Job Match', direction: 'desc', groupKey: '', groupDirection: 'desc', groupCollapsedPreviewRem: 3 }],
      componentListDefaultView: 'job',
    },
  };

  const expectedResult = resolveComponentListItems(list);

  expect(expectedResult.kind).toBe('items');
  if (expectedResult.kind === 'items') {
    expect(expectedResult.blocks.map((block) => block.text)).toEqual(['top', 'middle', 'missing']);
  }
});

test('component-list grouped view creates sorted virtual groups', () => {
  const list: VisualBlock = {
    id: 'skills',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('component-list'),
      componentListBlocks: [
        textItem('postgres', { 'Job Match': 80, Category: 'Database' }),
        textItem('typescript', { 'Job Match': 95, Category: 'Language' }),
        textItem('sqlite', { 'Job Match': 90, Category: 'Database' }),
      ],
      componentListViews: [
        { id: 'job', label: 'Job', sortKey: 'Job Match', direction: 'desc', groupKey: 'Category', groupDirection: 'desc', groupCollapsedPreviewRem: 3 },
      ],
      componentListDefaultView: 'job',
    },
  };

  const expectedResult = resolveComponentListItems(list);

  expect(expectedResult.kind).toBe('groups');
  if (expectedResult.kind === 'groups') {
    expect(expectedResult.groups.map((group) => group.label)).toEqual(['Language', 'Database']);
    expect(expectedResult.groups[1]?.blocks.map((block) => block.text)).toEqual(['sqlite', 'postgres']);
  }
});
