import { afterEach, expect, test, vi } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { builtInSearchProvider } from '../src/search/search-provider';
import { createSearchFilterContext, orderSearchFilteredSections } from '../src/search/filter';
import { highlightPlainText } from '../src/search/highlight';
import { renderSearchPalette } from '../src/search/render';
import { buildSemanticFilterRequest } from '../src/search/semantic-candidates';
import { applySearchFilter } from '../src/search/actions';
import { initCallbacks, initState, state } from '../src/state';
import { createTestState } from './serialization-test-helpers';
import { setReferenceAppConfig } from '../src/reference-config';

afterEach(() => {
  setReferenceAppConfig(null);
  vi.restoreAllMocks();
});

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

test('built-in search groups multiple field matches within one component', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:xref {"id":"reference","xrefTitle":"needle title","xrefDetail":"needle detail"}-->
`, '.hvy');

  const expectedResult = await builtInSearchProvider({
    document,
    query: 'needle',
    caseSensitive: false,
    categories: ['contents'],
  });

  expect(expectedResult).toHaveLength(1);
  expect(expectedResult[0]!.sourceField).toBe('2 matches in Title + Detail');
  expect(expectedResult[0]!.matches?.map((match) => match.label)).toEqual(['Title', 'Detail']);
});

test('built-in search preserves document order within each category', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"first"}-->
 needle first

<!--hvy:text {"id":"second"}-->
 needle second
`, '.hvy');

  const expectedResult = await builtInSearchProvider({
    document,
    query: 'needle',
    caseSensitive: false,
    categories: ['contents'],
  });

  expect(expectedResult.map((result) => result.targetId)).toEqual(['first', 'second']);
  expect(expectedResult.map((result) => result.documentOrder)).toEqual([1, 2]);
});

test('built-in search strips markdown heading markers from result labels and previews', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"typescript"}-->
 ### TypeScript
`, '.hvy');

  const expectedResult = await builtInSearchProvider({
    document,
    query: 'TypeScript',
    caseSensitive: false,
    categories: ['contents'],
  });

  expect(expectedResult).toHaveLength(1);
  expect(expectedResult[0]!.label).toBe('TypeScript');
  expect(expectedResult[0]!.preview).toBe('TypeScript');
  expect(expectedResult[0]!.matches?.[0]?.preview).toBe('TypeScript');
});

test('search results use location descriptions as primary labels with match snippets as evidence', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy: {"id":"skills","description":"Northwind Labs skills list"}-->
#! TypeScript
`, '.hvy');
  const expectedResults = await builtInSearchProvider({
    document,
    query: 'TypeScript',
    caseSensitive: false,
    categories: ['contents'],
  });

  const expectedMarkup = renderSearchPalette({
    open: true,
    queryDraft: 'TypeScript',
    submittedQuery: 'TypeScript',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'search',
    filterEnabled: false,
    filterMode: 'hide',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: expectedResults,
    navigationResultIds: expectedResults.map((result) => result.id),
    requestNonce: 1,
    abortController: null,
  }, document, {
    escapeAttr: escapeHtml,
    escapeHtml,
    readerRenderer: null as never,
  });

  expect(expectedMarkup).toContain('<span class="search-result-title">Northwind Labs skills list</span>');
  expect(expectedMarkup).not.toContain('<span class="search-result-snippet-label">Title</span>');
  expect(expectedMarkup).toContain('<mark class="search-match-marker">TypeScript</mark>');
  expect(expectedMarkup.indexOf('Northwind Labs skills list')).toBeLessThan(expectedMarkup.indexOf('<mark class="search-match-marker">TypeScript</mark>'));
});

