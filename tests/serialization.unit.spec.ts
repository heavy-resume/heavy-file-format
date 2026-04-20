import { beforeAll, expect, test } from 'vitest';

import { deserializeDocument, serializeDocument } from '../src/serialization';
import { initCallbacks, initState, state } from '../src/state';
import type { AppState, VisualDocument } from '../src/types';

function createTestState(document: VisualDocument): AppState {
  return {
    document,
    filename: 'test.hvy',
    currentView: 'editor',
    paneScroll: {
      editorTop: 0,
      editorSidebarTop: 0,
      readerTop: 0,
      windowTop: 0,
    },
    showAdvancedEditor: false,
    activeEditorBlock: null,
    activeEditorSectionTitleKey: null,
    clearSectionTitleOnFocusKey: null,
    modalSectionKey: null,
    reusableSaveModal: null,
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
    selectedReusableComponentName: null,
    templateValues: {},
    history: [],
    future: [],
    isRestoring: false,
    componentMetaModal: null,
    themeModalOpen: false,
    gridAddComponentByBlock: {},
    expandableEditorPanels: {},
    viewerSidebarOpen: false,
    editorSidebarOpen: false,
    lastHistoryGroup: null,
    lastHistoryAt: 0,
    pendingEditorCenterSectionKey: null,
  };
}

function serializeWithState(document: VisualDocument): string {
  state.document = document;
  return serializeDocument(document);
}

beforeAll(() => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
  });
  initState(
    createTestState({
      meta: { hvy_version: 0.1 },
      extension: '.hvy',
      sections: [],
    })
  );
});

test('deserializes nested expandable slot children and part locks', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {"lock":true}-->

   <!--hvy:text {"css":"margin-bottom: 0;"}-->
    ## Summary

  <!--hvy:expandable:content {}-->

   <!--hvy:text {"css":"margin: 0;"}-->
    Expanded detail
`;

  const document = deserializeDocument(input, '.hvy');
  const block = document.sections[0]?.blocks[0];

  expect(block.schema.component).toBe('expandable');
  expect(block.schema.expandableStubBlocks.lock).toBe(true);
  expect(block.schema.expandableStubBlocks.children).toHaveLength(1);
  expect(block.schema.expandableStubBlocks.children[0]?.schema.component).toBe('text');
  expect(block.schema.expandableStubBlocks.children[0]?.text).toBe('## Summary');
  expect(block.schema.expandableContentBlocks.children).toHaveLength(1);
  expect(block.schema.expandableContentBlocks.children[0]?.text).toBe('Expanded detail');
});

test('deserializes custom expandable components nested under component-list slots', () => {
  const input = `---
hvy_version: 0.1
component_defs:
  - name: skill-record
    baseType: expandable
    schema:
      css: "margin: 0;"
      expandableAlwaysShowStub: true
      expandableExpanded: false
      expandableStubBlocks:
        lock: false
        children: []
      expandableContentBlocks:
        lock: false
        children: []
---

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:component-list {"componentListComponent":"skill-record"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:skill-record {"id":"skill-se"}-->

    <!--hvy:expandable:stub {}-->

     <!--hvy:text {}-->
      Software Engineering

    <!--hvy:expandable:content {}-->

     <!--hvy:text {}-->
      Description body
`;

  const document = deserializeDocument(input, '.hvy');
  const listBlock = document.sections[0]?.blocks[0];
  const record = listBlock.schema.componentListBlocks[0];

  expect(listBlock.schema.component).toBe('component-list');
  expect(record.schema.component).toBe('skill-record');
  expect(record.schema.expandableStubBlocks.children).toHaveLength(1);
  expect(record.schema.expandableStubBlocks.children[0]?.text).toBe('Software Engineering');
  expect(record.schema.expandableContentBlocks.children).toHaveLength(1);
  expect(record.schema.expandableContentBlocks.children[0]?.text).toBe('Description body');
});

test('serializes slot markers without child component payloads', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"layout"}-->
#! Layout

 <!--hvy:grid {"gridColumns":2}-->

  <!--hvy:grid:0 {"id":"skills","column":"left"}-->

   <!--hvy:component-list {"componentListComponent":"text"}-->
    ## Skills

  <!--hvy:grid:1 {"id":"details","column":"right"}-->

   <!--hvy:container {}-->

    <!--hvy:container:0 {}-->

     <!--hvy:text {}-->
      Detail body
`;

  const document = deserializeDocument(input, '.hvy');
  const output = serializeWithState(document);

  expect(output).toMatch(/<!--hvy:grid:0 {"id":"skills","column":"left"}-->/);
  expect(output).toMatch(/\n\s*<!--hvy:component-list \{\}-->/);
  expect(output).toMatch(/\n\s*<!--hvy:container \{\}-->/);
  expect(output).not.toMatch(/<!--hvy:grid:\d+\s+\{[^\n>]*"component"/);
  expect(output).not.toMatch(/<!--hvy:container:\d+\s+\{[^\n>]*"component"/);
  expect(output).not.toMatch(/<!--hvy:component-list:\d+\s+\{[^\n>]*"component"/);
});

test('round-trips migrated example files without reintroducing slot-level component fields', async () => {
  const fs = await import('node:fs/promises');
  const files: Array<[string, '.hvy' | '.thvy']> = [
    ['examples/resume.hvy', '.hvy'],
    ['examples/resume.thvy', '.thvy'],
    ['examples/example.hvy', '.hvy'],
  ];

  for (const [path, extension] of files) {
    const input = await fs.readFile(path, 'utf8');
    const document = deserializeDocument(input, extension);
    const output = serializeWithState(document);

    expect(output, path).not.toMatch(
      /<!--hvy:(?:expandable:(?:stub|content)|grid:\d+|component-list:\d+|container:\d+|table:\d+:\d+)\s+\{[^\n>]*"component"/
    );
  }
});
