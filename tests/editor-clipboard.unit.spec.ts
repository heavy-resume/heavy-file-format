import { beforeEach, expect, test } from 'vitest';

import {
  cloneSectionFromEditorClipboard,
  copySectionToEditorClipboard,
  installEditorClipboardComponentDefinitions,
  prepareSectionForDocumentPaste,
  prepareSectionForDocumentPasteWithResult,
} from '../src/editor-clipboard';
import { deserializeDocument, serializeSectionFragment } from '../src/serialization';
import { initCallbacks, initState } from '../src/state';
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

test('section clipboard installs referenced reusable component definitions into another HVY document', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: Resume Item
    baseType: container
    schema:
      containerBlocks:
        - text: "{{Organization}}"
          schema:
            component: text
---

<!--hvy: {"id":"history"}-->
#! History

 <!--hvy:block {"component":"Resume Item"}-->
`, '.hvy');
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  installEditorClipboardComponentDefinitions(target);
  const pasted = cloneSectionFromEditorClipboard(1);

  expect(target.meta.component_defs?.map((def) => def.name)).toEqual(['Resume Item']);
  expect(pasted?.blocks[0]?.schema.component).toBe('Resume Item');
});

test('section clipboard prunes PHVY-incompatible reusable components and skips their definitions', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: Pdf Card
    baseType: container
    schema:
      containerBlocks:
        - text: "PDF-safe"
          schema:
            component: text
  - name: Interactive Detail
    baseType: expandable
    schema:
      expandableStubBlocks:
        children: []
      expandableContentBlocks:
        children: []
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:block {"component":"Pdf Card"}-->

 <!--hvy:block {"component":"Interactive Detail"}-->
`);
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');

  installEditorClipboardComponentDefinitions(target);
  const pasted = cloneSectionFromEditorClipboard(1)!;
  const prepared = prepareSectionForDocumentPaste(target, pasted);

  expect(target.meta.component_defs?.map((def) => def.name)).toEqual(['Pdf Card']);
  expect(prepared.blocks.map((block) => block.schema.component)).toEqual(['Pdf Card']);
});

test('section clipboard reports how many components PHVY paste altered', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: Interactive Detail
    baseType: expandable
    schema:
      expandableStubBlocks:
        children: []
      expandableContentBlocks:
        children: []
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:block {"component":"Interactive Detail"}-->
`);
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');
  const pasted = cloneSectionFromEditorClipboard(1)!;

  const expectedResult = prepareSectionForDocumentPasteWithResult(target, pasted);

  expect(expectedResult.removedCount).toBe(1);
  expect(expectedResult.section.blocks).toEqual([]);
});

test('section clipboard removes PHVY component lists whose item template has no static content', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: education-record
    baseType: expandable
    schema:
      expandableStubBlocks:
        children: []
      expandableContentBlocks:
        children: []
---

<!--hvy: {"id":"education"}-->
#! Education

 <!--hvy:text {}-->
  # Education

 <!--hvy:component-list {"componentListComponent":"education-record","componentListItemLabel":"education record"}-->
`);
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');
  installEditorClipboardComponentDefinitions(target);
  const pasted = cloneSectionFromEditorClipboard(1)!;

  const expectedResult = prepareSectionForDocumentPasteWithResult(target, pasted);

  expect(target.meta.component_defs).toBeUndefined();
  expect(expectedResult.removedCount).toBe(1);
  expect(expectedResult.section.blocks.map((block) => block.schema.component)).toEqual(['text']);
});

