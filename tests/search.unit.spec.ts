import { afterEach, expect, test, vi } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { builtInSearchProvider } from '../src/search/search-provider';
import { createSearchFilterContext, orderSearchFilteredSections } from '../src/search/filter';
import { highlightPlainText } from '../src/search/highlight';
import { renderSearchPalette } from '../src/search/render';
import { buildSemanticFilterRequest, buildSemanticFilterWindows } from '../src/search/semantic-candidates';
import { parseSemanticFilterResponse } from '../src/search/semantic-provider';
import { searchDocuments } from '../src/search/documents';
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

test('semantic filter context reveals exact matched list item subtrees without sibling list items', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:text {"id":"history-heading"}-->
 Professional History

<!--hvy:component-list {"id":"history-list","componentListComponent":"expandable"}-->
 <!--hvy:component-list:0 {}-->
  <!--hvy:expandable {"id":"northwind-role","expandableAlwaysShowStub":true,"expandableExpanded":false}-->
    <!--hvy:expandable:stub {}-->
     <!--hvy:text {"id":"northwind-title"}-->
      Northwind Labs

    <!--hvy:expandable:content {}-->
     <!--hvy:text {"id":"northwind-detail"}-->
      Built platform tooling.

 <!--hvy:component-list:1 {}-->
  <!--hvy:expandable {"id":"contoso-role","expandableAlwaysShowStub":true,"expandableExpanded":false}-->
    <!--hvy:expandable:stub {}-->
     <!--hvy:text {"id":"contoso-title"}-->
      Contoso

    <!--hvy:expandable:content {}-->
     <!--hvy:text {"id":"contoso-detail"}-->
      Wrote release notes.
`, '.hvy');
  const heading = document.sections[0]!.blocks[0]!;
  const list = document.sections[0]!.blocks[1]!;
  const matchedRecord = list.schema.componentListBlocks[0]!;
  const matchedStub = matchedRecord.schema.expandableStubBlocks.children[0]!;
  const matchedDetail = matchedRecord.schema.expandableContentBlocks.children[0]!;
  const siblingRecord = list.schema.componentListBlocks[1]!;
  const siblingStub = siblingRecord.schema.expandableStubBlocks.children[0]!;

  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: 'Northwind Labs',
    submittedQuery: 'Northwind Labs',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'hide',
    filterQueryMode: 'semantic',
    submittedFilterQueryMode: 'semantic',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: [{
      id: 'semantic-1',
      category: 'semantic',
      targetKind: 'block',
      sectionKey: document.sections[0]!.key,
      blockId: matchedRecord.id,
      targetId: 'northwind-role',
      label: 'Northwind Labs',
      preview: 'Northwind role is relevant.',
      matchedText: 'Northwind Labs',
      sourceField: 'Semantic match',
      documentOrder: 1,
    }],
    navigationResultIds: ['semantic-1'],
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedContext.visibleBlocks.has(heading.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(list.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(matchedRecord.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(matchedStub.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(matchedDetail.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(siblingRecord.id)).toBe(false);
  expect(expectedContext.visibleBlocks.has(siblingStub.id)).toBe(false);
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
  expect(expectedResult.candidates.map((candidate) => candidate.candidateId)).toContain('section:/body/skills');
  expect(expectedResult.candidates.map((candidate) => candidate.candidateId)).toContain('component:typescript');
  expect(expectedResult.candidates[0]).toMatchObject({
    targetKind: 'section',
    targetPath: '/body/skills',
    targetRef: '/body/skills',
    label: 'Skills',
    tags: ['frontend'],
    description: 'Technical skill inventory',
  });
  expect(expectedResult.candidates[1]).toMatchObject({
    targetKind: 'block',
    targetPath: '/body/skills/typescript',
    targetRef: 'typescript',
  });
  expect(expectedResult.instructionPrompt).toContain('Return only JSON');
  expect(expectedResult.instructionPrompt).toContain('Find frontend language work');
  expect(expectedResult.instructionPrompt).toContain('"matches": ["candidateId from the list"]');
  expect(expectedResult.instructionPrompt).toContain('Return only matching candidateId strings');
  expect(expectedResult.instructionPrompt).toContain('component:typescript');
});

test('semantic filter candidates use request_structure ids for anonymous components', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {}-->
 Anonymous note
`, '.hvy');

  const expectedResult = buildSemanticFilterRequest({
    document,
    prompt: 'Find anonymous note',
  });

  const expectedComponent = expectedResult.candidates.find((candidate) => candidate.targetKind === 'block');
  expect(expectedComponent).toMatchObject({
    candidateId: 'component:C0',
    targetRef: 'C0',
    targetPath: '/body/alpha/text-0',
    label: 'Anonymous note',
  });
  expect(expectedResult.instructionPrompt).toContain('"targetRef":"C0"');
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

test('semantic filter windows group section subtrees instead of individual component calls', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"typescript"}-->
 TypeScript tooling.

<!--hvy:text {"id":"react"}-->
 React components.

<!--hvy: {"id":"writing"}-->
#! Writing

<!--hvy:text {"id":"notes"}-->
 Release notes.
