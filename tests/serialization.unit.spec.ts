import { expect, test } from 'vitest';

import { deserializeDocument, HVY_TAIL_SENTINEL, serializeBlockFragment, serializeDocumentBytes, wrapHvyFragmentAsDocument } from '../src/serialization';
import {
  normalizeSerialized,
  registerSerializationTestState,
  serializeWithState,
} from './serialization-test-helpers';

registerSerializationTestState();

test('serializes a single block fragment without document wrappers', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    Short summary

  <!--hvy:expandable:content {}-->

   <!--hvy:xref-card {"xrefTitle":"Details","xrefTarget":"summary-details"}-->
`, '.hvy');

  const block = document.sections[0]?.blocks[0];
  expect(block).toBeTruthy();
  const fragment = serializeBlockFragment(block!);

  expect(fragment).toMatch(/^<!--hvy:expandable /);
  expect(fragment).toContain('<!--hvy:expandable:stub {}-->');
  expect(fragment).toContain('<!--hvy:expandable:content {}-->');
  expect(fragment).not.toContain('#! Summary');
  expect(fragment).not.toContain('hvy_version:');
});

test('serializes slot markers without child component payloads', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"layout"}-->
#! Layout

 <!--hvy:grid {"gridColumns":2}-->

  <!--hvy:grid:0 {"id":"skills"}-->

   <!--hvy:component-list {"componentListComponent":"text"}-->
    ## Skills

  <!--hvy:grid:1 {"id":"details"}-->

   <!--hvy:container {}-->

    <!--hvy:container:0 {}-->

     <!--hvy:text {}-->
      Detail body
`;

  const document = deserializeDocument(input, '.hvy');
  const output = serializeWithState(document);

  expect(output).toMatch(/<!--hvy:grid:0 {"id":"skills"}-->/);
  expect(output).toMatch(/\n\s*<!--hvy:component-list \{\}-->/);
  expect(output).toMatch(/\n\s*<!--hvy:container \{\}-->/);
  expect(output).not.toMatch(/<!--hvy:grid:\d+\s+\{[^\n>]*"component"/);
  expect(output).not.toMatch(/<!--hvy:grid:\d+\s+\{[^\n>]*"column"/);
  expect(output).not.toMatch(/<!--hvy:container:\d+\s+\{[^\n>]*"component"/);
  expect(output).not.toMatch(/<!--hvy:component-list:\d+\s+\{[^\n>]*"component"/);
});

test('round-trips trailing spaces in text block lines', () => {
  const input = [
    '---',
    'hvy_version: 0.1',
    '---',
    '',
    '<!--hvy: {"id":"locations"}-->',
    '#! Locations',
    '',
    ' <!--hvy:text {"css":"margin: 0.5rem 0; line-height: 1.5;","lock":true}-->',
    '  **Location:** ',
    '',
    '  **Target Location(s):** ',
    '',
  ].join('\n');

  const document = deserializeDocument(input, '.hvy');
  const block = document.sections[0]?.blocks[0];

  expect(block?.text).toBe('**Location:** \n\n**Target Location(s):** ');

  const expectedResult = serializeWithState(document);
  expect(expectedResult).toContain('  **Location:** \n');
  expect(expectedResult.endsWith('  **Target Location(s):** \n')).toBe(true);
});

test('serializes expandable stub and content css fields on the expandable slot markers', () => {
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
  const output = serializeWithState(document);

  expect(output).toContain('<!--hvy:expandable:stub {"css":"padding: 0.25rem 0;"}-->');
  expect(output).toContain('<!--hvy:expandable:content {"css":"margin-top: 0.5rem;"}-->');
  expect(output).not.toContain('"expandableStubCss"');
  expect(output).not.toContain('"expandableContentCss"');
});

test('preserves reader_max_width in document front matter on round-trip', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
reader_max_width: 60rem
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Hello
`, '.hvy');

  const output = serializeWithState(document);

  expect(output).toContain('reader_max_width: 60rem');
});

test('serializes plugin blocks with plugin identity and config', () => {
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

  const output = serializeWithState(document);

  expect(output).toContain('<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->');
  expect(output).not.toContain('"pluginUrl"');
});

test('serializes db-table query text in the plugin block body', () => {
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

  const output = serializeWithState(document);

  expect(output).toContain('<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->');
  expect(output).toContain('SELECT company, status');
  expect(output).toContain("WHERE status != 'Rejected'");
});

test('serializes db-table query window settings in plugin config', () => {
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

  const output = serializeWithState(document);

  expect(output).toContain('"queryDynamicWindow":false');
  expect(output).toContain('"queryLimit":25');
});

test('serializes a document tail preamble and binary bytes for attached SQLite payloads', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
`, '.hvy');

  document.attachments = [
    {
      id: 'db',
      meta: {
        plugin: 'dev.heavy.db-table',
        mediaType: 'application/vnd.sqlite3',
        encoding: 'gzip',
      },
      bytes: new Uint8Array([31, 139, 8, 0, 72, 86, 89]),
    },
  ];

  const serializedText = serializeWithState(document);
  const serializedBytes = serializeDocumentBytes(document);
  const tailLength = document.attachments[0].bytes.length;
  const serializedPrefix = new TextDecoder().decode(serializedBytes.slice(0, serializedBytes.length - tailLength));

  expect(serializedText).toContain('<!--hvy:tail {"id":"db","plugin":"dev.heavy.db-table","mediaType":"application/vnd.sqlite3","encoding":"gzip","length":7}-->');
  expect(serializedText).toContain(HVY_TAIL_SENTINEL);
  expect(serializedPrefix).toContain(HVY_TAIL_SENTINEL);
  expect(Array.from(serializedBytes.slice(-tailLength))).toEqual([31, 139, 8, 0, 72, 86, 89]);
});

test('preserves section_defaults in document front matter on round-trip', () => {
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

  const output = serializeWithState(document);

  expect(output).toContain('section_defaults:');
  expect(output).toContain('css: "margin: 0.5rem 0;"');
});

test('wrapHvyFragmentAsDocument includes optional front matter metadata', () => {
  const wrapped = wrapHvyFragmentAsDocument('<!--hvy:text {}-->\n Hello', {
    meta: {
      component_defaults: {
        'xref-card': {
          css: 'padding: 0.5rem;',
        },
      },
    },
  });

  expect(wrapped).toContain('hvy_version: 0.1');
  expect(wrapped).toContain('reader_max_width: 60rem');
  expect(wrapped).toContain('component_defaults:');
  expect(wrapped).toContain('xref-card:');
  expect(wrapped).toContain('css: "padding: 0.5rem;"');
});

test('keeps sibling blocks under a single expandable stub slot on round-trip', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:table {}-->

   <!--hvy:container {}-->
`;

  const document = deserializeDocument(input, '.hvy');
  const output = serializeWithState(document);

  expect((output.match(/<!--hvy:expandable:stub \{\}-->/g) ?? []).length).toBe(1);
  expect(output).toMatch(/<!--hvy:expandable:stub \{\}-->[\s\S]*<!--hvy:table \{\}-->[\s\S]*<!--hvy:container \{\}-->/);
});

test('custom grid components use direct grid slots without an extra grid wrapper', () => {
  const input = `---
hvy_version: 0.1
component_defs:
  - name: skills-and-tools-tech-list
    baseType: grid
    schema:
      css: "margin: 0.5rem 0 0;"
      gridColumns: 2
      gridItems:
        - id: relevant-skills
          block:
            text: ""
            schema:
              component: component-list
              componentListComponent: xref-card
              css: "margin: 0;"
        - id: tools-technologies
          block:
            text: ""
            schema:
              component: component-list
              componentListComponent: xref-card
              css: "margin: 0;"
---

<!--hvy: {"id":"layout"}-->
#! Layout

 <!--hvy:skills-and-tools-tech-list {}-->

  <!--hvy:grid:0 {"id":"history-skills"}-->

   <!--hvy:component-list {"componentListComponent":"xref-card","css":"margin: 0;"}-->

    <!--hvy:component-list:0 {}-->

     <!--hvy:text {}-->
      #### Skills

  <!--hvy:grid:1 {"id":"history-tools-technologies"}-->

   <!--hvy:component-list {"componentListComponent":"xref-card","css":"margin: 0;"}-->

    <!--hvy:component-list:0 {}-->

     <!--hvy:text {}-->
      #### Tools
`;

  const document = deserializeDocument(input, '.hvy');
  const output = serializeWithState(document);

  expect(output).toContain('<!--hvy:skills-and-tools-tech-list {}-->');
  expect(output).toMatch(/<!--hvy:grid:0 {"id":"history-skills"}-->/);
  expect(output).toMatch(/<!--hvy:grid:1 {"id":"history-tools-technologies"}-->/);
  expect(output).not.toMatch(/<!--hvy:grid:\d+\s+\{[^\n>]*"column"/);
  expect(output).not.toMatch(/<!--hvy:skills-and-tools-tech-list \{[^]*?<!--hvy:grid \{\}-->/);
});

test('component-list numeric slot indexes control display order with file order breaking ties', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"ordered-list"}-->
#! Ordered List

 <!--hvy:component-list {"componentListComponent":"text"}-->

  <!--hvy:component-list:2 {}-->

   <!--hvy:text {}-->
    Third in file, index 2

  <!--hvy:component-list:1 {}-->

   <!--hvy:text {}-->
    First by index

  <!--hvy:component-list:1 {}-->

   <!--hvy:text {}-->
    Second by tie-break
`;

  const document = deserializeDocument(input, '.hvy');
  const listBlock = document.sections[0]?.blocks[0];
  const items = listBlock.schema.componentListBlocks.map((block) => block.text);

  expect(items).toEqual([
    'First by index',
    'Second by tie-break',
    'Third in file, index 2',
  ]);
});

