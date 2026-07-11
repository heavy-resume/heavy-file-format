import { afterEach, expect, test, vi } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { builtInSearchProvider } from '../src/search/search-provider';
import { createSearchFilterContext, orderSearchFilteredSections } from '../src/search/filter';
import { highlightPlainText } from '../src/search/highlight';
import { renderSearchModal } from '../src/search/render';
import { buildSemanticFilterRequest, buildSemanticFilterWindowRequest, buildSemanticFilterWindows, buildSemanticRetrievalChunks } from '../src/search/semantic-candidates';
import { parseSemanticFilterResponse } from '../src/search/semantic-provider';
import { searchDocuments } from '../src/search/documents';
import { createDocumentFilterSnapshot } from '../src/search/document-filter';
import { createDocumentSearchSnapshot, searchSnapshotToState } from '../src/search/snapshot';
import { applySearchFilter, clearFilteringForTarget, stopSearchRequest } from '../src/search/actions';
import { renderSearchFloatingSurface } from '../src/search/surface-refresh';
import { initCallbacks, initState, state } from '../src/state';
import { createTestState } from './serialization-test-helpers';
import { setReferenceAppConfig } from '../src/reference-config';
import { highlightEditorSearchMatches } from '../src/block-ops';

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

test('floating search surface hides launcher while chat panel is open', () => {
  initCallbacks({
    renderApp: vi.fn(),
    refreshReaderPanels: vi.fn(),
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: {},
  });
  initState(createTestState(deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy')));
  state.chat.panelOpen = true;

  const expectedMarkup = renderSearchFloatingSurface();

  expect(expectedMarkup).toContain('data-search-surface="floating" class="search-floating-surface is-chat-open"');
});

test('editor rendering highlights submitted search matches', () => {
  initState(createTestState(deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy')));
  state.search.submittedQuery = 'needle';

  const expectedResult = highlightEditorSearchMatches('<p>Find this needle.</p>');

  expect(expectedResult).toContain('<mark class="search-match-marker">needle</mark>');
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

  const expectedMarkup = renderSearchModal({
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

  const expectedMarkup = renderSearchModal({
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

test('filter modal close control closes without stopping an active filter', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const expectedMarkup = renderSearchModal({
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
  expect(expectedMarkup).toContain('class="search-modal is-filter-tab"');
  expect(expectedMarkup).toContain('class="search-close-button ghost remove-x"');
  expect(expectedMarkup).toContain('Turn off filter');
  expect(expectedMarkup).not.toContain('data-action="stop-search"');
});

test('filter modal shows stop control while semantic filtering is running', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const expectedMarkup = renderSearchModal({
    open: true,
    queryDraft: 'Anything Carta',
    submittedQuery: 'Anything Carta',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: false,
    filterMode: 'hide',
    filterQueryMode: 'semantic',
    submittedFilterQueryMode: 'semantic',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: true,
    semanticProgress: {
      completedWindows: 4,
      totalWindows: 87,
      matchedCandidates: 1,
      includedCandidates: 120,
      totalCandidates: 120,
    },
    error: null,
    results: [],
    navigationResultIds: [],
    requestNonce: 1,
    abortController: new AbortController(),
  }, document, {
    escapeAttr: escapeHtml,
    escapeHtml,
    readerRenderer: null as never,
  });

  expect(expectedMarkup).toContain('data-action="stop-search-request"');
  expect(expectedMarkup).toContain('>Stop</button>');
  expect(expectedMarkup).toContain('4/87 windows');
  expect(expectedMarkup).toContain('1 match');
  expect(expectedMarkup).not.toContain('120/120 candidates');
  expect(expectedMarkup).not.toContain('>Filtering...</button>');
});

test('stopping a search request aborts without closing the palette or clearing the prompt', () => {
  const abortController = new AbortController();
  initState(createTestState(deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy')));
  state.search.open = false;
  state.search.resultsCollapsed = true;
  state.search.queryDraft = 'Anything Carta';
  state.search.submittedQuery = 'Anything Carta';
  state.search.activeTab = 'filter';
  state.search.filterQueryMode = 'semantic';
  state.search.isLoading = true;
  state.search.abortController = abortController;
  state.search.semanticProgress = {
    completedWindows: 4,
    totalWindows: 87,
    matchedCandidates: 1,
    includedCandidates: 120,
    totalCandidates: 120,
  };
  initCallbacks({
    renderApp: vi.fn(),
    refreshReaderPanels: vi.fn(),
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: null,
  });

  stopSearchRequest();

  expect(abortController.signal.aborted).toBe(true);
  expect(state.search.open).toBe(true);
  expect(state.search.resultsCollapsed).toBe(false);
  expect(state.search.queryDraft).toBe('Anything Carta');
  expect(state.search.isLoading).toBe(false);
  expect(state.search.semanticProgress).toBe(null);
});

test('block search traversal tolerates blocks without child collections', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"summary"}-->
 Summary

<!--hvy:text {"id":"needle"}-->
 Needle
`, '.hvy');
  const section = document.sections[0]!;
  const firstBlock = section.blocks[0]!;
  const targetBlock = section.blocks[1]!;
  delete (firstBlock.schema as Partial<typeof firstBlock.schema>).containerBlocks;
  delete (firstBlock.schema as Partial<typeof firstBlock.schema>).componentListBlocks;
  delete (firstBlock.schema as Partial<typeof firstBlock.schema>).expandableStubBlocks;
  delete (firstBlock.schema as Partial<typeof firstBlock.schema>).expandableContentBlocks;
  delete (firstBlock.schema as Partial<typeof firstBlock.schema>).gridItems;
  initState(createTestState(document));
  state.search.filterEnabled = true;
  state.search.submittedQuery = 'Needle';
  initCallbacks({
    renderApp: vi.fn(),
    refreshReaderPanels: vi.fn(),
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: null,
  });

  expect(() => clearFilteringForTarget(section.key, targetBlock.id)).not.toThrow();

  expect(state.search.clearedBlockIds).toEqual([targetBlock.id]);
});

test('turning off an applied filter clears semantic progress', async () => {
  initState(createTestState(deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy')));
  state.search.filterEnabled = true;
  state.search.submittedQuery = 'Anything Carta';
  state.search.semanticProgress = {
    completedWindows: 4,
    totalWindows: 10,
    matchedCandidates: 1,
    includedCandidates: 120,
    totalCandidates: 120,
  };
  initCallbacks({
    renderApp: vi.fn(),
    refreshReaderPanels: vi.fn(),
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: null,
  });

  await applySearchFilter({ enabled: false });

  expect(state.search.filterEnabled).toBe(false);
  expect(state.search.semanticProgress).toBe(null);
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

test('search filter excludes matching component tags from keyword matches', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"keep"}-->
 needle kept

<!--hvy:text {"id":"draft","tags":"draft"}-->
 needle draft
`, '.hvy');
  const expectedResults = await builtInSearchProvider({
    document,
    query: 'needle',
    caseSensitive: false,
    categories: ['contents'],
  });
  const keep = document.sections[0]!.blocks[0]!;
  const draft = document.sections[0]!.blocks[1]!;

  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: 'needle',
    submittedQuery: 'needle',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'hide',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    submittedExcludeTags: 'draft',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: expectedResults,
    navigationResultIds: expectedResults.map((result) => result.id),
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedContext.matchedBlocks.has(keep.id)).toBe(true);
  expect(expectedContext.matchedBlocks.has(draft.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(keep.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(draft.id)).toBe(false);
  expect(expectedContext.excludedBlocks.has(draft.id)).toBe(true);
});

test('search filter can exclude component tags without a search query', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"keep"}-->
 kept

<!--hvy:text {"id":"draft","tags":"draft, internal"}-->
 draft
`, '.hvy');
  const keep = document.sections[0]!.blocks[0]!;
  const draft = document.sections[0]!.blocks[1]!;

  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: '',
    submittedQuery: '',
    caseSensitive: false,
    categories: { tags: true, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'hide',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    submittedExcludeTags: 'internal',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: [],
    navigationResultIds: [],
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedContext.filtering).toBe(true);
  expect(expectedContext.visibleSections.has(document.sections[0]!.key)).toBe(true);
  expect(expectedContext.visibleBlocks.has(keep.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(draft.id)).toBe(false);
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

test('search filter context treats xrefs to semantic target records as matches', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"featured"}-->
#! Featured

<!--hvy:component-list {"id":"tools-xrefs","componentListComponent":"xref-card"}-->
 <!--hvy:component-list:0 {}-->
  <!--hvy:xref-card {"id":"typescript-xref","xrefTitle":"TypeScript","xrefTarget":"tool-typescript"}-->
 <!--hvy:component-list:1 {}-->
  <!--hvy:xref-card {"id":"containers-xref","xrefTitle":"Developer Containers","xrefTarget":"tool-containers"}-->

<!--hvy: {"id":"tools"}-->
#! Tools

<!--hvy:component-list {"id":"tools-list","componentListComponent":"text"}-->
 <!--hvy:component-list:0 {}-->
  <!--hvy:text {"id":"tool-typescript","title":"TypeScript","groupKeys":{"Category":"Programming Languages"}}-->
   Primary application language.
 <!--hvy:component-list:1 {}-->
  <!--hvy:text {"id":"tool-containers","title":"Developer Containers","groupKeys":{"Category":"Development Environments"}}-->
   Reproducible local environments.
`, '.hvy');
  const xrefList = document.sections[0]!.blocks[0]!;
  const typescriptXref = xrefList.schema.componentListBlocks[0]!;
  const containersXref = xrefList.schema.componentListBlocks[1]!;
  const recordList = document.sections[1]!.blocks[0]!;
  const typescriptRecord = recordList.schema.componentListBlocks[0]!;

  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: 'Programming languages',
    submittedQuery: 'Programming languages',
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
      sectionKey: document.sections[1]!.key,
      blockId: typescriptRecord.id,
      targetId: 'tool-typescript',
      label: 'TypeScript',
      preview: 'Programming language',
      matchedText: 'Programming languages',
      sourceField: 'Semantic match',
    }],
    navigationResultIds: ['semantic-1'],
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedContext.matchedBlocks.has(typescriptRecord.id)).toBe(true);
  expect(expectedContext.matchedBlocks.has(typescriptXref.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(typescriptXref.id)).toBe(true);
  expect(expectedContext.matchedBlocks.has(containersXref.id)).toBe(false);
});

test('search filter context treats xrefs to semantic target record descendants as matches', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"featured"}-->
#! Featured

<!--hvy:component-list {"id":"tools-xrefs","componentListComponent":"xref-card"}-->
 <!--hvy:component-list:0 {}-->
  <!--hvy:xref-card {"id":"python-xref","xrefTitle":"Python","xrefTarget":"tool-python"}-->
 <!--hvy:component-list:1 {}-->
  <!--hvy:xref-card {"id":"containers-xref","xrefTitle":"Developer Containers","xrefTarget":"tool-containers"}-->

<!--hvy: {"id":"tools"}-->
#! Tools

<!--hvy:expandable {"id":"tool-python","xrefTitle":"Python"}-->
 <!--hvy:expandable:stub {}-->
  <!--hvy:text {"id":"python-title"}-->
   Python
 <!--hvy:expandable:content {}-->
  <!--hvy:text {"id":"python-detail"}-->
   High-level dynamically typed language.
`, '.hvy');
  const xrefList = document.sections[0]!.blocks[0]!;
  const pythonXref = xrefList.schema.componentListBlocks[0]!;
  const containersXref = xrefList.schema.componentListBlocks[1]!;
  const pythonRecord = document.sections[1]!.blocks[0]!;
  const pythonDetail = pythonRecord.schema.expandableContentBlocks!.children[0]!;

  const expectedContext = createSearchFilterContext(document.sections, {
    open: false,
    queryDraft: 'Anything Python',
    submittedQuery: 'Anything Python',
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
      sectionKey: document.sections[1]!.key,
      blockId: pythonDetail.id,
      targetId: pythonDetail.id,
      targetPath: '/body/tools/tool-python/expandable-content/python-detail',
      label: 'High-level dynamically typed language.',
      preview: 'High-level dynamically typed language.',
      matchedText: 'Anything Python',
      sourceField: 'Semantic match',
    }],
    navigationResultIds: ['semantic-1'],
    requestNonce: 1,
    abortController: null,
  });

  expect(expectedContext.matchedBlocks.has(pythonDetail.id)).toBe(true);
  expect(expectedContext.matchedBlocks.has(pythonXref.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(pythonXref.id)).toBe(true);
  expect(expectedContext.matchedBlocks.has(containersXref.id)).toBe(false);
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
  expect(expectedResult.instructionPrompt).toContain('--- filter prompt ---\nFind frontend language work\n--- end filter prompt ---');
  expect(expectedResult.instructionPrompt.indexOf('Candidate list as XML-like structured text:')).toBeLessThan(
    expectedResult.instructionPrompt.indexOf('Selection contract:')
  );
  expect(expectedResult.instructionPrompt).toContain('Selection contract:');
  expect(expectedResult.instructionPrompt).toContain('list candidate IDs that appear to satisfy the filter prompt');
  expect(expectedResult.instructionPrompt).toContain('Review the first pass against the relevance rules');
  expect(expectedResult.instructionPrompt).toContain('write one JSON array containing exactly the candidate IDs that survived review');
  expect(expectedResult.instructionPrompt).toContain('If no candidates survived review, the final JSON array must be []');
  expect(expectedResult.instructionPrompt).toContain('Do not output all candidate IDs unless every candidate survived review');
  expect(expectedResult.instructionPrompt).not.toContain('exactly the candidate IDs from the first pass');
  expect(expectedResult.instructionPrompt).toContain('Find frontend language work');
  expect(expectedResult.instructionPrompt).not.toContain('may match');
  expect(expectedResult.instructionPrompt).not.toContain('["id1", "id2", ...]');
  expect(expectedResult.instructionPrompt).toContain('Do not put explanations inside the JSON array');
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
  expect(expectedResult.instructionPrompt).toContain('<candidate id="component:C0">');
  expect(expectedResult.instructionPrompt).toContain('<context label="Alpha">');
  expect(expectedResult.instructionPrompt).not.toContain('PATH /body/alpha/text-0');
  expect(expectedResult.instructionPrompt).not.toContain('/body/alpha/text-0');
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

  expect(expectedResult.windows).toHaveLength(1);
  expect(expectedResult.windows[0]!.candidates.map((candidate) => candidate.targetId)).toEqual(['typescript', 'react', 'notes']);
  expect(expectedResult.windows[0]!.candidates.every((candidate) => candidate.targetKind === 'block')).toBe(true);
});

test('semantic filter windows include late section candidates past the single request budget', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"early-one"}-->
 ${'Early skill detail. '.repeat(20)}

<!--hvy:text {"id":"early-two"}-->
 ${'Early tool detail. '.repeat(20)}

<!--hvy: {"id":"history"}-->
#! Professional History

<!--hvy:text {"id":"carta-role"}-->
 Carta platform engineering.
`, '.hvy');

  const expectedResult = buildSemanticFilterWindows({
    document,
    prompt: 'Anything Carta',
    maxCandidateSummaryChars: 40,
    maxTotalCandidateChars: 700,
    maxWindowCandidateChars: 700,
  });

  expect(expectedResult.candidateBudget.truncated).toBe(false);
  expect(expectedResult.candidateBudget.includedCandidates).toBe(expectedResult.candidateBudget.totalCandidates);
  expect(expectedResult.candidates.find((candidate) => candidate.targetId === 'early-one')?.summary.length).toBeGreaterThan(40);
  expect(expectedResult.candidates.map((candidate) => candidate.targetPath)).toContain('/body/history');
  expect(expectedResult.candidates.map((candidate) => candidate.targetPath)).toContain('/body/history/carta-role');
  expect(expectedResult.windows.flatMap((window) => window.candidates.map((candidate) => candidate.targetPath))).toContain('/body/history/carta-role');
});

test('semantic filter windows split oversized text candidates with overlap', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"notes"}-->
#! Notes

<!--hvy:text {"id":"long-note"}-->
 ${'alpha '.repeat(260)}needle ${'omega '.repeat(260)}
`, '.hvy');

  const expectedResult = buildSemanticFilterWindows({
    document,
    prompt: 'Find needle',
    maxWindowCandidateChars: 900,
  });
  const expectedChunks = expectedResult.windows
    .flatMap((window) => window.candidates)
    .filter((candidate) => candidate.candidateId === 'component:long-note');

  expect(expectedResult.candidateBudget.truncated).toBe(false);
  expect(expectedChunks.length).toBeGreaterThan(1);
  expect(new Set(expectedChunks.map((candidate) => candidate.candidateId))).toEqual(new Set(['component:long-note']));
  expect(expectedChunks.some((candidate) => candidate.summary.includes('needle'))).toBe(true);
  for (let index = 1; index < expectedChunks.length; index += 1) {
    expect(expectedChunks[index]!.windowChunk!.start).toBeLessThan(expectedChunks[index - 1]!.windowChunk!.end);
  }
});

test('semantic filter windows back off oversized parent summaries to child candidates', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:expandable {"id":"record"}-->
 <!--hvy:expandable:stub {}-->
  <!--hvy:text {"id":"record-title"}-->
   Example Role
 <!--hvy:expandable:content {}-->
  <!--hvy:text {"id":"record-detail"}-->
   ${'Detailed impact. '.repeat(220)}
`, '.hvy');

  const expectedResult = buildSemanticFilterWindows({
    document,
    prompt: 'Detailed impact',
    maxWindowCandidateChars: 900,
  });
  const expectedWindowCandidates = expectedResult.windows.flatMap((window) => window.candidates);
  const expectedDetailChunks = expectedWindowCandidates.filter((candidate) => candidate.candidateId === 'component:record-detail');

  expect(expectedWindowCandidates.some((candidate) => candidate.candidateId === 'component:record')).toBe(false);
  const expectedDetailWindow = expectedResult.windows.find((window) =>
    window.candidates.some((candidate) => candidate.candidateId === 'component:record-detail')
  );
  expect(buildSemanticFilterWindowRequest('Detailed impact', expectedDetailWindow!).instructionPrompt).toContain('<context label="History">');
  expect(expectedDetailChunks.length).toBeGreaterThan(1);
  expect(expectedDetailChunks.some((candidate) => candidate.summary.includes('Detailed impact'))).toBe(true);
});

