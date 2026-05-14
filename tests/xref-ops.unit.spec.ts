import { expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { initState } from '../src/state';
import { getXrefTargetOptions, isXrefTargetValid } from '../src/xref-ops';
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