test('component-list item labels round-trip through directives', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:component-list {"componentListComponent":"skill-record","componentListItemLabel":"skill"}-->
`;

  const document = deserializeDocument(input, '.hvy');
  const listBlock = document.sections[0]?.blocks[0];
  const output = serializeWithState(document);

  expect(listBlock.schema.componentListItemLabel).toBe('skill');
  expect(output).toContain('<!--hvy:component-list {"componentListComponent":"skill-record","componentListItemLabel":"skill"}-->');
});

test('serializes uncontained section metadata without changing section shape on round-trip', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary","contained":false,"custom_css":"padding: 0 0.35rem;"}-->
#! Summary

 <!--hvy:text {}-->
  Summary body
`;

  const document = deserializeDocument(input, '.hvy');
  const output = serializeWithState(document);
  const roundTripped = deserializeDocument(output, '.hvy');

  expect(output).toContain('<!--hvy: {"id":"summary","lock":false,"expanded":true,"highlight":false,"contained":false,"custom_css":"padding: 0 0.35rem;"}-->');
  expect(roundTripped.sections[0]?.contained).toBe(false);
  expect(roundTripped.sections[0]?.customCss).toBe('padding: 0 0.35rem;');
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
      /<!--hvy:(?:expandable:(?:stub|content)|grid:\d+|component-list:\d+|container:\d+)\s+\{[^\n>]*"component"/
    );
    expect(output, path).not.toMatch(/<!--hvy:skills-and-tools-tech-list \{[^]*?<!--hvy:grid \{\}-->/);
  }
});

