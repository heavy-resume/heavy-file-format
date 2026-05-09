import { builtInSearchProvider } from './search-provider';
import { getReferenceAppConfig } from '../reference-config';
import { navigateToSection } from '../navigation';
import { state, getRenderApp, getRefreshReaderPanels } from '../state';
import type { HvySearchResult, SearchCategory } from './types';
import { focusSearchInput } from './render';

const CATEGORY_ORDER: SearchCategory[] = ['tags', 'contents', 'description'];

export function openSearch(app: HTMLElement): void {
  state.search.open = true;
  state.search.error = null;
  getRenderApp()();
  focusSearchInput(app);
}

export function closeSearch(): void {
  state.search.open = false;
  state.search.abortController?.abort();
  state.search.abortController = null;
  state.search.isLoading = false;
  getRenderApp()();
}

export async function submitSearch(): Promise<void> {
  const query = state.search.queryDraft.trim();
  state.search.submittedQuery = query;
  state.search.activeResultId = null;
  state.search.error = null;
  state.search.abortController?.abort();

  if (!query) {
    state.search.results = [];
    state.search.isLoading = false;
    getRenderApp()();
    return;
  }

  const categories = getEnabledSearchCategories();
  if (categories.length === 0) {
    state.search.results = [];
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
    const results = await provider({
      document: state.document,
      query,
      caseSensitive: state.search.caseSensitive,
      categories,
      signal: abortController.signal,
    });
    if (state.search.requestNonce !== requestNonce || abortController.signal.aborted) {
      return;
    }
    state.search.results = normalizeSearchResults(results);
    if (state.search.filterEnabled && state.currentView === 'editor') {
      state.currentView = 'viewer';
    }
    state.search.error = null;
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }
    state.search.results = [];
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
  state.search.activeResultId = result.id;
  const targetId = result.targetId.trim();
  if (targetId) {
    navigateToSection(targetId, app);
    state.search.open = true;
    getRenderApp()();
    return;
  }
  state.currentView = state.currentView === 'editor' ? 'viewer' : state.currentView;
  getRenderApp()();
  window.setTimeout(() => {
    const selector = `[data-section-key="${cssEscape(result.sectionKey)}"]${result.blockId ? `[data-block-id="${cssEscape(result.blockId)}"]` : ''}`;
    const target = app.querySelector<HTMLElement>(selector);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.classList.add('is-temp-highlighted');
    window.setTimeout(() => target?.classList.remove('is-temp-highlighted'), 1400);
  }, 20);
}

export function setSearchFilterEnabled(enabled: boolean): void {
  state.search.filterEnabled = enabled;
  if (enabled && state.currentView === 'editor') {
    state.currentView = 'viewer';
  }
  getRefreshReaderPanels()();
  if (enabled) {
    getRenderApp()();
  }
}

export function setSearchCategory(category: SearchCategory, enabled: boolean): void {
  state.search.categories[category] = enabled;
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

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1');
}
