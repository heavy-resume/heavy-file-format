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
    activeTab: 'search',
    filterEnabled: false,
    filterMode: 'deprioritize',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    semanticProgress: null,
    error: null,
    results: [],
    navigationResultIds: [],
    clearedSectionKeys: [],
    clearedBlockIds: [],
    requestNonce: 0,
    abortController: null,
  };
}
