import { expect, test, vi } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import { coerceSortValue, syncSortValuesForDocument } from '../src/sort-values';
import type { VisualBlock } from '../src/editor/types';
import type { VisualDocument } from '../src/types';
import { deserializeDocument } from '../src/serialization';
import { initCallbacks, initState, state } from '../src/state';
import { createTestState } from './serialization-test-helpers';
import { containerActions } from '../src/bind/actions/container';

let blockId = 0;

function block(component: string, text = '', baseComponent?: Parameters<typeof defaultBlockSchema>[1]): VisualBlock {
  blockId += 1;
  return {
    id: `block-${component}-${blockId}`,
    text,
    schemaMode: false,
    schema: defaultBlockSchema(component, baseComponent),
  };
}

test('coerces sort value text, number, datetime, and enum definitions', () => {
  expect(coerceSortValue(' TypeScript ', { type: 'text' })).toBe('TypeScript');
  expect(coerceSortValue(' 96 ', { type: 'number' })).toBe(96);
  expect(coerceSortValue('nope', { type: 'number' })).toBeNull();
  expect(coerceSortValue('2026-07-08T09:15:00-04:00', { type: 'datetime' })).toBe('2026-07-08T13:15:00.000Z');
  expect(coerceSortValue('July 8, 2026, 9:15 AM PDT', { type: 'datetime' })).toBe('2026-07-08T16:15:00.000Z');
  expect(coerceSortValue('July 8, 2026 at 9:15 AM PDT', { type: 'datetime' })).toBe('2026-07-08T16:15:00.000Z');
  expect(coerceSortValue('July 8, 2026 at 9:15 AM JST', { type: 'datetime' })).toBe('2026-07-08T00:15:00.000Z');
  expect(coerceSortValue('July 8, 2026 at 9:15 AM CEST', { type: 'datetime' })).toBe('2026-07-08T07:15:00.000Z');
  expect(coerceSortValue('July 8, 2026, 9:15 AM GMT-7', { type: 'datetime' })).toBe('2026-07-08T16:15:00.000Z');
  expect(coerceSortValue('July 8, 2026 at 9:15 AM America/Los_Angeles', { type: 'datetime' })).toBe('2026-07-08T16:15:00.000Z');
  expect(coerceSortValue('July 8, 2026 at 9:15 AM [America/Los_Angeles]', { type: 'datetime' })).toBe('2026-07-08T16:15:00.000Z');
  expect(coerceSortValue('2026-07-08 09:15', { type: 'datetime' })).toBeNull();
  expect(coerceSortValue('Strong', {
    type: 'enum',
    options: [
      { label: 'Expert', value: 100 },
      { label: 'Strong', value: 80 },
    ],
  })).toBe(80);
});