test('section clipboard adapts expandable blocks into static PHVY containers', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    Stub text

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Content text
`, '.hvy');
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');
  const pasted = cloneSectionFromEditorClipboard(1)!;

  const expectedResult = prepareSectionForDocumentPasteWithResult(target, pasted);

  expect(expectedResult.removedCount).toBe(1);
  expect(expectedResult.section.blocks.map((block) => block.schema.component)).toEqual(['container', 'container']);
  expect(expectedResult.section.blocks[0]?.schema.containerBlocks[0]?.text).toBe('Stub text');
  expect(expectedResult.section.blocks[1]?.schema.containerBlocks[0]?.text).toBe('Content text');
});

test('section clipboard adapts expandable component-list item templates for PHVY paste', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: education-record
    baseType: expandable
    schema:
      expandableStubBlocks:
        children:
          - text: "Degree"
            schema:
              component: text
      expandableContentBlocks:
        children:
          - text: "School"
            schema:
              component: text
---

<!--hvy: {"id":"education"}-->
#! Education

 <!--hvy:text {}-->
  # Education

 <!--hvy:component-list {"componentListComponent":"education-record","componentListItemLabel":"education record"}-->
`);
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');
  installEditorClipboardComponentDefinitions(target);
  const pasted = cloneSectionFromEditorClipboard(1)!;

  const expectedResult = prepareSectionForDocumentPasteWithResult(target, pasted);

  expect(target.meta.component_defs?.[0]?.name).toBe('education-record');
  expect(target.meta.component_defs?.[0]?.baseType).toBe('container');
  expect(target.meta.component_defs?.[0]?.schema?.containerBlocks).toHaveLength(2);
  expect(expectedResult.removedCount).toBe(0);
  expect(expectedResult.section.blocks.map((block) => block.schema.component)).toEqual(['text', 'component-list']);
});

test('section clipboard preserves custom expandable component-list item contents as PHVY container children', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: education-record
    baseType: expandable
    schema:
      expandableStubBlocks:
        children: []
      expandableContentBlocks:
        children:
          - text: "Degree"
            schema:
              component: text
---

<!--hvy: {"id":"education"}-->
#! Education

 <!--hvy:component-list {"componentListComponent":"education-record","componentListItemLabel":"education record"}-->
  <!--hvy:component-list:0 {}-->

   <!--hvy:education-record {"id":"computer-science-bs","xrefTitle":"Computer Science, BS","xrefDetail":"Washington State University"}-->
    <!--hvy:expandable:content {}-->

     <!--hvy:text {"css":"margin: 0 0 0.25rem;","placeholder":"Degree"}-->
      Computer Science, BS
`, '.hvy');
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');
  installEditorClipboardComponentDefinitions(target);
  const pasted = cloneSectionFromEditorClipboard(1)!;

  const expectedResult = prepareSectionForDocumentPasteWithResult(target, pasted);
  const item = expectedResult.section.blocks[0]?.schema.componentListBlocks[0];
  const serialized = serializeSectionFragment(expectedResult.section, target.meta);

  expect(item?.schema.component).toBe('education-record');
  expect(item?.schema.kind).toBe('container');
  expect(item?.schema.containerBlocks[0]?.schema.containerBlocks[0]?.text).toBe('Computer Science, BS');
  expect(serialized).toContain('<!--hvy:education-record {"id":"computer-science-bs"');
  expect(serialized).toContain('Computer Science, BS');
  expect(serialized).not.toContain('<!--hvy:expandable:content');
});

test('section clipboard converts custom expandable component-list item defaults when instance content is omitted', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: education-record
    baseType: expandable
    schema:
      expandableStubBlocks:
        children: []
      expandableContentBlocks:
        children:
          - text: "Degree"
            schema:
              component: text
---

<!--hvy: {"id":"education"}-->
#! Education

 <!--hvy:component-list {"componentListComponent":"education-record","componentListItemLabel":"education record"}-->
  <!--hvy:component-list:0 {}-->

   <!--hvy:education-record {"id":"computer-science-bs"}-->
`, '.hvy');
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');
  installEditorClipboardComponentDefinitions(target);
  const pasted = cloneSectionFromEditorClipboard(1)!;

  const expectedResult = prepareSectionForDocumentPasteWithResult(target, pasted);
  const item = expectedResult.section.blocks[0]?.schema.componentListBlocks[0];

  expect(item?.schema.component).toBe('education-record');
  expect(item?.schema.kind).toBe('container');
  expect(item?.schema.containerBlocks[0]?.schema.containerBlocks[0]?.text).toBe('Degree');
});

