import { expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import {
  clearHideIfUnmodifiedForSectionPath,
  filterTemplateVisibleSections,
  isBlockHiddenByTemplateMarker,
  isSectionHiddenByTemplateMarker,
} from '../src/template-hide';
import { builtInSearchProvider } from '../src/search/search-provider';
import { registerSerializationTestState, serializeWithState } from './serialization-test-helpers';

registerSerializationTestState();

const scaffoldDocument = `---
hvy_version: 0.1
---

<!--hvy: {"id":"history","hideIfUnmodified":true,"lock":true,"tags":"work-history"}-->
#! History

 <!--hvy:table {"tableColumns":["Years","Company","Role"],"tableRows":[{"cells":["","",""]}]}-->
`;

test('hideIfUnmodified round-trips without a template baseline payload', () => {
  const document = deserializeDocument(scaffoldDocument, '.hvy');
  const serialized = serializeWithState(document);
  const roundTripped = deserializeDocument(serialized, '.hvy');

  expect(serialized).toContain('"hideIfUnmodified":true');
  expect(serialized).not.toContain('templateBaseline');
  expect(roundTripped.sections[0]!.hideIfUnmodified).toBe(true);
  expect(isSectionHiddenByTemplateMarker(roundTripped.sections[0]!)).toBe(true);
});

test('viewer filtering hides marked scaffold sections until the marker is cleared', () => {
  const document = deserializeDocument(scaffoldDocument, '.hvy');
  const section = document.sections[0]!;
  section.expanded = false;

  expect(filterTemplateVisibleSections(document.sections)).toEqual([]);
  expect(clearHideIfUnmodifiedForSectionPath(document.sections, section.key)).toBe(true);
  expect(section.hideIfUnmodified).toBe(false);
  expect(section.expanded).toBe(true);
  expect(filterTemplateVisibleSections(document.sections)).toHaveLength(1);
});

test('viewer filtering hides blocks marked hideIfYes', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"details"}-->
#! Details

 <!--hvy:text {"id":"description","hideIfYes":"yes"}-->
  Description

 <!--hvy:text {"id":"notes","hideIfYes":"no"}-->
  Notes
`, '.hvy');

  const hiddenBlock = document.sections[0]!.blocks[0]!;
  expect(isBlockHiddenByTemplateMarker(hiddenBlock)).toBe(true);

  const expectedResult = filterTemplateVisibleSections(document.sections);
  expect(expectedResult[0]!.blocks.map((block) => block.schema.id)).toEqual(['notes']);
});

test('clearing a child section also clears hidden template ancestors', () => {
  const document = deserializeDocument(`${scaffoldDocument}

<!--hvy:subsection {"id":"awards","hideIfUnmodified":true}-->
## Awards

 <!--hvy:text {}-->
  TBD
`, '.hvy');

  const parent = document.sections[0]!;
  const child = parent.children[0]!;
  parent.expanded = false;
  child.expanded = false;
  expect(clearHideIfUnmodifiedForSectionPath(document.sections, child.key)).toBe(true);
  expect(parent.hideIfUnmodified).toBe(false);
  expect(child.hideIfUnmodified).toBe(false);
  expect(parent.expanded).toBe(true);
  expect(child.expanded).toBe(true);
});

test('viewer search can use the filtered section tree for hidden template markers', async () => {
  const document = deserializeDocument(scaffoldDocument, '.hvy');

  const hiddenResults = await builtInSearchProvider({
    document: { ...document, sections: filterTemplateVisibleSections(document.sections) },
    query: 'history',
    caseSensitive: false,
    categories: ['contents', 'tags', 'description'],
  });
  expect(hiddenResults).toEqual([]);

  document.sections[0]!.hideIfUnmodified = false;
  const visibleResults = await builtInSearchProvider({
    document: { ...document, sections: filterTemplateVisibleSections(document.sections) },
    query: 'history',
    caseSensitive: false,
    categories: ['contents', 'tags', 'description'],
  });
  expect(visibleResults.some((result) => result.sectionKey === document.sections[0]!.key)).toBe(true);
});