test('semantic filter windows pack leaf candidates up to the window budget', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"notes"}-->
#! Notes

<!--hvy:text {"id":"one"}-->
 ${'one '.repeat(60)}

<!--hvy:text {"id":"two"}-->
 ${'two '.repeat(60)}

<!--hvy:text {"id":"three"}-->
 ${'three '.repeat(60)}
`, '.hvy');

  const expectedResult = buildSemanticFilterWindows({
    document,
    prompt: 'Find notes',
    maxWindowCandidateChars: 900,
  });

  expect(expectedResult.windows.length).toBeGreaterThan(1);
  for (const window of expectedResult.windows) {
    expect(window.candidateBudget.usedTotalCandidateChars).toBeLessThanOrEqual(900);
  }
  expect(expectedResult.windows.flatMap((window) => window.candidates.map((candidate) => candidate.targetId))).toEqual([
    'one',
    'two',
    'three',
  ]);
});

test('semantic retrieval chunks merge leaves by section and split large sections at the target size', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"small"}-->
#! Small

<!--hvy:text {"id":"small-one"}-->
 small one

<!--hvy:text {"id":"small-two"}-->
 small two

<!--hvy: {"id":"large"}-->
#! Large

<!--hvy:text {"id":"large-one"}-->
 ${'large one '.repeat(30)}

<!--hvy:text {"id":"large-two"}-->
 ${'large two '.repeat(30)}

<!--hvy:text {"id":"large-three"}-->
 ${'large three '.repeat(30)}
`, '.hvy');

  const expectedResult = buildSemanticRetrievalChunks(document, { targetChunkChars: 500 });
  const smallChunks = expectedResult.filter((chunk) => chunk.sectionKey === document.sections[0]!.key);
  const largeChunks = expectedResult.filter((chunk) => chunk.sectionKey === document.sections[1]!.key);

  expect(smallChunks).toHaveLength(1);
  expect(smallChunks[0]!.sourceCandidateIds).toEqual(['component:small-one', 'component:small-two']);
  expect(largeChunks.length).toBeGreaterThan(1);
  expect([...new Set(largeChunks.flatMap((chunk) => chunk.sourceCandidateIds))]).toEqual([
    'component:large-one',
    'component:large-two',
    'component:large-three',
  ]);
  for (const chunk of largeChunks) {
    expect(chunk.summary.length).toBeLessThanOrEqual(500);
  }
});

