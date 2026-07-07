import type { AppActionHandler } from './types';
import { applySearchFilter, closeSearch, expandSearchResults, isSearchFilterApplied, openSearch, selectAdjacentSearchResult, selectSearchResult, setSearchCategory, setSearchFilterMode, setSearchFilterQueryMode, setSearchTab, stopSearch, stopSearchRequest } from '../../search/actions';
import type { SearchCategory, SearchFilterMode, SearchFilterQueryMode, SearchModalTab } from '../../search/types';
import { getRefreshSearchSurface, getRenderApp, state } from '../../state';

const openSearchAction: AppActionHandler = ({ app }) => {
  openSearch(app);
};

const closeSearchAction: AppActionHandler = ({ app }) => {
  closeSearch(app);
};

const stopSearchAction: AppActionHandler = () => {
  stopSearch();
};

const stopSearchRequestAction: AppActionHandler = () => {
  stopSearchRequest();
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

const toggleSearchCategoryAction: AppActionHandler = ({ app, actionButton }) => {
  const category = actionButton.dataset.searchCategory as SearchCategory | undefined;
  if (category !== 'tags' && category !== 'contents' && category !== 'description') {
    return;
  }
  setSearchCategory(category, !state.search.categories[category]);
  if (!getRefreshSearchSurface()(app)) {
    getRenderApp()();
  }
};

const setSearchTabAction: AppActionHandler = ({ app, actionButton }) => {
  const tab = actionButton.dataset.searchTab as SearchModalTab | undefined;
  if (tab === 'search' || tab === 'filter') {
    setSearchTab(tab, app);
  }
};

const setSearchFilterModeAction: AppActionHandler = ({ app, actionButton }) => {
  const mode = actionButton.dataset.searchFilterMode as SearchFilterMode | undefined;
  if (mode === 'deprioritize' || mode === 'hide') {
    setSearchFilterMode(mode, app);
  }
};

const setSearchFilterQueryModeAction: AppActionHandler = ({ app, actionButton }) => {
  const mode = actionButton.dataset.searchFilterQueryMode as SearchFilterQueryMode | undefined;
  if (mode === 'semantic') {
    setSearchFilterQueryMode(state.search.filterQueryMode === 'semantic' ? 'keyword' : 'semantic', app);
    return;
  }
  if (mode === 'keyword') {
    setSearchFilterQueryMode('keyword', app);
  }
};

const applySearchFilterAction: AppActionHandler = () => {
  void applySearchFilter({ enabled: !isSearchFilterApplied() });
};

export const searchActions: Record<string, AppActionHandler> = {
  'open-search': openSearchAction,
  'close-search': closeSearchAction,
  'stop-search': stopSearchAction,
  'stop-search-request': stopSearchRequestAction,
  'expand-search-results': expandSearchResultsAction,
  'select-search-result': selectSearchResultAction,
  'previous-search-result': previousSearchResultAction,
  'next-search-result': nextSearchResultAction,
  'toggle-search-category': toggleSearchCategoryAction,
  'set-search-tab': setSearchTabAction,
  'set-search-filter-mode': setSearchFilterModeAction,
  'set-search-filter-query-mode': setSearchFilterQueryModeAction,
  'apply-search-filter': applySearchFilterAction,
};
