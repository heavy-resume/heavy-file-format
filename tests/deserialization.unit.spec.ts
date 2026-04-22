import { expect, test } from 'vitest';

import { deserializeDocument, deserializeDocumentWithDiagnostics, getHvyDiagnosticUsageHint, getHvyResponseDiagnostics } from '../src/serialization';
import { registerSerializationTestState } from './serialization-test-helpers';

registerSerializationTestState();

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

test('deserializes reader_max_width from document front matter', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
reader_max_width: 60rem
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Hello
`, '.hvy');

  expect(document.meta.reader_max_width).toBe('60rem');
});

test('deserializes expandable stub and content css fields', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {"css":"padding: 0.25rem 0;"}-->

   <!--hvy:text {}-->
    Stub

  <!--hvy:expandable:content {"css":"margin-top: 0.5rem;"}-->

   <!--hvy:text {}-->
    Content
`;

  const document = deserializeDocument(input, '.hvy');
  const block = document.sections[0]?.blocks[0];

  expect(block.schema.expandableStubCss).toBe('padding: 0.25rem 0;');
  expect(block.schema.expandableContentCss).toBe('margin-top: 0.5rem;');
});

test('deserializes uncontained section metadata', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary","contained":false,"custom_css":"padding: 0 0.35rem;"}-->
#! Summary

 <!--hvy:text {}-->
  Summary body
`;

  const document = deserializeDocument(input, '.hvy');
  const section = document.sections[0];

  expect(section?.contained).toBe(false);
  expect(section?.customCss).toBe('padding: 0 0.35rem;');
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

test('deserializes component-list slot order separately from file order', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"ordered-list"}-->
#! Ordered List

 <!--hvy:component-list {"componentListComponent":"text"}-->

  <!--hvy:component-list:3 {}-->

   <!--hvy:text {}-->
    Three

  <!--hvy:component-list:0 {}-->

   <!--hvy:text {}-->
    Zero

  <!--hvy:component-list:2 {}-->

   <!--hvy:text {}-->
    Two
`;

  const document = deserializeDocument(input, '.hvy');
  const listBlock = document.sections[0]?.blocks[0];

  expect(listBlock.schema.componentListBlocks.map((block) => block.text)).toEqual(['Zero', 'Two', 'Three']);
});

test('resume education record keeps C/C++ inside the education tools list', async () => {
  const fs = await import('node:fs/promises');
  const input = await fs.readFile('examples/resume.hvy', 'utf8');
  const document = deserializeDocument(input, '.hvy');
  const educationSection = document.sections.find((section) => section.customId === 'education');

  expect(educationSection).toBeTruthy();
  const educationList = educationSection!.blocks.find((block) => block.schema.component === 'component-list');
  expect(educationList).toBeTruthy();
  expect(educationList!.schema.component).toBe('component-list');

  const educationRecord = educationList!.schema.componentListBlocks[0];
  expect(educationRecord.schema.component).toBe('education-record');

  const skillsToolsBlock = educationRecord.schema.expandableContentBlocks.children.find(
    (block) => block.schema.component === 'skills-and-tools-tech-list'
  );
  expect(skillsToolsBlock).toBeTruthy();
  expect(skillsToolsBlock!.schema.gridItems).toHaveLength(2);

  const toolsList = skillsToolsBlock!.schema.gridItems[1]?.block;
  expect(toolsList?.schema.component).toBe('component-list');

  const toolTitles = toolsList!.schema.componentListBlocks
    .filter((block) => block.schema.component === 'xref-card')
    .map((block) => block.schema.xrefTitle);

  expect(toolTitles).toContain('Python');
  expect(toolTitles).toContain('C/C++');
});

test('deserialization reports invalid block directive json as diagnostics with concise hints', () => {
 const result = deserializeDocumentWithDiagnostics(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {"css":"margin: 0",}-->
  Broken
`, '.hvy');

  expect(result.document.sections[0]?.title).toBe('Summary');
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'invalid_block_directive_json',
      }),
    ])
  );
  expect(getHvyDiagnosticUsageHint(result.diagnostics[0]!)).toBe('Component directives must use JSON objects like `<!--hvy:text {}-->`.');
});

test('response diagnostics report orphaned expandable slots with minimal usage hints', () => {
  const diagnostics = getHvyResponseDiagnostics(`<!--hvy:expandable:stub {}-->

<!--hvy:text {}-->
Stub only`);

  expect(diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        code: 'expandable_slot_without_parent',
      }),
    ])
  );
  expect(getHvyDiagnosticUsageHint(diagnostics[0]!)).toBe(
    'Put expandable slots under `<!--hvy:expandable {}-->`, then add `stub` or `content`.'
  );
});

test('expandable missing stub or content reports errors with concise hints', () => {
  const result = deserializeDocumentWithDiagnostics(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    Stub only
`, '.hvy');

  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'expandable_missing_content',
      }),
    ])
  );
  const diagnostic = result.diagnostics.find((entry) => entry.code === 'expandable_missing_content');
  expect(getHvyDiagnosticUsageHint(diagnostic!)).toBe(
    'An expandable needs a content slot like `<!--hvy:expandable:content {}-->`.'
  );
});

test('xref-card missing title is an error and missing target is a warning', () => {
  const result = deserializeDocumentWithDiagnostics(`---
hvy_version: 0.1
---

<!--hvy: {"id":"links"}-->
#! Links

 <!--hvy:xref-card {"xrefDetail":"Detail only"}-->
`, '.hvy');

  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'xref_card_missing_title',
      }),
      expect.objectContaining({
        severity: 'warning',
        code: 'xref_card_missing_target',
      }),
    ])
  );

  const titleDiagnostic = result.diagnostics.find((entry) => entry.code === 'xref_card_missing_title');
  const targetDiagnostic = result.diagnostics.find((entry) => entry.code === 'xref_card_missing_target');
  expect(getHvyDiagnosticUsageHint(titleDiagnostic!)).toBe(
    'An xref-card needs `xrefTitle`, for example `<!--hvy:xref-card {"xrefTitle":"Label"}-->`.'
  );
  expect(getHvyDiagnosticUsageHint(targetDiagnostic!)).toBe(
    'Add `xrefTarget`, for example `<!--hvy:xref-card {"xrefTarget":"section-id"}-->`.'
  );
});
