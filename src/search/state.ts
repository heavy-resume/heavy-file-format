import type { SearchState } from './types';

export function createDefaultSearchState(): SearchState {
  return {
    open: false,
    queryDraft: '',
    submittedQuery: '',
    caseSensitive: false,
    categories: {
      tags: true,
      contents: true,
      description: true,
    },
    filterEnabled: false,
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: [],
    requestNonce: 0,
    abortController: null,
  };
}