test('built-in search uses nearest described ancestor as child match location', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:component-list {"id":"history-tools-technologies-list","description":"Northwind Labs work history Tools & Technologies","componentListComponent":"xref-card"}-->
 <!--hvy:component-list:0 {}-->
  <!--hvy:xref-card {"id":"tool-typescript","xrefTitle":"TypeScript","xrefTarget":"tool-typescript"}-->
`, '.hvy');
  const expectedResults = await builtInSearchProvider({
    document,
    query: 'TypeScript',
    caseSensitive: false,
    categories: ['contents'],
  });

  expect(expectedResults).toHaveLength(1);
  expect(expectedResults[0]!.targetId).toBe('tool-typescript');
  expect(expectedResults[0]!.label).toBe('TypeScript');
  expect(expectedResults[0]!.locationLabel).toBe('Northwind Labs work history Tools & Technologies');

  const expectedMarkup = renderSearchPalette({
    open: true,
    queryDraft: 'TypeScript',
    submittedQuery: 'TypeScript',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'search',
    filterEnabled: false,
    filterMode: 'hide',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: expectedResults,
    navigationResultIds: expectedResults.map((result) => result.id),
    requestNonce: 1,
    abortController: null,
  }, document, {
    escapeAttr: escapeHtml,
    escapeHtml,
    readerRenderer: null as never,
  });

  expect(expectedMarkup).toContain('Northwind Labs work history Tools &amp; Technologies');
  expect(expectedMarkup).not.toContain('<span class="search-result-title">History</span>');
});

test('filter palette close control closes without stopping an active filter', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const expectedMarkup = renderSearchPalette({
    open: true,
    queryDraft: 'Python',
    submittedQuery: 'Python',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'deprioritize',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: [],
    navigationResultIds: [],
    requestNonce: 1,
    abortController: null,
  }, document, {
    escapeAttr: escapeHtml,
    escapeHtml,
    readerRenderer: null as never,
  });

  expect(expectedMarkup).toContain('data-action="close-search"');
  expect(expectedMarkup).toContain('class="search-palette is-filter-tab"');
  expect(expectedMarkup).toContain('class="search-close-button ghost remove-x"');
  expect(expectedMarkup).toContain('Turn off filter');
  expect(expectedMarkup).not.toContain('data-action="stop-search"');
});

test('search filter context keeps matches and required ancestors visible', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:container {"id":"outer"}-->
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
    activeTab: 'search',
    filterEnabled: true,
    filterMode: 'hide',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: [result!],
    navigationResultIds: [result!.id],
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedResult.visibleSections.has(document.sections[0]!.key)).toBe(true);
  expect(expectedResult.visibleSections.has(document.sections[1]!.key)).toBe(false);
});

test('search filter ordering moves non-priority shaded sections below matches', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-text"}-->
 other

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"beta-text"}-->
 needle

<!--hvy: {"id":"gamma"}-->
#! Gamma

<!--hvy:text {"id":"gamma-text"}-->
 other
`, '.hvy');
  const expectedResults = await builtInSearchProvider({
    document,
    query: 'needle',
    caseSensitive: false,
    categories: ['contents'],
  });
  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: 'needle',
    submittedQuery: 'needle',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'deprioritize',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: expectedResults,
    navigationResultIds: expectedResults.map((result) => result.id),
    requestNonce: 1,
    abortController: null,
  });

  const expectedResult = orderSearchFilteredSections(document.sections, expectedContext);

  expect(expectedResult.map((section) => section.customId)).toEqual(['beta', 'alpha', 'gamma']);
});

test('search filter ordering keeps document priority sections above matches', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha","priority":true}-->
#! Alpha

<!--hvy:text {"id":"alpha-text"}-->
 other

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"beta-text"}-->
 needle
`, '.hvy');
  const expectedResults = await builtInSearchProvider({
    document,
    query: 'needle',
    caseSensitive: false,
    categories: ['contents'],
  });
  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: 'needle',
    submittedQuery: 'needle',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'deprioritize',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: expectedResults,
    navigationResultIds: expectedResults.map((result) => result.id),
    requestNonce: 1,
    abortController: null,
  });

  const expectedResult = orderSearchFilteredSections(document.sections, expectedContext, {
    isPriority: (section) => section.priority === true,
  });

  expect(expectedResult.map((section) => section.customId)).toEqual(['alpha', 'beta']);
});

test('search filter context keeps expandable stub context for expanded-content matches', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"work"}-->
#! Work

<!--hvy:expandable {"id":"role","expandableExpanded":false}-->
  <!--hvy:expandable:stub {}-->
   <!--hvy:text {"id":"role-summary"}-->
    Northwind Labs

  <!--hvy:expandable:content {}-->
   <!--hvy:text {"id":"role-detail"}-->
    Built TypeScript tools
`, '.hvy');
  const expectedResults = await builtInSearchProvider({
    document,
    query: 'TypeScript',
    caseSensitive: false,
    categories: ['contents'],
  });
  const expandable = document.sections[0]!.blocks[0]!;
  const stubText = expandable.schema.expandableStubBlocks.children[0]!;
  const detailText = expandable.schema.expandableContentBlocks.children[0]!;

  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: 'TypeScript',
    submittedQuery: 'TypeScript',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'hide',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: expectedResults,
    navigationResultIds: expectedResults.map((result) => result.id),
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedContext.visibleBlocks.has(expandable.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(stubText.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(detailText.id)).toBe(true);
});

