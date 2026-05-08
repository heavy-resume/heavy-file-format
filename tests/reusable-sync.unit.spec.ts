import { beforeEach, expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { initCallbacks, initState, state } from '../src/state';
import { syncReusableTemplateForBlock } from '../src/reusable';
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

test('editing one reusable component instance does not rewrite sibling instances', () => {
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
