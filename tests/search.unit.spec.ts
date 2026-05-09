import { expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { builtInSearchProvider } from '../src/search/search-provider';
import { createSearchFilterContext } from '../src/search/filter';
import { highlightPlainText } from '../src/search/highlight';

test('built-in search returns tags, contents, then description matches', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha","tags":"needle tag","description":"needle description"}-->
#! Alpha

<!--hvy:text {"id":"body-copy"}-->
 needle content
`, '.hvy');

  const expectedResult = await builtInSearchProvider({
    document,
    query: 'needle',
    caseSensitive: false,
    categories: ['contents', 'description', 'tags'],
  });

  expect(expectedResult.map((result) => result.category)).toEqual(['tags', 'contents', 'description']);
});

test('built-in search respects match case', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"body-copy"}-->
 Needle content
`, '.hvy');

  const expectedResult = await builtInSearchProvider({
    document,
    query: 'needle',
    caseSensitive: true,
    categories: ['contents'],
  });

  expect(expectedResult).toHaveLength(0);
});

test('built-in search finds nested container content', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:container {"id":"outer"}-->
  <!--hvy:container:0 {}-->
   <!--hvy:text {"id":"inner-text"}-->
    nested needle
`, '.hvy');

  const expectedResult = await builtInSearchProvider({
    document,
    query: 'needle',
    caseSensitive: false,
    categories: ['contents'],
  });

  expect(expectedResult.some((result) => result.targetId === 'inner-text')).toBe(true);
});

test('search filter context keeps matches and required ancestors visible', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:container {"id":"outer"}-->
  <!--hvy:container:0 {}-->
   <!--hvy:text {"id":"inner-text"}-->
    nested needle

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"other"}-->
 other
`, '.hvy');
  const [result] = await builtInSearchProvider({
    document,
    query: 'needle',
    caseSensitive: false,
    categories: ['contents'],
  });
  expect(result).toBeTruthy();

  const expectedResult = createSearchFilterContext(document.sections, {
    open: true,
    queryDraft: 'needle',
    submittedQuery: 'needle',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    filterEnabled: true,
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: [result!],
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedResult.visibleSections.has(document.sections[0]!.key)).toBe(true);
  expect(expectedResult.visibleSections.has(document.sections[1]!.key)).toBe(false);
});

test('search highlighting escapes plain text before marking matches', () => {
  const expectedResult = highlightPlainText('<script>needle</script>', 'needle', false, escapeHtml);

  expect(expectedResult).toBe('&lt;script&gt;<mark class="search-match-marker">needle</mark>&lt;/script&gt;');
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
