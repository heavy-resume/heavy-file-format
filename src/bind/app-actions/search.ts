import type { AppActionHandler } from './types';
import { closeSearch, expandSearchResults, openSearch, selectAdjacentSearchResult, selectSearchResult } from '../../search/actions';

const openSearchAction: AppActionHandler = ({ app }) => {
  openSearch(app);
};

const closeSearchAction: AppActionHandler = () => {
  closeSearch();
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

export const searchActions: Record<string, AppActionHandler> = {
  'open-search': openSearchAction,
  'close-search': closeSearchAction,
  'expand-search-results': expandSearchResultsAction,
  'select-search-result': selectSearchResultAction,
  'previous-search-result': previousSearchResultAction,
  'next-search-result': nextSearchResultAction,
};