test('semantic retrieval chunks use configurable overlap and continuation markers for oversized leaves', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"large"}-->
#! Large

<!--hvy:text {"id":"long-note"}-->
 ${'alpha '.repeat(140)}needle ${'omega '.repeat(140)}
`, '.hvy');

  const expectedResult = buildSemanticRetrievalChunks(document, { targetChunkChars: 500, overlapChars: 200 });

  expect(expectedResult.length).toBeGreaterThan(1);
  expect(expectedResult.some((chunk) => chunk.summary.startsWith('...') || chunk.summary.includes('\n\n...'))).toBe(true);
  expect(expectedResult.some((chunk) => chunk.summary.endsWith('...'))).toBe(true);
  expect(expectedResult.some((chunk, index) =>
    index > 0 && expectedResult[index - 1]!.summary.slice(-80).includes(chunk.summary.replace(/^\.\.\./, '').slice(0, 20))
  )).toBe(true);
  for (const chunk of expectedResult) {
    expect(chunk.summary.length).toBeLessThanOrEqual(500);
  }
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

  expect(seenWindows).toEqual(['Skills / TypeScript tooling.']);
  expect(renderApp).toHaveBeenCalled();
  expect(state.search.semanticProgress).toMatchObject({
    completedWindows: 1,
    totalWindows: 1,
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

test('public document filter snapshot matches in-document semantic filter results', async () => {
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
  state.currentView = 'viewer';
  state.search.activeTab = 'filter';
  state.search.filterQueryMode = 'semantic';
  state.search.queryDraft = 'Find TypeScript experience';
  const renderApp = vi.fn();
  initCallbacks({
    renderApp,
    refreshReaderPanels: vi.fn(),
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  const provider = vi.fn((request) => {
    const match = request.candidates.find((candidate) => candidate.targetId === 'typescript');
    return match ? [{
      candidateId: match.candidateId,
      reason: 'TypeScript work is relevant.',
      score: 0.91,
    }] : [];
  });
  setReferenceAppConfig({ semanticFilterProvider: provider });

  const expectedSnapshot = await createDocumentFilterSnapshot({
    document,
    query: 'Find TypeScript experience',
    mode: 'semantic',
    view: 'viewer',
    semanticFilterProvider: provider,
  });
  await applySearchFilter({ enabled: true });

  expect(state.search.results).toEqual(expectedSnapshot.results);
  expect(state.search.submittedQuery).toBe(expectedSnapshot.query);
  expect(state.search.submittedFilterQueryMode).toBe(expectedSnapshot.mode);
  expect(state.search.filterEnabled).toBe(expectedSnapshot.filterEnabled);
  expect(provider.mock.calls[0]?.[0].instructionPrompt).toBe(provider.mock.calls[1]?.[0].instructionPrompt);
});

test('public document filter snapshot preserves nested semantic leaf matches when converted to state', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:component-list {"id":"roles","componentListComponent":"expandable"}-->
 <!--hvy:component-list:0 {}-->
  <!--hvy:expandable {"id":"northwind-role","expandableAlwaysShowStub":true,"expandableExpanded":false}-->
    <!--hvy:expandable:stub {}-->
     <!--hvy:text {"id":"northwind-title"}-->
      Northwind Labs

    <!--hvy:expandable:content {}-->
     <!--hvy:text {"id":"northwind-impact"}-->
      TypeScript dashboard architecture

 <!--hvy:component-list:1 {}-->
  <!--hvy:expandable {"id":"southwind-role","expandableAlwaysShowStub":true,"expandableExpanded":false}-->
    <!--hvy:expandable:stub {}-->
     <!--hvy:text {"id":"southwind-title"}-->
      Southwind Labs

    <!--hvy:expandable:content {}-->
     <!--hvy:text {"id":"southwind-impact"}-->
      Python data pipelines
`, '.hvy');

  const list = document.sections[0]!.blocks[0]!;
  const matchedRecord = list.schema.componentListBlocks[0]!;
  const matchedDetail = matchedRecord.schema.expandableContentBlocks.children[0]!;
  const siblingRecord = list.schema.componentListBlocks[1]!;

  const snapshot = await createDocumentFilterSnapshot({
    document,
    query: 'Find TypeScript dashboard work',
    mode: 'semantic',
    view: 'viewer',
    semanticFilterProvider: (request) => {
      const match = request.candidates.find((candidate) => candidate.targetId === 'northwind-impact');
      return match ? [{ candidateId: match.candidateId, reason: 'TypeScript dashboard work.' }] : [];
    },
  });
  const expectedState = searchSnapshotToState(snapshot);
  const expectedContext = createSearchFilterContext(document.sections, expectedState);

  expect(expectedState.results[0]).toMatchObject({
    category: 'semantic',
    blockId: matchedDetail.id,
    targetId: 'northwind-impact',
  });
  expect(expectedContext.matchedBlocks.has(matchedDetail.id)).toBe(true);
  expect(expectedContext.matchedBlocks.has(matchedRecord.id)).toBe(false);
  expect(expectedContext.visibleBlocks.has(matchedRecord.id)).toBe(true);
  expect(expectedContext.visibleBlocks.has(siblingRecord.id)).toBe(false);
});

