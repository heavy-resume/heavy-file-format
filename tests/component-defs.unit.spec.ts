import { expect, test } from 'vitest';

import { renderReusableSectionOptions } from '../src/component-defs';
import { createEmptyBlock, instantiateReusableSection } from '../src/document-factory';
import { deserializeDocument } from '../src/serialization';
import { state } from '../src/state';
import { registerSerializationTestState } from './serialization-test-helpers';

registerSerializationTestState();

test('reusable section options hide used non-repeatable templates and keep repeatable templates', () => {
  state.document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Projects
    key: resume-projects
    template:
      id: projects
      title: Projects
      level: 1
      blocks: []
      children: []
  - name: Resume Section
    key: resume-section
    repeatable: true
    template:
      title: Resume Section
      level: 1
      blocks: []
      children: []
---

<!--hvy: {"id":"projects","templateKey":"resume-projects"}-->
#! Projects
`, '.hvy');

  const expectedResult = renderReusableSectionOptions('blank');

  expect(expectedResult).toContain('value="blank"');
  expect(expectedResult).not.toContain('Projects');
  expect(expectedResult).toContain('Resume Section');
});

test('reusable section instantiation uses fill-in markers for blank template variables', () => {
  state.document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Resume Section
    key: resume-section
    repeatable: true
    templateVariables:
      section_title:
        label: Section title
      row_label:
        label: Row label
    template:
      title: Resume Section
      level: 1
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
        - text: ""
          schema:
            component: table
            tableColumns: ["ITEM"]
            tableRows:
              - cells: ["{% row_label %}"]
      children: []
---
`, '.hvy');

  const expectedResult = instantiateReusableSection('resume-section', 1);

  expect(expectedResult?.templateKey).toBe('resume-section');
  expect(expectedResult?.blocks[0]?.text).toContain('Section title');
  expect(expectedResult?.blocks[0]?.text).not.toContain('{%');
  expect(expectedResult?.blocks[1]?.schema.tableRows[0]?.cells[0]).toBe('');
});

test('generic resume section row component creates an empty expandable table row', () => {
  state.document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: resume-section-row
    baseType: expandable
    description: Generic resume section table row
    schema:
      css: "margin: 0;"
      expandableAlwaysShowStub: true
      expandableExpanded: false
      expandableStubBlocks:
        children:
          - text: ""
            schema:
              component: table
              css: "margin: 0; margin-top: -1px;"
              tableColumns: ["ITEM", "SUMMARY"]
              tableShowHeader: false
              tableRows:
                - cells: ["", ""]
      expandableContentBlocks:
        css: "padding: 0.5rem;"
        children:
          - text: ""
            schema:
              component: text
              placeholder: "Row details"
              css: "margin: 0;"
---
`, '.hvy');

  const expectedResult = createEmptyBlock('resume-section-row');

  expect(expectedResult.schema.component).toBe('resume-section-row');
  expect(expectedResult.schema.expandableStubBlocks.children[0]?.schema.component).toBe('table');
  expect(expectedResult.schema.expandableStubBlocks.children[0]?.schema.tableRows[0]?.cells).toEqual(['', '']);
  expect(expectedResult.schema.expandableContentBlocks.children[0]?.schema.placeholder).toBe('Row details');
});
