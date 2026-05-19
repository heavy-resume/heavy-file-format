import { expect, test } from 'vitest';

import { buildImportXrefBatches, buildImportXrefTargetInventory } from '../src/ai-import-xref-batches';
import { deserializeDocument } from '../src/serialization';

test('buildImportXrefBatches creates a section-level batch for top-level xref lists', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"skill-typescript","tags":"skill"}-->
TypeScript

<!--hvy:component-list {"id":"refs","componentListComponent":"xref-card","componentListItemLabel":"reference"}-->
`, '.hvy');

  const expectedResult = buildImportXrefBatches(document, [document.sections[0]!.key]);

  expect(expectedResult).toHaveLength(1);
  expect(expectedResult[0]!.contextHvy).toContain('TypeScript');
  expect(expectedResult[0]!.lists.map((list) => list.listId)).toEqual(['L1']);
  expect(expectedResult[0]!.lists[0]!.path).toBe('/body/summary/refs');
});

test('buildImportXrefBatches splits nested parent component-list items into batches of two', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: history-record
    baseType: expandable
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:component-list {"id":"history-list","componentListComponent":"history-record"}-->

 <!--hvy:component-list:0 {"id":"history-one"}-->
  <!--hvy:text {}-->
   Item One
  <!--hvy:component-list {"id":"refs-one","componentListComponent":"xref-card"}-->

 <!--hvy:component-list:1 {"id":"history-two"}-->
  <!--hvy:text {}-->
   Item Two
  <!--hvy:component-list {"id":"refs-two","componentListComponent":"xref-card"}-->

 <!--hvy:component-list:2 {"id":"history-three"}-->
  <!--hvy:text {}-->
   Item Three
  <!--hvy:component-list {"id":"refs-three","componentListComponent":"xref-card"}-->
`, '.hvy');

  const expectedResult = buildImportXrefBatches(document, [document.sections[0]!.key]);

  expect(expectedResult).toHaveLength(2);
  expect(expectedResult[0]!.lists.map((list) => list.listId)).toEqual(['L1', 'L2']);
  expect(expectedResult[0]!.contextHvy).toContain('refs-one');
  expect(expectedResult[0]!.contextHvy).toContain('refs-two');
  expect(expectedResult[0]!.contextHvy).not.toContain('refs-three');
  expect(expectedResult[1]!.lists.map((list) => list.listId)).toEqual(['L1']);
  expect(expectedResult[1]!.contextHvy).not.toContain('refs-one');
  expect(expectedResult[1]!.contextHvy).toContain('refs-three');
});

test('buildImportXrefBatches detects custom xref component lists by base type', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: skill-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: skill
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"skill-react","tags":"skill"}-->
React

<!--hvy:text {"id":"tool-vite","tags":"tool"}-->
Vite

<!--hvy:component-list {"id":"skill-refs","componentListComponent":"skill-xref-card"}-->
`, '.hvy');

  const expectedResult = buildImportXrefBatches(document, [document.sections[0]!.key]);

  expect(expectedResult).toHaveLength(1);
  expect(expectedResult[0]!.lists[0]!.component).toBe('skill-xref-card');
  expect(expectedResult[0]!.lists[0]!.allowedTargets.map((target) => target.value)).toEqual(['skill-react']);
});

test('buildImportXrefTargetInventory matches dropdown labels and includes id paths', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"tool-typescript","tags":"tool","xrefDetail":"Primary language"}-->
TypeScript
`, '.hvy');

  const expectedResult = buildImportXrefTargetInventory(document, 'tool');

  expect(expectedResult).toEqual([
    {
      value: 'tool-typescript',
      title: 'TypeScript',
      detail: 'Primary language',
      label: 'TypeScript - Primary language (tool-typescript)',
      path: '/id/tool-typescript',
    },
  ]);
});
