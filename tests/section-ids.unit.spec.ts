import { expect, test } from 'vitest';

import { createEmptySection } from '../src/document-factory';
import { assignSectionTitleAndGeneratedId } from '../src/section-ops';
import { deserializeDocument } from '../src/serialization';

test('assignSectionTitleAndGeneratedId names a new section id from its title', () => {
  const section = createEmptySection(1, '');

  assignSectionTitleAndGeneratedId([section], section, 'Project Notes');

  expect(section.title).toBe('Project Notes');
  expect(section.customId).toBe('project-notes');
});

test('assignSectionTitleAndGeneratedId refreshes title-derived ids and preserves custom ids', () => {
  const section = createEmptySection(1, '');
  assignSectionTitleAndGeneratedId([section], section, 'Project Notes');

  assignSectionTitleAndGeneratedId([section], section, 'Launch Plan');

  expect(section.customId).toBe('launch-plan');

  section.customId = 'purposeful-id';
  assignSectionTitleAndGeneratedId([section], section, 'Renamed Again');

  expect(section.customId).toBe('purposeful-id');
});

test('assignSectionTitleAndGeneratedId gives duplicate title-derived ids a suffix', () => {
  const existing = createEmptySection(1, '');
  assignSectionTitleAndGeneratedId([existing], existing, 'Project Notes');
  const section = createEmptySection(1, '');

  assignSectionTitleAndGeneratedId([existing, section], section, 'Project Notes');

  expect(section.customId).toBe('project-notes-2');
});

test('deserializeDocument generates missing section ids from titles', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {}-->
#! Project Notes

<!--hvy: {}-->
#! Project Notes
`, '.hvy');

  expect(document.sections.map((section) => section.customId)).toEqual(['project-notes', 'project-notes-2']);
});