test('syncs nested sort value annotations to component-list item sort keys', () => {
  const nestedText = block('text', 'Name: <!--hvy:sort-value {"key":"Name"}-->TypeScript<!--/hvy:sort-value-->');
  const nestedTable = block('table');
  nestedTable.schema.tableColumns = ['Score', 'Updated', 'Strength'];
  nestedTable.schema.tableRows = [{
    cells: [
      '<!--hvy:sort-value {"key":"Score"}-->96<!--/hvy:sort-value-->',
      '<!--hvy:sort-value {"key":"Updated"}-->2026-07-08T09:15:00-04:00<!--/hvy:sort-value-->',
      '<!--hvy:sort-value {"key":"Strength"}-->Expert<!--/hvy:sort-value-->',
    ],
  }];
  const item = block('skill-record', '', 'expandable');
  item.schema.sortKeys = { Strength: 1 };
  item.schema.expandableContentBlocks.children = [nestedText, nestedTable];
  const list = block('component-list');
  list.schema.componentListComponent = 'skill-record';
  list.schema.componentListBlocks = [item];
  const document: VisualDocument = {
    extension: '.hvy',
    attachments: [],
    meta: {
      component_defs: [{
        name: 'skill-record',
        baseType: 'expandable',
        sortValueDefs: {
          Name: { type: 'text' },
          Score: { type: 'number' },
          Updated: { type: 'datetime' },
          Strength: {
            type: 'enum',
            options: [
              { label: 'Expert', value: 100 },
              { label: 'Strong', value: 80 },
            ],
          },
        },
      }],
    },
    sections: [{
      key: 'section',
      customId: 'section',
      customIdGenerated: false,
      contained: true,
      editorOnly: false,
      lock: false,
      idEditorOpen: false,
      isGhost: false,
      title: 'Section',
      level: 1,
      expanded: true,
      highlight: false,
      priority: false,
      css: '',
      tags: '',
      description: '',
      location: 'main',
      hideIfUnmodified: false,
      exclude_from_import: false,
      protect_from_import: false,
      blocks: [list],
      children: [],
    }],
  };

  expect(syncSortValuesForDocument(document)).toBe(true);

  expect(item.schema.sortKeys).toEqual({ Name: 'TypeScript', Score: 96, Updated: '2026-07-08T13:15:00.000Z', Strength: 100 });
  expect(syncSortValuesForDocument(document)).toBe(false);
});

test('syncs edited numeric sort value annotations to component-list item sort keys', () => {
  const details = block('text', 'Strength: <!--hvy:sort-value {"key":"Strength"}-->2<!--/hvy:sort-value-->');
  const item = block('skill-record', '', 'expandable');
  item.schema.sortKeys = { Strength: 5 };
  item.schema.expandableContentBlocks.children = [details];
  const list = block('component-list');
  list.schema.componentListComponent = 'skill-record';
  list.schema.componentListBlocks = [item];
  const document: VisualDocument = {
    extension: '.hvy',
    attachments: [],
    meta: {
      component_defs: [{
        name: 'skill-record',
        baseType: 'expandable',
        sortValueDefs: {
          Strength: { type: 'number' },
        },
      }],
    },
    sections: [{
      key: 'section',
      customId: 'section',
      customIdGenerated: false,
      contained: true,
      editorOnly: false,
      lock: false,
      idEditorOpen: false,
      isGhost: false,
      title: 'Section',
      level: 1,
      expanded: true,
      highlight: false,
      priority: false,
      css: '',
      tags: '',
      description: '',
      location: 'main',
      hideIfUnmodified: false,
      exclude_from_import: false,
      protect_from_import: false,
      blocks: [list],
      children: [],
    }],
  };

  expect(syncSortValuesForDocument(document)).toBe(true);

  expect(item.schema.sortKeys.Strength).toBe(2);
});

test('resolves sort values when adding a reusable component-list item from a template', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: skill-record
    baseType: expandable
    sortValueDefs:
      Strength:
        type: enum
        options:
          - label: Expert
            value: 100
          - label: Strong
            value: 80
    schema:
      expandableAlwaysShowStub: true
      expandableExpanded: false
      expandableStubBlocks:
        lock: false
        children:
          - text: "Strength: <!--hvy:sort-value {\\"key\\":\\"Strength\\"}-->Strong<!--/hvy:sort-value-->"
            schema:
              component: text
      expandableContentBlocks:
        lock: false
        children: []
---

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:component-list {"id":"skill-list","componentListComponent":"skill-record"}-->
`, '.hvy');
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createTestState(document));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
  const list = document.sections[0]!.blocks[0]!;

  containerActions['add-component-list-item']({
    app: {} as HTMLElement,
    actionButton: { dataset: {}, closest: () => null } as unknown as HTMLElement,
    sectionKey: document.sections[0]!.key,
    blockId: list.id,
    section: document.sections[0]!,
    reusableName: null,
  });

  expect(state.document.sections[0]!.blocks[0]!.schema.componentListBlocks[0]!.schema.sortKeys).toEqual({ Strength: 80 });
  vi.unstubAllGlobals();
});
