import { expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import {
  clearHideIfUnmodifiedForSectionPath,
  filterTemplateVisibleSections,
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

  expect(filterTemplateVisibleSections(document.sections)).toEqual([]);
  expect(clearHideIfUnmodifiedForSectionPath(document.sections, section.key)).toBe(true);
  expect(section.hideIfUnmodified).toBe(false);
  expect(filterTemplateVisibleSections(document.sections)).toHaveLength(1);
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
  expect(clearHideIfUnmodifiedForSectionPath(document.sections, child.key)).toBe(true);
  expect(parent.hideIfUnmodified).toBe(false);
  expect(child.hideIfUnmodified).toBe(false);
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
