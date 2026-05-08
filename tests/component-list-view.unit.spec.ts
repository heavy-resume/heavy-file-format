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

test('component-list display default sorts keyed items before missing-key items', () => {
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
      componentListDefaultSortKey: 'Job Match',
      componentListDefaultSortDirection: 'desc',
    },
  };

  const expectedResult = resolveComponentListItems(list);

  expect(expectedResult.kind).toBe('items');
  if (expectedResult.kind === 'items') {
    expect(expectedResult.blocks.map((block) => block.text)).toEqual(['top', 'middle', 'missing']);
  }
});

test('component-list default grouping creates sorted virtual groups', () => {
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
      componentListDefaultSortKey: 'Job Match',
      componentListDefaultSortDirection: 'desc',
      componentListDefaultGroupKey: 'Category',
    },
  };

  const expectedResult = resolveComponentListItems(list);

  expect(expectedResult.kind).toBe('groups');
  if (expectedResult.kind === 'groups') {
    expect(expectedResult.groups.map((group) => group.label)).toEqual(['Language', 'Database']);
    expect(expectedResult.groups[1]?.blocks.map((block) => block.text)).toEqual(['sqlite', 'postgres']);
  }
});

test('component-list runtime sort can reverse the selected order', () => {
  const list: VisualBlock = {
    id: 'skills',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('component-list'),
      componentListBlocks: [
        textItem('middle', { Strength: 20 }),
        textItem('top', { Strength: 90 }),
      ],
      componentListDefaultSortKey: 'Strength',
      componentListDefaultSortDirection: 'desc',
    },
  };

  const expectedResult = resolveComponentListItems(list, 'Strength::reversed');

  expect(expectedResult.kind).toBe('items');
  if (expectedResult.kind === 'items') {
    expect(expectedResult.blocks.map((block) => block.text)).toEqual(['middle', 'top']);
  }
});

test('component-list runtime grouping can override the selected group', () => {
  const list: VisualBlock = {
    id: 'skills',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('component-list'),
      componentListBlocks: [
        textItem('postgres', { Strength: 80, Category: 'Database' }),
        textItem('typescript', { Strength: 95, Category: 'Language' }),
        textItem('sqlite', { Strength: 90, Category: 'Database' }),
      ],
      componentListDefaultSortKey: 'Strength',
      componentListDefaultSortDirection: 'desc',
      componentListDefaultGroupKey: 'Category',
    },
  };

  const expectedResult = resolveComponentListItems(list, 'Strength::group=');

  expect(expectedResult.kind).toBe('items');
  if (expectedResult.kind === 'items') {
    expect(expectedResult.blocks.map((block) => block.text)).toEqual(['typescript', 'sqlite', 'postgres']);
  }
});

test('component-list groups sort alphabetically when no sort key is selected', () => {
  const list: VisualBlock = {
    id: 'skills',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('component-list'),
      componentListBlocks: [
        textItem('postgres', { Category: 'Database' }),
        textItem('typescript', { Category: 'Language' }),
        textItem('aws', { Category: 'Cloud' }),
      ],
      componentListDefaultGroupKey: 'Category',
    },
  };

  const expectedResult = resolveComponentListItems(list);

  expect(expectedResult.kind).toBe('groups');
  if (expectedResult.kind === 'groups') {
    expect(expectedResult.groups.map((group) => group.label)).toEqual(['Cloud', 'Database', 'Language']);
  }
});
