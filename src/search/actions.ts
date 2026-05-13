import { builtInSearchProvider } from './search-provider';
import { getReferenceAppConfig } from '../reference-config';
import { navigateToReaderTarget } from '../navigation';
import { state, getRenderApp, getRefreshReaderPanels } from '../state';
import type { HvySearchResult, SearchCategory } from './types';
import type { VisualBlock, VisualSection } from '../editor/types';
import { filterTemplateVisibleSections } from '../template-hide';
import { focusSearchInput } from './render';

const CATEGORY_ORDER: SearchCategory[] = ['tags', 'contents', 'description'];

export function openSearch(app: HTMLElement): void {
  state.search.open = true;
  state.search.resultsCollapsed = false;
  state.search.error = null;
  getRenderApp()();
  focusSearchInput(app);
}

export function expandSearchResults(app: HTMLElement): void {
  state.search.open = true;
  state.search.resultsCollapsed = false;
  getRenderApp()();
  focusSearchInput(app);
}

export function closeSearch(): void {
  const keepFilter = state.search.filterEnabled && state.search.submittedQuery.trim().length > 0;
  state.search.open = false;
  state.search.resultsCollapsed = false;
  if (!keepFilter) {
    state.search.submittedQuery = '';
    state.search.activeResultId = null;
    state.search.navigationResultIds = [];
    state.search.filterEnabled = false;
  }
  state.search.abortController?.abort();
  state.search.abortController = null;
  state.search.requestNonce += 1;
  state.search.isLoading = false;
  getRenderApp()();
}

export function stopSearch(): void {
  state.search.open = false;
  state.search.resultsCollapsed = false;
  state.search.queryDraft = '';
  state.search.submittedQuery = '';
  state.search.activeResultId = null;
  state.search.navigationResultIds = [];
  state.search.filterEnabled = false;
  state.search.results = [];
  state.search.clearedSectionKeys = [];
  state.search.clearedBlockIds = [];
  state.search.error = null;
  state.search.abortController?.abort();
  state.search.abortController = null;
  state.search.requestNonce += 1;
  state.search.isLoading = false;
  getRefreshReaderPanels()();
  getRenderApp()();
}

export async function submitSearch(): Promise<void> {
  const query = state.search.queryDraft.trim();
  state.search.submittedQuery = query;
  state.search.activeResultId = null;
  state.search.resultsCollapsed = false;
  state.search.error = null;
  state.search.abortController?.abort();
  state.search.clearedSectionKeys = [];
  state.search.clearedBlockIds = [];

  if (!query) {
    state.search.results = [];
    state.search.navigationResultIds = [];
    state.search.isLoading = false;
    getRenderApp()();
    return;
  }

  const categories = getEnabledSearchCategories();
  if (categories.length === 0) {
    state.search.results = [];
    state.search.navigationResultIds = [];
    state.search.error = 'Choose at least one category.';
    state.search.isLoading = false;
    getRenderApp()();
    return;
  }

  const requestNonce = state.search.requestNonce + 1;
  const abortController = new AbortController();
  state.search.requestNonce = requestNonce;
  state.search.abortController = abortController;
  state.search.isLoading = true;
  getRenderApp()();

  try {
    const provider = getReferenceAppConfig().searchProvider ?? builtInSearchProvider;
    const searchDocument = state.currentView === 'viewer'
      ? { ...state.document, sections: filterTemplateVisibleSections(state.document.sections) }
      : state.document;
    const results = await provider({
      document: searchDocument,
      query,
      caseSensitive: state.search.caseSensitive,
      categories,
      signal: abortController.signal,
    });
    if (state.search.requestNonce !== requestNonce || abortController.signal.aborted) {
      return;
    }
    state.search.results = normalizeSearchResults(results);
    state.search.navigationResultIds = getDocumentOrderSearchResults(state.search.results).map((result) => result.id);
    if (state.search.filterEnabled && state.currentView === 'editor') {
      state.currentView = 'viewer';
    }
    state.search.error = null;
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }
    state.search.results = [];
    state.search.navigationResultIds = [];
    state.search.error = error instanceof Error ? error.message : 'Search failed.';
  } finally {
    if (state.search.requestNonce !== requestNonce) {
      return;
    }
    state.search.isLoading = false;
    state.search.abortController = null;
    getRenderApp()();
  }
}