test('serialize -> deserialize -> serialize stays stable for migrated examples', async () => {
  const fs = await import('node:fs/promises');
  const files: Array<[string, '.hvy' | '.thvy']> = [
    ['examples/resume.hvy', '.hvy'],
    ['examples/resume.thvy', '.thvy'],
    ['examples/example.hvy', '.hvy'],
  ];

  for (const [path, extension] of files) {
    const input = await fs.readFile(path, 'utf8');
    const firstDocument = deserializeDocument(input, extension);
    const firstSerialized = serializeWithState(firstDocument);
    const secondDocument = deserializeDocument(firstSerialized, extension);
    const secondSerialized = serializeWithState(secondDocument);

    expect(normalizeSerialized(secondSerialized), `${path} should be stable after one round-trip`).toBe(
      normalizeSerialized(firstSerialized)
    );
  }
});

test('image component round-trips imageFile and imageAlt schema fields', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"cover"}-->
#! Cover

<!--hvy:image {"imageFile":"hero.png","imageAlt":"Cover photo","css":"margin: 0.5rem auto; display: block;"}-->
`, '.hvy');

  const block = document.sections[0]?.blocks[0];
  expect(block?.schema.component).toBe('image');
  expect(block?.schema.imageFile).toBe('hero.png');
  expect(block?.schema.imageAlt).toBe('Cover photo');

  const output = serializeWithState(document);
  expect(output).toContain('<!--hvy:image {');
  expect(output).toContain('"imageFile":"hero.png"');
  expect(output).toContain('"imageAlt":"Cover photo"');
});

test('serializes and parses multiple tail attachments with byte slicing', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:image {"imageFile":"a.png"}-->
`, '.hvy');

  document.attachments = [
    {
      id: 'db',
      meta: { plugin: 'dev.heavy.db-table', mediaType: 'application/vnd.sqlite3', encoding: 'gzip' },
      bytes: new Uint8Array([1, 2, 3, 4]),
    },
    {
      id: 'image:a.png',
      meta: { mediaType: 'image/png' },
      bytes: new Uint8Array([10, 20, 30]),
    },
  ];

  const serializedBytes = serializeDocumentBytes(document);
  const serializedText = new TextDecoder().decode(serializedBytes);
  expect(serializedText).toContain('"id":"db"');
  expect(serializedText).toContain('"length":4');
  expect(serializedText).toContain('"id":"image:a.png"');
  expect(serializedText).toContain('"length":3');
  expect(serializedText).toContain(HVY_TAIL_SENTINEL);

  // Bytes after sentinel should equal concatenation of the two attachments.
  const sentinelMarker = `\n${HVY_TAIL_SENTINEL}\n`;
  const sentinelIndex = serializedText.lastIndexOf(sentinelMarker);
  const tailStart = new TextEncoder().encode(serializedText.slice(0, sentinelIndex + sentinelMarker.length)).length;
  expect(Array.from(serializedBytes.slice(tailStart))).toEqual([1, 2, 3, 4, 10, 20, 30]);
});

test('round-trips multiple tail attachments through serialize -> bytes -> deserialize', async () => {
  const { deserializeDocumentBytesWithDiagnostics } = await import('../src/serialization');

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data
`, '.hvy');

  document.attachments = [
    {
      id: 'db',
      meta: { mediaType: 'application/octet-stream' },
      bytes: new Uint8Array([1, 2, 3, 4]),
    },
    {
      id: 'image:a.png',
      meta: { mediaType: 'image/png' },
      bytes: new Uint8Array([10, 20, 30]),
    },
  ];

  const bytes = serializeDocumentBytes(document);
  const result = deserializeDocumentBytesWithDiagnostics(bytes, '.hvy');

  expect(result.document.attachments).toHaveLength(2);
  expect(result.document.attachments[0].id).toBe('db');
  expect(Array.from(result.document.attachments[0].bytes)).toEqual([1, 2, 3, 4]);
  expect(result.document.attachments[1].id).toBe('image:a.png');
  expect(Array.from(result.document.attachments[1].bytes)).toEqual([10, 20, 30]);
});
