import { beforeEach, expect, test } from 'vitest';

import { deserializeDocument, serializeDocument } from '../src/serialization';
import { initCallbacks, initState, state } from '../src/state';
import { saveReusableFromModal, syncReusableTemplateForBlock } from '../src/reusable';
import { createTestState } from './serialization-test-helpers';

beforeEach(() => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
});

test('editing one component template instance does not rewrite sibling instances', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: skill-record
    baseType: expandable
    schema:
      expandableAlwaysShowStub: true
      expandableExpanded: false
      expandableStubBlocks:
        lock: false
        children: []
      expandableContentBlocks:
        lock: false
        children: []
---

<!--hvy: {"id":"tools"}-->
#! Tools

 <!--hvy:component-list {"componentListComponent":"skill-record"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:skill-record {"id":"tool-typescript"}-->

    <!--hvy:expandable:stub {}-->

     <!--hvy:text {}-->
      TypeScript

    <!--hvy:expandable:content {}-->

     <!--hvy:text {}-->
      Description

  <!--hvy:component-list:1 {}-->

   <!--hvy:skill-record {"id":"tool-python"}-->

    <!--hvy:expandable:stub {}-->

     <!--hvy:text {}-->
      Python

    <!--hvy:expandable:content {}-->

     <!--hvy:text {}-->
      Description
`, '.hvy');
  initState(createTestState(document));
  state.showAdvancedEditor = true;

  const records = document.sections[0]!.blocks[0]!.schema.componentListBlocks;
  const firstName = records[0]!.schema.expandableStubBlocks.children[0]!;
  const secondName = records[1]!.schema.expandableStubBlocks.children[0]!;

  firstName.text = 'TypeScripts';
  syncReusableTemplateForBlock(document.sections[0]!.key, firstName.id);

  expect(firstName.text).toBe('TypeScripts');
  expect(secondName.text).toBe('Python');
});

test('saving a new container component template preserves copied child blocks', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

 <!--hvy:container {"css":"margin: 0;"}-->

  <!--hvy:text {"css":"margin: 0 0 0.35rem;","fillIn":true}-->
   <!-- value {"placeholder":"Organization"} -->

  <!--hvy:grid {"css":"margin: 0.35rem 0;"}-->

   <!--hvy:grid:0 {}-->

    <!--hvy:text {"css":"margin: 0;","fillIn":true}-->
     <!-- value {"placeholder":"Location"} -->

   <!--hvy:grid:1 {}-->

    <!--hvy:text {"css":"margin: 0; text-align: right;","fillIn":true}-->
     <!-- value {"placeholder":"Dates"} -->
`, '.hvy');
  initState(createTestState(document));
  const block = document.sections[0]!.blocks[0]!;
  state.reusableSaveModal = {
    kind: 'component',
    sectionKey: document.sections[0]!.key,
    blockId: block.id,
    draftName: 'Job History Item',
  };

  saveReusableFromModal(
    {
      querySelector: () => ({ value: 'Job History Item', focus: () => {} }),
    } as unknown as HTMLElement,
    {
      findBlockByIds: () => block,
      recordHistory: () => {},
      closeModal: () => {
        state.reusableSaveModal = null;
      },
    }
  );

  expect(document.meta.component_defs?.[0]?.schema).toMatchObject({
    component: 'container',
    containerBlocks: [
      { text: '<!-- value {"placeholder":"Organization"} -->' },
      { schema: { component: 'grid' } },
    ],
  });
  const expectedResult = serializeDocument(document);
  expect(expectedResult).toContain('name: Job History Item');
  expect(expectedResult).toContain('baseType: container');
  expect(expectedResult).toContain('containerBlocks:');
  expect(expectedResult).toContain('placeholder":"Organization');
  expect(expectedResult).toContain('placeholder":"Location');
  expect(expectedResult).toContain('placeholder":"Dates');
});