export function selectSearchResult(app: HTMLElement, resultId: string): void {
  const result = state.search.results.find((candidate) => candidate.id === resultId);
  if (!result) {
    return;
  }
  state.search.navigationResultIds = getSearchNavigationResults(app).map((candidate) => candidate.id);
  state.search.activeResultId = result.id;
  state.search.open = true;
  state.search.resultsCollapsed = true;
  getRenderApp()();
  window.setTimeout(() => {
    navigateToReaderTarget({
      targetId: result.targetId,
      sectionKey: result.sectionKey,
      blockId: result.blockId,
      matchText: result.matchedText,
    }, app);
  }, 0);
}

export function selectAdjacentSearchResult(app: HTMLElement, direction: 1 | -1): void {
  if (!state.search.open || state.search.results.length === 0) {
    return;
  }
  const orderedResults = getSearchNavigationResults(app);
  state.search.navigationResultIds = orderedResults.map((result) => result.id);
  const currentIndex = state.search.activeResultId
    ? orderedResults.findIndex((result) => result.id === state.search.activeResultId)
    : -1;
  const nextIndex = currentIndex < 0
    ? direction > 0 ? 0 : orderedResults.length - 1
    : (currentIndex + direction + orderedResults.length) % orderedResults.length;
  selectSearchResult(app, orderedResults[nextIndex]!.id);
}

export function setSearchFilterEnabled(enabled: boolean): void {
  state.search.filterEnabled = enabled;
  if (enabled && state.currentView === 'editor') {
    state.currentView = 'viewer';
  }
  getRefreshReaderPanels()();
  getRenderApp()();
}

export function setSearchCategory(category: SearchCategory, enabled: boolean): void {
  state.search.categories[category] = enabled;
}

export function setSearchTab(tab: typeof state.search.activeTab): void {
  state.search.activeTab = tab;
  getRenderApp()();
}

export function setSearchFilterMode(mode: typeof state.search.filterMode): void {
  state.search.filterMode = mode;
  getRenderApp()();
}

export async function applySearchFilter(options: { enabled?: boolean } = {}): Promise<void> {
  const enabled = options.enabled ?? !state.search.filterEnabled;
  if (!enabled) {
    state.search.filterEnabled = false;
    state.search.submittedQuery = '';
    state.search.activeResultId = null;
    state.search.navigationResultIds = [];
    state.search.open = false;
    state.search.resultsCollapsed = false;
    getRefreshReaderPanels()();
    getRenderApp()();
    return;
  }
  const queryChanged = state.search.queryDraft.trim() !== state.search.submittedQuery.trim();
  if (queryChanged) {
    state.search.filterEnabled = false;
    getRefreshReaderPanels()();
  }
  if (state.search.queryDraft.trim() !== state.search.submittedQuery.trim()) {
    await submitSearch();
  }
  if (!state.search.submittedQuery.trim() || state.search.error || state.search.results.length === 0) {
    state.search.filterEnabled = false;
    state.search.open = true;
    state.search.resultsCollapsed = false;
    if (!state.search.error && state.search.submittedQuery.trim()) {
      state.search.error = 'No matches. Try another term.';
    }
    getRefreshReaderPanels()();
    getRenderApp()();
    return;
  }
  state.search.clearedSectionKeys = [];
  state.search.clearedBlockIds = [];
  state.search.filterEnabled = true;
  if (state.currentView === 'editor') {
    state.currentView = 'viewer';
  }
  state.search.open = false;
  state.search.resultsCollapsed = false;
  getRefreshReaderPanels()();
  getRenderApp()();
}

export function clearFilteringForTarget(sectionKey: string, blockId?: string): void {
  if (!state.search.filterEnabled || !state.search.submittedQuery.trim()) {
    return;
  }
  const clearBlockId = blockId ? getFilterClearBlockTarget(sectionKey, blockId) : null;
  if (clearBlockId) {
    state.search.clearedBlockIds = [...new Set([...(state.search.clearedBlockIds ?? []), clearBlockId])];
  } else {
    state.search.clearedSectionKeys = [...new Set([...(state.search.clearedSectionKeys ?? []), sectionKey])];
  }
  getRefreshReaderPanels()();
  getRenderApp()();
}

