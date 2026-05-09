import type { AppActionHandler } from './types';
import { applySearchFilter, closeSearch, expandSearchResults, openSearch, selectAdjacentSearchResult, selectSearchResult, setSearchCategory, setSearchFilterMode, setSearchTab, stopSearch } from '../../search/actions';
import type { SearchCategory, SearchFilterMode, SearchPaletteTab } from '../../search/types';
import { getRenderApp, state } from '../../state';

const openSearchAction: AppActionHandler = ({ app }) => {
  openSearch(app);
};

const closeSearchAction: AppActionHandler = () => {
  closeSearch();
};

const stopSearchAction: AppActionHandler = () => {
  stopSearch();
};

const expandSearchResultsAction: AppActionHandler = ({ app }) => {
  expandSearchResults(app);
};

const selectSearchResultAction: AppActionHandler = ({ app, actionButton }) => {
  selectSearchResult(app, actionButton.dataset.searchResultId ?? '');
};

const previousSearchResultAction: AppActionHandler = ({ app }) => {
  selectAdjacentSearchResult(app, -1);
};

const nextSearchResultAction: AppActionHandler = ({ app }) => {
  selectAdjacentSearchResult(app, 1);
};

const toggleSearchCategoryAction: AppActionHandler = ({ actionButton }) => {
  const category = actionButton.dataset.searchCategory as SearchCategory | undefined;
  if (category !== 'tags' && category !== 'contents' && category !== 'description') {
    return;
  }
  setSearchCategory(category, !state.search.categories[category]);
  getRenderApp()();
};

const setSearchTabAction: AppActionHandler = ({ actionButton }) => {
  const tab = actionButton.dataset.searchTab as SearchPaletteTab | undefined;
  if (tab === 'search' || tab === 'filter') {
    setSearchTab(tab);
  }
};

const setSearchFilterModeAction: AppActionHandler = ({ actionButton }) => {
  const mode = actionButton.dataset.searchFilterMode as SearchFilterMode | undefined;
  if (mode === 'deprioritize' || mode === 'hide') {
    setSearchFilterMode(mode);
  }
};

const applySearchFilterAction: AppActionHandler = () => {
  const applied = state.search.filterEnabled && state.search.queryDraft.trim() === state.search.submittedQuery.trim();
  void applySearchFilter({ enabled: !applied });
};

export const searchActions: Record<string, AppActionHandler> = {
  'open-search': openSearchAction,
  'close-search': closeSearchAction,
  'stop-search': stopSearchAction,
  'expand-search-results': expandSearchResultsAction,
  'select-search-result': selectSearchResultAction,
  'previous-search-result': previousSearchResultAction,
  'next-search-result': nextSearchResultAction,
  'toggle-search-category': toggleSearchCategoryAction,
  'set-search-tab': setSearchTabAction,
  'set-search-filter-mode': setSearchFilterModeAction,
  'apply-search-filter': applySearchFilterAction,
};
