import type { AppActionHandler } from './types';
import { closeSearch, openSearch, selectSearchResult } from '../../search/actions';

const openSearchAction: AppActionHandler = ({ app }) => {
  openSearch(app);
};

const closeSearchAction: AppActionHandler = () => {
  closeSearch();
};

const selectSearchResultAction: AppActionHandler = ({ app, actionButton }) => {
  selectSearchResult(app, actionButton.dataset.searchResultId ?? '');
};

export const searchActions: Record<string, AppActionHandler> = {
  'open-search': openSearchAction,
  'close-search': closeSearchAction,
  'select-search-result': selectSearchResultAction,
};