test('section clipboard hydrates empty custom container instances from adapted PHVY definitions', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: education-record
    baseType: container
    templateVariables:
      degree:
        label: Degree
      institution:
        label: School / University
      description:
        label: Description
    schema:
      xrefTitle: "{% degree %}"
      xrefDetail: "{% institution %}"
      containerBlocks:
        - text: ""
          schema:
            component: container
            containerBlocks:
              - text: "{% degree %}"
                schema:
                  component: text
                  placeholder: Degree
              - text: "{% institution %}"
                schema:
                  component: text
                  placeholder: School / University
              - text: "{% description | block %}"
                schema:
                  component: text
                  placeholder: Description
---

<!--hvy: {"id":"education"}-->
#! Education

 <!--hvy:component-list {"componentListComponent":"education-record","componentListItemLabel":"education record"}-->
  <!--hvy:component-list:0 {}-->

   <!--hvy:education-record {"id":"computer-science-bs","xrefTitle":"Computer Science, BS","xrefDetail":"Washington State University"}-->
`, '.hvy');
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');
  installEditorClipboardComponentDefinitions(target);
  const pasted = cloneSectionFromEditorClipboard(1)!;

  const expectedResult = prepareSectionForDocumentPasteWithResult(target, pasted);
  const item = expectedResult.section.blocks[0]?.schema.componentListBlocks[0];
  const serialized = serializeSectionFragment(expectedResult.section, target.meta);

  expect(item?.schema.component).toBe('education-record');
  expect(item?.schema.kind).toBe('container');
  expect(item?.schema.containerBlocks[0]?.schema.containerBlocks[0]?.text).toBe('Computer Science, BS');
  expect(item?.schema.containerBlocks[0]?.schema.containerBlocks[1]?.text).toBe('Washington State University');
  expect(item?.schema.containerBlocks[0]?.schema.containerBlocks[2]?.text).toBe('<!-- value {"placeholder":"Description"} -->');
  expect(serialized).toContain('Computer Science, BS');
  expect(serialized).toContain('Washington State University');
  expect(serialized).not.toContain('{% degree %}');
});

test('section clipboard keeps PHVY-adapted expandable definitions renderable when the stub is empty', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: education-record
    baseType: expandable
    schema:
      expandableStubBlocks:
        children: []
      expandableContentBlocks:
        children:
          - text: "School"
            schema:
              component: text
---

<!--hvy: {"id":"education"}-->
#! Education

 <!--hvy:component-list {"componentListComponent":"education-record","componentListItemLabel":"education record"}-->
`, '.hvy');
  delete (source.meta.component_defs?.[0]?.schema as Record<string, unknown>).css;
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');

  installEditorClipboardComponentDefinitions(target);

  expect(target.meta.component_defs?.[0]?.baseType).toBe('container');
  expect(typeof target.meta.component_defs?.[0]?.schema?.css).toBe('string');
  expect(target.meta.component_defs?.[0]?.schema?.containerBlocks).toHaveLength(1);
  expect(typeof target.meta.component_defs?.[0]?.schema?.containerBlocks[0]?.schema.css).toBe('string');
});

test('section clipboard skips PHVY-adapted expandable panes that only contain empty containers', () => {
  const source = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: education-record
    baseType: expandable
    schema:
      expandableStubBlocks:
        children:
          - text: ""
            schema:
              component: container
              containerBlocks: []
      expandableContentBlocks:
        children:
          - text: "School"
            schema:
              component: text
---

<!--hvy: {"id":"education"}-->
#! Education

 <!--hvy:component-list {"componentListComponent":"education-record","componentListItemLabel":"education record"}-->
`, '.hvy');
  initState(createTestState(source));
  copySectionToEditorClipboard(source.sections[0]!, [], source);
  const target = deserializeDocument(`---
hvy_version: 0.1
---
`, '.phvy');

  installEditorClipboardComponentDefinitions(target);

  expect(target.meta.component_defs?.[0]?.baseType).toBe('container');
  expect(target.meta.component_defs?.[0]?.schema?.containerBlocks).toHaveLength(1);
  expect(target.meta.component_defs?.[0]?.schema?.containerBlocks[0]?.schema.containerBlocks[0]?.text).toBe('School');
});