test('semantic filtering waits for provider results before changing document filtering', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"typescript"}-->
 TypeScript tooling.
`, '.hvy');
  initState(createTestState(document));
  state.search.activeTab = 'filter';
  state.search.filterEnabled = true;
  state.search.filterQueryMode = 'semantic';
  state.search.submittedFilterQueryMode = 'semantic';
  state.search.submittedQuery = 'old filter';
  state.search.queryDraft = 'Find TypeScript experience';
  const refreshReaderPanels = vi.fn();
  initCallbacks({
    renderApp: vi.fn(),
    refreshReaderPanels,
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: null,
  });

  let finishProvider: (() => void) | null = null;
  const providerStarted = new Promise<void>((resolveStarted) => {
    setReferenceAppConfig({
      semanticFilterProvider: async () => {
        resolveStarted();
        await new Promise<void>((resolveProvider) => {
          finishProvider = resolveProvider;
        });
        return [];
      },
    });
  });

  const filterPromise = applySearchFilter({ enabled: true });
  await providerStarted;

  expect(state.search.filterEnabled).toBe(true);
  expect(refreshReaderPanels).not.toHaveBeenCalled();

  expect(finishProvider).not.toBeNull();
  finishProvider?.();
  await filterPromise;

  expect(state.search.filterEnabled).toBe(false);
  expect(refreshReaderPanels).toHaveBeenCalled();
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

test('semantic filtering reports provider errors instead of no matches', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"typescript"}-->
 TypeScript tooling.
`, '.hvy');
  initState(createTestState(document));
  initCallbacks({
    renderApp: vi.fn(),
    refreshReaderPanels: vi.fn(),
    refreshModalPreview: vi.fn(),
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  state.search.open = true;
  state.search.activeTab = 'filter';
  state.search.filterQueryMode = 'semantic';
  state.search.queryDraft = 'Find TypeScript experience';
  setReferenceAppConfig({
    semanticFilterProvider: async () => {
      throw new Error('Server error');
    },
  });

  await applySearchFilter({ enabled: true });

  expect(state.search.filterEnabled).toBe(false);
  expect(state.search.error).toBe('Server error');
  const expectedMarkup = renderSearchModal(state.search, document, {
    escapeAttr: escapeHtml,
    escapeHtml,
    readerRenderer: null as never,
  });
  expect(expectedMarkup).toContain('Server error');
  expect(expectedMarkup).not.toContain('No semantic matches. Try a more specific prompt.');
});

