import { getReferenceAppConfig } from '../reference-config';
import { filterTemplateVisibleSections } from '../template-hide';
import type { VisualDocument } from '../types';
import { builtInSearchProvider } from './search-provider';
import { buildSemanticFilterWindows } from './semantic-candidates';
import { buildSemanticSearchResults, runSemanticFilterWindows } from './semantic-filter';
import { traceSemanticFilterEvent } from './semantic-trace';
import { createSearchSnapshot } from './snapshot';
import type {
  HvySearchProvider,
  HvySearchSnapshot,
  HvySemanticFilterProvider,
  SearchCategory,
  SearchFilterMode,
  SearchFilterQueryMode,
} from './types';

const DEFAULT_SEARCH_CATEGORIES: SearchCategory[] = ['tags', 'contents', 'description'];

export interface HvyDocumentFilterSnapshotRequest {
  document: VisualDocument;
  query: string;
  mode?: SearchFilterQueryMode;
  view?: 'viewer' | 'editor' | 'ai';
  filterMode?: SearchFilterMode;
  caseSensitive?: boolean;
  categories?: SearchCategory[];
  searchProvider?: HvySearchProvider | null;
  semanticFilterProvider?: HvySemanticFilterProvider | null;
  maxCandidateSummaryChars?: number;
  maxTotalCandidateChars?: number;
  traceRunId?: string;
  signal?: AbortSignal;
  onSemanticProgress?: (progress: {
    completedWindows: number;
    totalWindows: number;
    matchedCandidates: number;
    includedCandidates: number;
    totalCandidates: number;
  }) => void;
}

export async function createDocumentFilterSnapshot(
  request: HvyDocumentFilterSnapshotRequest
): Promise<HvySearchSnapshot> {
  const query = request.query.trim();
  const mode = request.mode ?? 'keyword';
  const categories = request.categories ?? DEFAULT_SEARCH_CATEGORIES;
  const filterMode = request.filterMode ?? 'deprioritize';
  if (!query) {
    return createSearchSnapshot({
      query,
      mode,
      results: [],
      caseSensitive: request.caseSensitive ?? false,
      categories,
      filterEnabled: false,
      filterMode,
    });
  }

  throwIfAborted(request.signal);
  return mode === 'semantic'
    ? createSemanticDocumentFilterSnapshot(request, query, filterMode)
    : createKeywordDocumentFilterSnapshot(request, query, categories, filterMode);
}

async function createKeywordDocumentFilterSnapshot(
  request: HvyDocumentFilterSnapshotRequest,
  query: string,
  categories: SearchCategory[],
  filterMode: SearchFilterMode
): Promise<HvySearchSnapshot> {
  const provider = request.searchProvider ?? getReferenceAppConfig().searchProvider ?? builtInSearchProvider;
  const results = normalizeSearchResults(await provider({
    document: getFilterDocument(request.document, request.view ?? 'viewer'),
    query,
    caseSensitive: request.caseSensitive ?? false,
    categories,
    ...(request.signal ? { signal: request.signal } : {}),
  }));
  throwIfAborted(request.signal);
  return createSearchSnapshot({
    query,
    mode: 'keyword',
    results,
    caseSensitive: request.caseSensitive ?? false,
    categories,
    filterEnabled: results.length > 0,
    filterMode,
  });
}

async function createSemanticDocumentFilterSnapshot(
  request: HvyDocumentFilterSnapshotRequest,
  query: string,
  filterMode: SearchFilterMode
): Promise<HvySearchSnapshot> {
  const provider = request.semanticFilterProvider ?? getReferenceAppConfig().semanticFilterProvider;
  if (!provider) {
    throw new Error('Semantic filtering is not configured.');
  }

  const document = getFilterDocument(request.document, request.view ?? 'viewer');
  const packet = buildSemanticFilterWindows({
    document,
    prompt: query,
    ...(request.maxCandidateSummaryChars !== undefined ? { maxCandidateSummaryChars: request.maxCandidateSummaryChars } : {}),
    ...(request.maxTotalCandidateChars !== undefined ? { maxTotalCandidateChars: request.maxTotalCandidateChars } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  });
  request.onSemanticProgress?.({
    completedWindows: 0,
    totalWindows: packet.windows.length,
    matchedCandidates: 0,
    includedCandidates: packet.candidateBudget.includedCandidates,
    totalCandidates: packet.candidateBudget.totalCandidates,
  });
  const matches = await runSemanticFilterWindows({
    prompt: query,
    provider,
    windows: packet.windows,
    documentTitle: typeof document.meta.title === 'string' ? document.meta.title : undefined,
    ...(request.traceRunId ? { traceRunId: request.traceRunId } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    onWindowComplete: (progress) => request.onSemanticProgress?.({
      completedWindows: progress.completedWindows,
      totalWindows: packet.windows.length,
      matchedCandidates: progress.matchedCandidates,
      includedCandidates: packet.candidateBudget.includedCandidates,
      totalCandidates: packet.candidateBudget.totalCandidates,
    }),
  });
  throwIfAborted(request.signal);
  const results = normalizeSearchResults(buildSemanticSearchResults(packet.candidates, matches, query));
  traceSemanticFilterEvent(request, 'semantic_filter_results', {
    source: 'document-filter-snapshot',
    prompt: query,
    matches,
    results,
  });
  return createSearchSnapshot({
    query,
    mode: 'semantic',
    results,
    filterEnabled: results.length > 0,
    filterMode,
  });
}

function getFilterDocument(document: VisualDocument, view: 'viewer' | 'editor' | 'ai'): VisualDocument {
  return view === 'viewer'
    ? { ...document, sections: filterTemplateVisibleSections(document.sections) }
    : document;
}

function normalizeSearchResults(results: HvySearchSnapshot['results']): HvySearchSnapshot['results'] {
  return results.map((result, index) => ({
    ...result,
    id: result.id.trim() || `search-${index + 1}`,
  }));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw new DOMException('The operation was aborted.', 'AbortError');
}
