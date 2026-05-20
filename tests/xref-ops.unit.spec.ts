import { expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { initState } from '../src/state';
import { applyXrefTargetDefaults, getEffectiveXrefTargetTagFilter, getXrefTargetOptions, isXrefTargetValid } from '../src/xref-ops';
import { createTestState } from './serialization-test-helpers';
import { createBlockFromReusableTemplateValues } from '../src/bind/actions/reusable-template';
import { assignAutoBlockId } from '../src/auto-block-id';

test('filters xref target options by section and component tags', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: skill-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: skill
---

<!--hvy: {"id":"skills","tags":"skills"}-->
#! Skills

 <!--hvy:text {"id":"skill-typescript"}-->
  TypeScript

 <!--hvy:text {"id":"skill-react","tags":"skill"}-->
  React

<!--hvy: {"id":"tools","tags":"tool"}-->
#! Tools

 <!--hvy:text {"id":"tool-vite"}-->
  Vite

<!--hvy: {"id":"featured"}-->
#! Featured

 <!--hvy:skill-xref-card {"xrefTitle":"TypeScript","xrefTarget":"skill-typescript"}-->
`, '.hvy');

  initState(createTestState(document));

  const expectedResult = getXrefTargetOptions('skill').map((option) => option.value);

  expect(expectedResult).toContain('skill-react');
  expect(expectedResult).not.toContain('skill-typescript');
  expect(expectedResult).not.toContain('skills');
  expect(expectedResult).not.toContain('tools');
  expect(expectedResult).not.toContain('tool-vite');
  expect(document.sections[2]?.blocks[0]?.schema.xrefTargetTagFilter).toBe('skill');
  expect(isXrefTargetValid('skill-react', 'skill')).toBe(true);
  expect(isXrefTargetValid('skill-typescript', 'skill')).toBe(false);
  expect(isXrefTargetValid('tool-vite', 'skill')).toBe(false);
});

test('xref target options only include sections with an explicit id', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: { }-->
#! Generated Key Only

<!--hvy: {"id":"explicit-section"}-->
#! Explicit Section
`, '.hvy');

  initState(createTestState(document));

  const expectedResult = getXrefTargetOptions().map((option) => option.value);

  expect(expectedResult).toContain('explicit-section');
  expect(expectedResult).not.toContain(document.sections[0]?.key);
});

test('xref target options sort alphabetically by visible title with id tie-breakers', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"zebra-section"}-->
#! Same

 <!--hvy:text {"id":"alpha-block"}-->
  Zebra

<!--hvy: {"id":"alpha-section"}-->
#! Alpha

 <!--hvy:text {"id":"beta-block"}-->
  Beta
`, '.hvy');

  initState(createTestState(document));

  const expectedResult = getXrefTargetOptions().map((option) => `${option.title}:${option.value}`);

  expect(expectedResult).toEqual(['Alpha:alpha-section', 'Beta:beta-block', 'Same:zebra-section', 'Zebra:alpha-block']);
});

test('auto ids new tagged reusable template blocks for xref target options', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: project-record
    baseType: expandable
    templateVariables:
      project:
        label: Project name
    schema:
      tags: project
      expandableStubBlocks:
        children:
          - text: "{% project %}"
            schema:
              component: text
  - name: project-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: project
---

<!--hvy: {"id":"projects"}-->
#! Projects

 <!--hvy:component-list {"id":"project-list","tags":"project","componentListComponent":"project-record"}-->

<!--hvy: {"id":"featured"}-->
#! Featured

 <!--hvy:project-xref-card {"xrefTitle":"Featured Project"}-->
`, '.hvy');

  initState(createTestState(document));
  const projectList = document.sections[0]?.blocks[0];
  const newProject = createBlockFromReusableTemplateValues('project-record', { project: 'Heavy Stack' });

  assignAutoBlockId(newProject, {
    document,
    inheritedTags: projectList?.schema.tags ?? '',
    sourceValues: { project: 'Heavy Stack' },
  });
  projectList?.schema.componentListBlocks.push(newProject);

  const expectedResult = getXrefTargetOptions('project').map((option) => option.value);

  expect(newProject.schema.id).toBe('project-heavy-stack');
  expect(expectedResult).toContain('project-heavy-stack');
});