test('filter tab boxes no results and disables repeat filtering', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills
`, '.hvy');

  const expectedMarkup = renderSearchModal({
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
    '["section:skills","invented"]',
    new Set(['section:skills']),
  );

  expect(expectedResult).toEqual([{
    candidateId: 'section:skills',
  }]);
});

test('semantic provider parser reads the final JSON array after short selection notes', () => {
  const expectedResult = parseSemanticFilterResponse(
    [
      'First pass: component:C7 matches directly; component:C27 matches directly.',
      '["component:C7","component:C27"]',
    ].join('\n'),
    new Set(['component:C7', 'component:C27']),
  );

  expect(expectedResult).toEqual([
    { candidateId: 'component:C7' },
    { candidateId: 'component:C27' },
  ]);
});

test('semantic provider parser recovers id arrays from object wrappers', () => {
  const expectedResult = parseSemanticFilterResponse(
    '{"matches":["component:C7","component:C27"]}',
    new Set(['component:C7', 'component:C27']),
  );

  expect(expectedResult).toEqual([
    { candidateId: 'component:C7' },
    { candidateId: 'component:C27' },
  ]);
});

test('semantic provider parser uses the final array when earlier JSON is present', () => {
  const expectedResult = parseSemanticFilterResponse(
    '{"firstPass":"component:C7 matches directly."}\n["component:C7"]',
    new Set(['component:C7']),
  );

  expect(expectedResult).toEqual([
    { candidateId: 'component:C7' },
  ]);
});

test('semantic provider parser accepts fenced arrays', () => {
  const expectedResult = parseSemanticFilterResponse(
    'Relevant candidates:\n```json\n["section:skills"]\n```',
    new Set(['section:skills']),
  );

  expect(expectedResult).toEqual([{
    candidateId: 'section:skills',
  }]);
});

test('semantic provider parser accepts prose after the final JSON array', () => {
  const expectedResult = parseSemanticFilterResponse(
    '["component:C6"]\nDone.',
    new Set(['component:C6']),
  );

  expect(expectedResult).toEqual([{
    candidateId: 'component:C6',
  }]);
});

test('semantic provider parser accepts an empty final array for no relevant candidates', () => {
  const expectedResult = parseSemanticFilterResponse(
    'First pass: none of the candidates are relevant.\n[]',
    new Set(['component:C6']),
  );

  expect(expectedResult).toEqual([]);
});

test('semantic provider parser errors when returned matches have no valid ids', () => {
  expect(() => parseSemanticFilterResponse(
    '["invented"]',
    new Set(['section:skills']),
  )).toThrow('Semantic filtering response did not include any valid candidate IDs.');
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
  expect(expectedResult.snapshot).toMatchObject({
    query: 'shared',
    mode: 'keyword',
    caseSensitive: false,
    categories: ['contents'],
    filterEnabled: true,
    filterMode: 'deprioritize',
  });
  expect(expectedResult.snapshot.results.map((result) => result.documentId)).toEqual(['first-doc', 'second-doc']);
});

test('document search hides template scaffold sections like viewer search', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
title: Template Search
---

<!--hvy: {"id":"visible"}-->
#! Visible

<!--hvy:text {"id":"visible-note"}-->
 shared keyword

<!--hvy: {"id":"hidden","hideIfUnmodified":true}-->
#! Hidden

<!--hvy:text {"id":"hidden-note"}-->
 shared keyword
`, '.hvy');

  const expectedResult = await searchDocuments({
    query: 'shared',
    documents: [{ documentId: 'template-doc', document }],
    mode: 'keyword',
    categories: ['contents'],
  });

  expect(expectedResult.results.map((result) => result.targetId)).toEqual(['visible-note']);
  expect(expectedResult.snapshot.results.map((result) => result.targetId)).toEqual(['visible-note']);
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
      expect(request.instructionPrompt).toContain('document-id="second-doc"');
      expect(request.instructionPrompt).toContain('document-title="Second"');
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