test('search filter context keeps structural sibling labels around nested matches', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:grid {"id":"skill-grid"}-->
  <!--hvy:grid:0 {"id":"tools-cell"}-->
   <!--hvy:container {"id":"tools-container"}-->
     <!--hvy:text {"id":"tools-heading"}-->
      Tools & Technologies
     <!--hvy:component-list {"id":"tools-list"}-->
      <!--hvy:component-list:0 {}-->
       <!--hvy:xref-card {"id":"typescript","xrefTitle":"TypeScript","xrefDetail":"Primary language","xrefTarget":"typescript"}-->
      <!--hvy:component-list:1 {}-->
       <!--hvy:xref-card {"id":"python","xrefTitle":"Python","xrefDetail":"Automation","xrefTarget":"python"}-->
`, '.hvy');
  const expectedResults = await builtInSearchProvider({
    document,
    query: 'TypeScript',
    caseSensitive: false,
    categories: ['contents'],
  });
  const grid = document.sections[0]!.blocks[0]!;
  const container = grid.schema.gridItems[0]!.block;
  const heading = container.schema.containerBlocks[0]!;
  const list = container.schema.containerBlocks[1]!;
  const xref = list.schema.componentListBlocks[0]!;
  const siblingXref = list.schema.componentListBlocks[1]!;

  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: 'TypeScript',
    submittedQuery: 'TypeScript',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'hide',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: expectedResults,
    navigationResultIds: expectedResults.map((result) => result.id),
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedContext.visibleBlocks.has(grid.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(container.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(heading.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(list.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(xref.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(siblingXref.id)).toBe(false);
});

test('search filter context treats expandable content layout wrappers as transparent context', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:expandable {"id":"role","expandableAlwaysShowStub":true,"expandableExpanded":false}-->
  <!--hvy:expandable:stub {}-->
   <!--hvy:text {"id":"role-summary"}-->
    Northwind Labs

  <!--hvy:expandable:content {}-->
   <!--hvy:text {"id":"role-heading"}-->
    Northwind Labs

   <!--hvy:grid {"id":"role-meta"}-->
    <!--hvy:grid:0 {"id":"role-location"}-->
     <!--hvy:text {"id":"location"}-->
      Seattle, WA
    <!--hvy:grid:1 {"id":"role-date"}-->
     <!--hvy:text {"id":"date"}-->
      05/2024 - present

   <!--hvy:component-list {"id":"accomplishments","componentListComponent":"text"}-->
    <!--hvy:component-list:0 {}-->
     <!--hvy:text {"id":"typescript-work"}-->
      Built a shared TypeScript package.
`, '.hvy');
  const expectedResults = await builtInSearchProvider({
    document,
    query: 'TypeScript',
    caseSensitive: false,
    categories: ['contents'],
  });
  const expandable = document.sections[0]!.blocks[0]!;
  const roleHeading = expandable.schema.expandableContentBlocks.children[0]!;
  const metaGrid = expandable.schema.expandableContentBlocks.children[1]!;
  const location = metaGrid.schema.gridItems[0]!.block;
  const date = metaGrid.schema.gridItems[1]!.block;
  const accomplishments = expandable.schema.expandableContentBlocks.children[2]!;
  const matchedText = accomplishments.schema.componentListBlocks[0]!;

  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: 'TypeScript',
    submittedQuery: 'TypeScript',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'hide',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: expectedResults,
    navigationResultIds: expectedResults.map((result) => result.id),
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedContext.visibleBlocks.has(expandable.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(roleHeading.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(accomplishments.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(matchedText.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(metaGrid.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(location.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(date.id)).toBe(true);
});

test('semantic filter request builds AI-friendly section and component candidates', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
title: Semantic Test
---

<!--hvy: {"id":"skills","tags":"frontend","description":"Technical skill inventory"}-->
#! Skills

<!--hvy:text {"id":"typescript","tags":"language","description":"Primary implementation language"}-->
 TypeScript tooling and reusable UI components.
`, '.hvy');

  const expectedResult = buildSemanticFilterRequest({
    document,
    prompt: 'Find frontend language work',
  });

  expect(expectedResult.documentTitle).toBe('Semantic Test');
  expect(expectedResult.candidates.map((candidate) => candidate.candidateId)).toContain(`section:${document.sections[0]!.key}`);
  expect(expectedResult.candidates.map((candidate) => candidate.candidateId)).toContain(`block:${document.sections[0]!.key}:${document.sections[0]!.blocks[0]!.id}`);
  expect(expectedResult.candidates[0]).toMatchObject({
    targetKind: 'section',
    label: 'Skills',
    tags: ['frontend'],
    description: 'Technical skill inventory',
  });
  expect(expectedResult.instructionPrompt).toContain('Return only JSON');
  expect(expectedResult.instructionPrompt).toContain('Find frontend language work');
  expect(expectedResult.instructionPrompt).toContain(`block:${document.sections[0]!.key}:${document.sections[0]!.blocks[0]!.id}`);
});

test('semantic filter request truncates large candidate payloads deterministically', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"long-one"}-->
 ${'one '.repeat(120)}

<!--hvy:text {"id":"long-two"}-->
 ${'two '.repeat(120)}
`, '.hvy');

  const expectedResult = buildSemanticFilterRequest({
    document,
    prompt: 'Find long content',
    maxCandidateSummaryChars: 40,
    maxTotalCandidateChars: 700,
  });

  expect(expectedResult.candidateBudget.truncated).toBe(true);
  expect(expectedResult.candidates[0]!.targetKind).toBe('section');
  expect(expectedResult.candidates[0]!.summary.length).toBeLessThanOrEqual(40);
  expect(expectedResult.candidates.length).toBeLessThan(expectedResult.candidateBudget.totalCandidates);
});

test('semantic filter provider matches become normal filter results', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"typescript"}-->
 TypeScript tooling.

<!--hvy: {"id":"writing"}-->
#! Writing

<!--hvy:text {"id":"notes"}-->
 Release notes.
`, '.hvy');
  initState(createTestState(document));
  initCallbacks({
    renderApp: vi.fn(),
    refreshReaderPanels: vi.fn(),
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  state.search.activeTab = 'filter';
  state.search.filterQueryMode = 'semantic';
  state.search.queryDraft = 'Find TypeScript experience';
  const matchedBlock = document.sections[0]!.blocks[0]!;
  setReferenceAppConfig({
    semanticFilterProvider: (request) => {
      expect(request.instructionPrompt).toContain('Find TypeScript experience');
      return [{
        candidateId: `block:${document.sections[0]!.key}:${matchedBlock.id}`,
        reason: 'TypeScript work is relevant.',
        score: 0.91,
      }];
    },
  });

  await applySearchFilter({ enabled: true });

  expect(state.search.filterEnabled).toBe(true);
  expect(state.search.submittedFilterQueryMode).toBe('semantic');
  expect(state.search.results).toHaveLength(1);
  expect(state.search.results[0]).toMatchObject({
    category: 'semantic',
    targetKind: 'block',
    blockId: matchedBlock.id,
    preview: 'TypeScript work is relevant.',
    score: 0.91,
  });
  const expectedContext = createSearchFilterContext(document.sections, state.search);
  expect(expectedContext.visibleSections.has(document.sections[0]!.key)).toBe(true);
  expect(expectedContext.visibleSections.has(document.sections[1]!.key)).toBe(false);
});

test('semantic filtering reports a missing provider without enabling filtering', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills
`, '.hvy');
  initState(createTestState(document));
  initCallbacks({
    renderApp: vi.fn(),
    refreshReaderPanels: vi.fn(),
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  state.search.activeTab = 'filter';
  state.search.filterQueryMode = 'semantic';
  state.search.queryDraft = 'Find skills';

  await applySearchFilter({ enabled: true });

  expect(state.search.filterEnabled).toBe(false);
  expect(state.search.error).toBe('Semantic filtering is not configured.');
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
