import { expect, test } from 'vitest';

import { renderReusableSectionOptions } from '../src/component-defs';
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
