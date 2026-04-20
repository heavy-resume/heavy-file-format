import { expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import {
  normalizeSerialized,
  registerSerializationTestState,
  serializeWithState,
} from './serialization-test-helpers';

registerSerializationTestState();

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

test('serializes expandable stub and content css fields on the parent expandable block', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false,"expandableStubCss":"padding: 0.25rem 0;","expandableContentCss":"margin-top: 0.5rem;"}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    Stub

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Content
`;

  const document = deserializeDocument(input, '.hvy');
  const output = serializeWithState(document);

  expect(output).toContain('"expandableStubCss":"padding: 0.25rem 0;"');
  expect(output).toContain('"expandableContentCss":"margin-top: 0.5rem;"');
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
          column: left
          block:
            text: ""
            schema:
              component: component-list
              componentListComponent: xref-card
              css: "margin: 0;"
        - id: tools-technologies
          column: right
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

  <!--hvy:grid:0 {"id":"history-skills","column":"left"}-->

   <!--hvy:component-list {"componentListComponent":"xref-card","css":"margin: 0;"}-->

    <!--hvy:component-list:0 {}-->

     <!--hvy:text {}-->
      #### Skills

  <!--hvy:grid:1 {"id":"history-tools-technologies","column":"right"}-->

   <!--hvy:component-list {"componentListComponent":"xref-card","css":"margin: 0;"}-->

    <!--hvy:component-list:0 {}-->

     <!--hvy:text {}-->
      #### Tools
`;

  const document = deserializeDocument(input, '.hvy');
  const output = serializeWithState(document);

  expect(output).toContain('<!--hvy:skills-and-tools-tech-list {}-->');
  expect(output).toMatch(/<!--hvy:grid:0 {"id":"history-skills","column":"left"}-->/);
  expect(output).toMatch(/<!--hvy:grid:1 {"id":"history-tools-technologies","column":"right"}-->/);
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
      /<!--hvy:(?:expandable:(?:stub|content)|grid:\d+|component-list:\d+|container:\d+|table:\d+:\d+)\s+\{[^\n>]*"component"/
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