test('xref target options fall back from unresolved template labels to visible target text', () => {
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

 <!--hvy:expandable {"id":"skill-foo","tags":"skill","xrefTitle":"{% skill %}","xrefDetail":"{% description | block %}","expandableAlwaysShowStub":true}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    ### Foo

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Useful real detail

<!--hvy: {"id":"featured"}-->
#! Featured

 <!--hvy:skill-xref-card {"xrefTarget":"skill-foo"}-->
`, '.hvy');

  initState(createTestState(document));

  const expectedResult = getXrefTargetOptions('skill').find((option) => option.value === 'skill-foo');

  expect(expectedResult?.title).toBe('Foo');
  expect(expectedResult?.detail).toBe('');
  expect(expectedResult?.label).toBe('Foo (skill-foo)');
  expect(expectedResult?.label).not.toContain('{% skill %}');
});

test('xref target options do not inherit record tags into generated reciprocal children', () => {
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

 <!--hvy:component-list {"tags":"skill","componentListComponent":"skill-record"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:skill-record {"id":"skill-python","tags":"skill","xrefTitle":"Python"}-->

    <!--hvy:expandable:content {}-->

     <!--hvy:text {"tags":"reciprocal-xref-generated"}-->
      #### Experience

     <!--hvy:component-list {"tags":"reciprocal-xref-generated","componentListComponent":"history-xref-card"}-->

      <!--hvy:component-list:0 {}-->

       <!--hvy:xref-card {"tags":"reciprocal-xref-generated","xrefTitle":"{% role %}","xrefDetail":"{% organization %}","xrefTarget":"history-acme"}-->
`, '.hvy');

  initState(createTestState(document));

  const expectedResult = getXrefTargetOptions('skill');

  expect(expectedResult.map((option) => option.value)).toEqual(['skill-python']);
  expect(expectedResult.map((option) => option.label).join('\n')).not.toContain('{% role %}');
  expect(expectedResult.map((option) => option.label).join('\n')).not.toContain('{% organization %}');
});

test('effective xref target tag filter falls back to reusable component definitions', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: history-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: history
---

<!--hvy: {"id":"history"}-->
#! History

 <!--hvy:history-record {"id":"history-acme","tags":"history","xrefTitle":"Acme"}-->

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:history-xref-card {"xrefTarget":"history-acme"}-->
`, '.hvy');

  const expectedResult = document.sections[1]?.blocks[0];

  expect(expectedResult?.schema.xrefTargetTagFilter).toBe('history');
  if (expectedResult) {
    expectedResult.schema.xrefTargetTagFilter = '';
  }
  expect(expectedResult ? getEffectiveXrefTargetTagFilter(document, expectedResult) : '').toBe('history');
});

test('changing xref target refreshes auto-derived title and detail', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"tools"}-->
#! Tools

 <!--hvy:text {"id":"tool-one","tags":"tool","xrefTitle":"Tool One","xrefDetail":"First detail"}-->

 <!--hvy:text {"id":"tool-two","tags":"tool","xrefTitle":"Tool Two","xrefDetail":"Second detail"}-->

 <!--hvy:xref-card {"xrefTargetTagFilter":"tool","xrefTarget":"tool-one"}-->
`, '.hvy');
  initState(createTestState(document));
  const expectedResult = document.sections[0]?.blocks[2];
  if (!expectedResult) {
    throw new Error('Expected xref block');
  }

  applyXrefTargetDefaults(expectedResult);
  expectedResult.schema.xrefTarget = 'tool-two';
  applyXrefTargetDefaults(expectedResult, 'tool-one');

  expect(expectedResult.schema.xrefTitle).toBe('Tool Two');
  expect(expectedResult.schema.xrefDetail).toBe('Second detail');
});

test('changing xref target preserves manual title and detail overrides', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"tools"}-->
#! Tools

 <!--hvy:text {"id":"tool-one","tags":"tool","xrefTitle":"Tool One","xrefDetail":"First detail"}-->

 <!--hvy:text {"id":"tool-two","tags":"tool","xrefTitle":"Tool Two","xrefDetail":"Second detail"}-->

 <!--hvy:xref-card {"xrefTargetTagFilter":"tool","xrefTarget":"tool-one","xrefTitle":"Custom title","xrefDetail":"Custom detail"}-->
`, '.hvy');
  initState(createTestState(document));
  const expectedResult = document.sections[0]?.blocks[2];
  if (!expectedResult) {
    throw new Error('Expected xref block');
  }

  expectedResult.schema.xrefTarget = 'tool-two';
  applyXrefTargetDefaults(expectedResult, 'tool-one');

  expect(expectedResult.schema.xrefTitle).toBe('Custom title');
  expect(expectedResult.schema.xrefDetail).toBe('Custom detail');
});
