import { beforeEach, expect, test } from 'vitest';

import { deserializeDocument, serializeDocument } from '../src/serialization';
import { initCallbacks, initState, state } from '../src/state';
import { applyReusableTemplateToDocument, saveReusableFromModal, syncReusableTemplateForBlock } from '../src/reusable';
import { getReusableTemplate, instantiateReusableBlock } from '../src/document-factory';
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

test.each([false, true])('instance edits preserve templates and siblings with advanced mode %s', (advanced) => {
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
  state.showAdvancedEditor = advanced;

  const records = document.sections[0]!.blocks[0]!.schema.componentListBlocks;
  const firstName = records[0]!.schema.expandableStubBlocks.children[0]!;
  const secondName = records[1]!.schema.expandableStubBlocks.children[0]!;

  const expectedDefinitions = JSON.stringify(document.meta.component_defs);
  expect(firstName.text).toBe('TypeScript');
  expect(secondName.text).toBe('Python');

  firstName.text = 'TypeScripts';
  syncReusableTemplateForBlock(document.sections[0]!.key, firstName.id);

  expect(firstName.text).toBe('TypeScripts');
  expect(secondName.text).toBe('Python');
  expect(JSON.stringify(document.meta.component_defs)).toBe(expectedDefinitions);
});

test('expected result: editing a template child preserves definition metadata', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-record
    baseType: container
    description: Fake definition description
    template:
      id: fake-template
      text: ""
      schema:
        component: container
        containerBlocks:
          - id: fake-child
            text: Fake child
            schema:
              component: text
---

#! Fake body
`, '.hvy');
  initState(createTestState(document));
  state.reusableDefinitionEditModal = {
    kind: 'component',
    index: 0,
    error: null,
    originalRaw: '',
  };

  document.meta.component_defs![0]!.template!.schema.component = 'fake-record';
  const child = document.meta.component_defs![0]!.template!.schema.containerBlocks[0]!;
  syncReusableTemplateForBlock('__reusable__:fake-record', child.id);

  expect(document.meta.component_defs![0]!.description).toBe('Fake definition description');
  expect(state.reusableDefinitionEditModal.pendingDocumentSync).toBe(true);
});

test('expected result: template updates preserve populated instances and update untouched instances', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-record
    baseType: expandable
    templateVariables:
      company:
        label: Company
    template:
      id: fake-template
      text: ""
      schema:
        component: expandable
        css: "padding: 1rem;"
        expandableStubBlocks:
          children:
            - id: fake-company
              text: "**{% company %}**"
              schema:
                component: text
        expandableContentBlocks:
          children:
            - id: fake-plugin
              text: ""
              schema:
                component: plugin
                plugin: fake.plugin
---

#! Fake body
`, '.hvy');
  initState(createTestState(document));
  const definition = document.meta.component_defs![0]!;
  const previousDefinition = JSON.parse(JSON.stringify(definition));
  const customized = instantiateReusableBlock('fake-record', { company: 'Fake Company' })!;
  customized.schema.id = 'fake-customized-record';
  customized.schema.sortKeys = { Company: 'Fake Company', Interviews: 3 };
  customized.schema.groupKeys = { Stage: 'Interviewing' };
  customized.schema.expandableContentBlocks.children[0]!.schema.pluginConfig = { reportId: 'fake-report' };
  const untouched = instantiateReusableBlock('fake-record')!;
  untouched.schema.id = 'fake-untouched-record';
  untouched.schema.expandableStubBlocks.children[0]!.schema.id = 'fake-untouched-company';
  document.sections[0]!.blocks.push(customized, untouched);
  const customizedBefore = JSON.stringify(customized);
  const untouchedIdBefore = untouched.id;
  const untouchedSchemaIdBefore = untouched.schema.id;
  const untouchedChildIdBefore = untouched.schema.expandableStubBlocks.children[0]!.id;
  const untouchedChildSchemaIdBefore = untouched.schema.expandableStubBlocks.children[0]!.schema.id;
  const template = getReusableTemplate(definition);
  template.schema.css = 'padding: 2rem;';

  applyReusableTemplateToDocument('fake-record', template, null, { previousDefinition });

  expect(JSON.stringify(customized)).toBe(customizedBefore);
  expect(untouched.schema.css).toBe('padding: 2rem;');
  expect(untouched.id).toBe(untouchedIdBefore);
  expect(untouched.schema.id).toBe(untouchedSchemaIdBefore);
  expect(untouched.schema.expandableStubBlocks.children[0]!.id).toBe(untouchedChildIdBefore);
  expect(untouched.schema.expandableStubBlocks.children[0]!.schema.id).toBe(untouchedChildSchemaIdBefore);
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