test('document semantic search excludes hidden template scaffold candidates', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
title: Template Search
---

<!--hvy: {"id":"visible"}-->
#! Visible

<!--hvy:text {"id":"visible-note"}-->
 visible semantic content

<!--hvy: {"id":"hidden","hideIfUnmodified":true}-->
#! Hidden

<!--hvy:text {"id":"hidden-note"}-->
 hidden semantic content
`, '.hvy');

  const expectedResult = await searchDocuments({
    query: 'semantic content',
    mode: 'semantic',
    documents: [{ documentId: 'template-doc', document }],
    semanticFilterProvider: (request) => {
      expect(request.candidates.map((candidate) => candidate.targetId)).not.toContain('hidden-note');
      const match = request.candidates.find((candidate) => candidate.targetId === 'visible-note');
      return match ? [{ candidateId: match.candidateId, reason: 'Visible content is relevant.' }] : [];
    },
  });

  expect(expectedResult.results.map((result) => result.targetId)).toEqual(['visible-note']);
});

test('document search snapshot can be reduced to one selected document', async () => {
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

  const response = await searchDocuments({
    query: 'Find databases',
    mode: 'semantic',
    documents: [
      { documentId: 'first-doc', document: firstDocument },
      { documentId: 'second-doc', document: secondDocument },
    ],
    semanticFilterProvider: (request) => {
      const match = request.candidates.find((candidate) =>
        candidate.documentId === 'second-doc' && candidate.targetKind === 'block'
      );
      return match ? [{
        candidateId: match.candidateId,
        reason: 'Database work is relevant.',
      }] : [];
    },
  });

  const expectedResult = createDocumentSearchSnapshot(response, 'second-doc', { filterMode: 'hide' });

  expect(expectedResult).toMatchObject({
    documentId: 'second-doc',
    documentTitle: 'Second',
    query: 'Find databases',
    mode: 'semantic',
    filterEnabled: true,
    filterMode: 'hide',
  });
  expect(expectedResult.results).toHaveLength(1);
  expect(expectedResult.results[0]!.id).toBe('semantic-1');
  expect(expectedResult.results[0]!.targetId).toBe('second-note');
});

test('document snapshot state normalization clears empty or null filters', () => {
  const expectedNullState = searchSnapshotToState(null);
  const expectedEmptyState = searchSnapshotToState({
    query: 'Missing',
    mode: 'keyword',
    filterEnabled: true,
    results: [],
  });

  expect(expectedNullState.filterEnabled).toBe(false);
  expect(expectedNullState.submittedQuery).toBe('');
  expect(expectedNullState.results).toEqual([]);
  expect(expectedEmptyState.filterEnabled).toBe(false);
  expect(expectedEmptyState.submittedQuery).toBe('Missing');
  expect(expectedEmptyState.results).toEqual([]);
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