function getFilterClearBlockTarget(sectionKey: string, blockId: string): string | null {
  const section = findSectionByKeyDeep(state.document.sections, sectionKey);
  if (!section) {
    return blockId;
  }
  for (const block of section.blocks) {
    const path = findBlockPath(block, blockId);
    if (!path) {
      continue;
    }
    const semanticAncestor = path.find((candidate) => !isLayoutOnlyBlock(candidate));
    return semanticAncestor?.id ?? blockId;
  }
  return blockId;
}

function findSectionByKeyDeep(sections: VisualSection[], sectionKey: string): VisualSection | null {
  for (const section of sections) {
    if (section.key === sectionKey) {
      return section;
    }
    const child = findSectionByKeyDeep(section.children, sectionKey);
    if (child) {
      return child;
    }
  }
  return null;
}

function findBlockPath(block: VisualBlock, blockId: string): VisualBlock[] | null {
  if (block.id === blockId) {
    return [block];
  }
  const children = [
    ...block.schema.containerBlocks,
    ...block.schema.componentListBlocks,
    ...block.schema.expandableStubBlocks.children,
    ...block.schema.expandableContentBlocks.children,
    ...block.schema.gridItems.map((item) => item.block),
  ];
  for (const child of children) {
    const path = findBlockPath(child, blockId);
    if (path) {
      return [block, ...path];
    }
  }
  return null;
}

function isLayoutOnlyBlock(block: VisualBlock): boolean {
  return block.schema.component === 'grid'
    || block.schema.component === 'container'
    || block.schema.component === 'component-list'
    || block.schema.gridItems.length > 0
    || block.schema.containerBlocks.length > 0
    || block.schema.componentListBlocks.length > 0;
}

export function getEnabledSearchCategories(): SearchCategory[] {
  return CATEGORY_ORDER.filter((category) => state.search.categories[category]);
}

function normalizeSearchResults(results: HvySearchResult[]): HvySearchResult[] {
  return results.map((result, index) => ({
    ...result,
    id: result.id.trim() || `search-${index + 1}`,
  }));
}

function getSearchNavigationResults(app: HTMLElement): HvySearchResult[] {
  if (!shouldUseRenderedSearchOrder()) {
    return getDocumentOrderSearchResults(state.search.results);
  }
  const viewOrder = getRenderedSearchTargetOrder(app);
  return [...state.search.results].sort((left, right) => {
    const leftKey = getSearchResultTargetKey(left);
    const rightKey = getSearchResultTargetKey(right);
    const leftViewOrder = viewOrder.get(leftKey);
    const rightViewOrder = viewOrder.get(rightKey);
    if (leftViewOrder !== undefined || rightViewOrder !== undefined) {
      return (leftViewOrder ?? Number.MAX_SAFE_INTEGER) - (rightViewOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return (left.documentOrder ?? 0) - (right.documentOrder ?? 0);
  });
}

function getDocumentOrderSearchResults(results: HvySearchResult[]): HvySearchResult[] {
  return [...results].sort((left, right) => (left.documentOrder ?? 0) - (right.documentOrder ?? 0));
}

function shouldUseRenderedSearchOrder(): boolean {
  return state.search.filterEnabled
    || Object.keys(state.readerView).length > 0
    || Object.keys(state.componentListReaderViews).length > 0;
}

function getRenderedSearchTargetOrder(app: HTMLElement): Map<string, number> {
  const order = new Map<string, number>();
  const selector = [
    '#readerDocument [data-section-key]',
    '#readerSidebarSections [data-section-key]',
    '#aiReaderDocument [data-section-key]',
    '#aiSidebarSections [data-section-key]',
  ].join(', ');
  app.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const sectionKey = element.dataset.sectionKey;
    if (!sectionKey) {
      return;
    }
    const key = element.dataset.blockId
      ? `block:${sectionKey}:${element.dataset.blockId}`
      : `section:${sectionKey}`;
    if (!order.has(key)) {
      order.set(key, order.size);
    }
  });
  return order;
}

function getSearchResultTargetKey(result: HvySearchResult): string {
  return result.blockId ? `block:${result.sectionKey}:${result.blockId}` : `section:${result.sectionKey}`;
}