`, '.hvy');

  const expectedResult = buildSemanticFilterWindows({
    document,
    prompt: 'Find frontend work',
  });

  expect(expectedResult.windows).toHaveLength(2);
  expect(expectedResult.windows[0]!.candidates.map((candidate) => candidate.targetId)).toEqual(['skills', 'typescript', 'react']);
  expect(expectedResult.windows[1]!.candidates.map((candidate) => candidate.targetId)).toEqual(['writing', 'notes']);
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
  state.search.activeTab = 'filter';
  state.search.filterQueryMode = 'semantic';
  state.search.queryDraft = 'Find TypeScript experience';
  const matchedBlock = document.sections[0]!.blocks[0]!;
  const renderApp = vi.fn();
  initCallbacks({
    renderApp,
    refreshReaderPanels: vi.fn(),
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  const seenWindows: string[] = [];
  setReferenceAppConfig({
    semanticFilterProvider: async (request) => {
      expect(request.instructionPrompt).toContain('Find TypeScript experience');
      seenWindows.push(request.windowLabel ?? '');
      const match = request.candidates.find((candidate) => candidate.blockId === matchedBlock.id);
      if (!match) {
        return [];
      }
      return [{
        candidateId: match.candidateId,
        reason: 'TypeScript work is relevant.',
        score: 0.91,
      }];
    },
  });

  await applySearchFilter({ enabled: true });

  expect(seenWindows).toEqual(['Skills', 'Writing']);
  expect(renderApp).toHaveBeenCalled();
  expect(state.search.semanticProgress).toMatchObject({
    completedWindows: 2,
    totalWindows: 2,
    matchedCandidates: 1,
  });
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

test('filter tab boxes no results and disables repeat filtering', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills
`, '.hvy');

  const expectedMarkup = renderSearchPalette({
    open: true,
    queryDraft: 'missing',
    submittedQuery: 'missing',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: false,
    filterMode: 'hide',
    filterQueryMode: 'semantic',
    submittedFilterQueryMode: 'semantic',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    semanticProgress: {
      completedWindows: 2,
      totalWindows: 2,
      matchedCandidates: 0,
      includedCandidates: 4,
      totalCandidates: 4,
    },
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

  expect(expectedMarkup).toContain('class="search-status is-empty"');
  expect(expectedMarkup).toContain('No semantic matches. Try a more specific prompt.');
  expect(expectedMarkup).toContain('disabled');
  expect(expectedMarkup).toContain('>No results</button>');
});

test('semantic provider parser keeps only valid candidate ids', () => {
  const expectedResult = parseSemanticFilterResponse(
    '{"matches":["section:skills","invented"]}',
    new Set(['section:skills']),
  );

  expect(expectedResult).toEqual([{
    candidateId: 'section:skills',
  }]);
});

test('semantic provider parser keeps object matches for compatibility', () => {
  const expectedResult = parseSemanticFilterResponse(
    '{"matches":[{"candidateId":"section:skills","reason":"Relevant","score":1.4},{"candidateId":"invented","reason":"Nope"}]}',
    new Set(['section:skills']),
  );

  expect(expectedResult).toEqual([{
    candidateId: 'section:skills',
    reason: 'Relevant',
    score: 1,
  }]);
});

test('document search returns keyword matches across many documents', async () => {
  const firstDocument = deserializeDocument(`---
hvy_version: 0.1
title: First
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"first-note"}-->
 shared keyword
`, '.hvy');
  const secondDocument = deserializeDocument(`---
hvy_version: 0.1
title: Second
---

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"second-note"}-->
 shared keyword
`, '.hvy');

  const expectedResult = await searchDocuments({
    query: 'shared',
    documents: [
      { documentId: 'first-doc', document: firstDocument },
      { documentId: 'second-doc', document: secondDocument },
    ],
    mode: 'keyword',
    categories: ['contents'],
  });

  expect(expectedResult.mode).toBe('keyword');
  expect(expectedResult.results.map((result) => result.documentId)).toEqual(['first-doc', 'second-doc']);
  expect(expectedResult.results.map((result) => result.targetId)).toEqual(['first-note', 'second-note']);
  expect(expectedResult.results[0]!.documentTitle).toBe('First');
});

test('document search sends semantic candidates across many documents', async () => {
  const firstDocument = deserializeDocument(`---
hvy_version: 0.1
title: First
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"first-note"}-->
 frontend work
`, '.hvy');
  const secondDocument = deserializeDocument(`---
hvy_version: 0.1
title: Second
---

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"second-note"}-->
 database work
`, '.hvy');

  const expectedResult = await searchDocuments({
    query: 'Find databases',
    mode: 'semantic',
    documents: [
      { documentId: 'first-doc', document: firstDocument },
      { documentId: 'second-doc', document: secondDocument },
    ],
    semanticFilterProvider: (request) => {
      if (!request.candidates.some((candidate) => candidate.documentId === 'second-doc')) {
        return [];
      }
      expect(request.instructionPrompt).toContain('"documentId":"second-doc"');
      expect(request.instructionPrompt).toContain('"documentTitle":"Second"');
      return [{
        candidateId: request.candidates.find((candidate) =>
          candidate.documentId === 'second-doc' && candidate.targetKind === 'block'
        )!.candidateId,
        reason: 'Database work is relevant.',
        score: 0.82,
      }];
    },
  });

  expect(expectedResult.mode).toBe('semantic');
  expect(expectedResult.results).toHaveLength(1);
  expect(expectedResult.results[0]).toMatchObject({
    documentId: 'second-doc',
    documentTitle: 'Second',
    category: 'semantic',
    targetId: 'second-note',
    preview: 'Database work is relevant.',
    score: 0.82,
  });
  expect(expectedResult.candidateBudget?.totalCandidates).toBeGreaterThan(1);
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
