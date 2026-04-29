import { expect, test } from 'vitest';

import { deserializeDocument, deserializeDocumentBytes, deserializeDocumentWithDiagnostics, getHvyDiagnosticUsageHint, getHvyResponseDiagnostics } from '../src/serialization';
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

test('deserializes grid text without preserving structural indentation as code indentation', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"experience"}-->
#! Experience

 <!--hvy:grid {"gridColumns":2}-->

  <!--hvy:grid:0 {"id":"location"}-->

   <!--hvy:text {}-->
   Seattle, WA

  <!--hvy:grid:1 {"id":"date-range"}-->

   <!--hvy:text {}-->
   05/2024 - present
`;

  const document = deserializeDocument(input, '.hvy');
  const grid = document.sections[0]?.blocks[0];

  expect(grid?.schema.gridItems[0]?.block.text).toBe('Seattle, WA');
  expect(grid?.schema.gridItems[1]?.block.text).toBe('05/2024 - present');
});

test('deserializes fenced code while removing outer structural indentation', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"snippet"}-->
#! Snippet

 <!--hvy:text {}-->
  \`\`\`ts
    const answer = 42;
  \`\`\`
`;

  const document = deserializeDocument(input, '.hvy');

  expect(document.sections[0]?.blocks[0]?.text).toBe('```ts\n  const answer = 42;\n```');
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

test('defaults reader_max_width for imported HVY without an explicit value', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Hello
`, '.hvy');

  expect(document.meta.reader_max_width).toBe('60rem');
  expect(document.meta.section_defaults).toEqual({
    css: 'margin: 0.5rem 0;',
  });
});

test('deserializes plugin blocks with plugin identity and config', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: dev.heavy.db-table
    source: builtin://db-table
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
`, '.hvy');

  const block = document.sections[0]?.blocks[0];

  expect(block?.schema.component).toBe('plugin');
  expect(block?.schema.plugin).toBe('dev.heavy.db-table');
  expect(block?.schema.pluginConfig).toEqual({
    source: 'with-file',
    table: 'work_items',
  });
});

test('deserializes a binary SQLite attachment tail from HVY bytes', () => {
  const prefix = `---
hvy_version: 0.1
plugins:
  - id: dev.heavy.db-table
    source: builtin://db-table
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
<!--hvy:tail {"id":"db","plugin":"dev.heavy.db-table","mediaType":"application/vnd.sqlite3","encoding":"gzip","length":7}-->
--HVY-TAIL--
`;
  const prefixBytes = new TextEncoder().encode(prefix);
  const tailBytes = new Uint8Array([31, 139, 8, 0, 83, 81, 76]);
  const bytes = new Uint8Array(prefixBytes.length + tailBytes.length);
  bytes.set(prefixBytes, 0);
  bytes.set(tailBytes, prefixBytes.length);

  const document = deserializeDocumentBytes(bytes, '.hvy');

  expect(document.attachments).toHaveLength(1);
  expect(document.attachments[0]?.id).toBe('db');
  expect(document.attachments[0]?.meta).toEqual({
    plugin: 'dev.heavy.db-table',
    mediaType: 'application/vnd.sqlite3',
    encoding: 'gzip',
  });
  expect(Array.from(document.attachments[0]?.bytes ?? [])).toEqual([31, 139, 8, 0, 83, 81, 76]);
});

test('deserializes section_defaults from document front matter', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defaults:
  css: "margin: 0.5rem 0;"
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Hello
`, '.hvy');

  expect(document.meta.section_defaults).toEqual({
    css: 'margin: 0.5rem 0;',
  });
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

test('deserializes db-table query text from the plugin block body', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: dev.heavy.db-table
    source: builtin://db-table
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
 SELECT company, status
 FROM work_items
 WHERE status != 'Rejected'
`, '.hvy');

  const block = document.sections[0]?.blocks[0];

  expect(block?.schema.plugin).toBe('dev.heavy.db-table');
  expect(block?.schema.pluginConfig).toEqual({
    source: 'with-file',
    table: 'work_items',
  });
  expect(block?.text).toBe("SELECT company, status\nFROM work_items\nWHERE status != 'Rejected'");
});

test('deserializes db-table query window settings from plugin config', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: dev.heavy.db-table
    source: builtin://db-table
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items","queryDynamicWindow":false,"queryLimit":25}}-->
 SELECT company FROM work_items
`, '.hvy');

  const block = document.sections[0]?.blocks[0];

  expect(block?.schema.pluginConfig).toEqual({
    source: 'with-file',
    table: 'work_items',
    queryDynamicWindow: false,
    queryLimit: 25,
  });
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
