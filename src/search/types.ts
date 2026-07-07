import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';

export type SearchCategory = 'tags' | 'contents' | 'description';
export type SearchResultCategory = SearchCategory | 'semantic';
export type SearchModalTab = 'search' | 'filter';
export type SearchFilterMode = 'deprioritize' | 'hide';
export type SearchFilterQueryMode = 'keyword' | 'semantic';
export type SearchTargetKind = 'section' | 'block';

export interface HvySearchRequest {
  document: VisualDocument;
  query: string;
  caseSensitive: boolean;
  categories: SearchCategory[];
  signal?: AbortSignal;
}

export interface HvySearchResult {
  id: string;
  category: SearchResultCategory;
  targetKind: SearchTargetKind;
  sectionKey: string;
  blockId?: string;
  targetId: string;
  targetRef?: string;
  targetPath?: string;
  label: string;
  locationLabel?: string;
  preview: string;
  matchedText: string;
  sourceField: string;
  contextLabel?: string;
  matches?: HvySearchMatch[];
  documentOrder?: number;
  sourceFile?: string;
  workspaceId?: string;
  score?: number;
}

export interface HvySearchMatch {
  field: string;
  label: string;
  preview: string;
  matchedText: string;
}

export type HvySearchProvider = (request: HvySearchRequest) => Promise<HvySearchResult[]> | HvySearchResult[];

export interface HvySemanticFilterCandidate {
  candidateId: string;
  documentId?: string;
  documentTitle?: string;
  targetKind: SearchTargetKind;
  sectionKey: string;
  blockId?: string;
  targetId: string;
  targetRef?: string;
  targetPath?: string;
  label: string;
  locationLabel?: string;
  contextLabel?: string;
  tags: string[];
  description: string;
  componentType?: string;
  summary: string;
  documentOrder: number;
  truncated: boolean;
  windowChunk?: {
    index: number;
    count: number;
    start: number;
    end: number;
  };
}

export interface HvySemanticFilterCandidateBudget {
  maxCandidateSummaryChars: number;
  maxTotalCandidateChars: number;
  usedTotalCandidateChars: number;
  includedCandidates: number;
  totalCandidates: number;
  truncated: boolean;
}

export interface HvySemanticFilterWindowProgress {
  completedWindows: number;
  totalWindows: number;
  matchedCandidates: number;
  includedCandidates: number;
  totalCandidates: number;
}

export interface HvySemanticFilterRequest {
  prompt: string;
  instructionPrompt: string;
  documentTitle?: string;
  candidates: HvySemanticFilterCandidate[];
  candidateBudget: HvySemanticFilterCandidateBudget;
  windowIndex?: number;
  windowCount?: number;
  windowLabel?: string;
  traceRunId?: string;
  signal?: AbortSignal;
}

export interface HvySemanticFilterMatch {
  candidateId: string;
  reason?: string;
  score?: number;
}

export type HvySemanticFilterProvider = (request: HvySemanticFilterRequest) => Promise<HvySemanticFilterMatch[]> | HvySemanticFilterMatch[];

export interface HvyDocumentSearchDocument {
  documentId: string;
  documentTitle?: string;
  document: VisualDocument;
}

export type HvyDocumentSearchMode = 'keyword' | 'semantic';

export interface HvyDocumentSearchRequest {
  documents: HvyDocumentSearchDocument[];
  query: string;
  mode?: HvyDocumentSearchMode;
  caseSensitive?: boolean;
  categories?: SearchCategory[];
  searchProvider?: HvySearchProvider | null;
  semanticFilterProvider?: HvySemanticFilterProvider | null;
  maxCandidateSummaryChars?: number;
  maxTotalCandidateChars?: number;
  signal?: AbortSignal;
}

export interface HvyDocumentSearchResult extends HvySearchResult {
  documentId: string;
  documentTitle?: string;
}

export interface HvyDocumentSearchResponse {
  query: string;
  mode: HvyDocumentSearchMode;
  results: HvyDocumentSearchResult[];
  snapshot: HvyDocumentSearchResponseSnapshot;
  candidateBudget?: HvySemanticFilterCandidateBudget;
}

export interface HvySearchSnapshot {
  query: string;
  mode: HvyDocumentSearchMode;
  caseSensitive: boolean;
  categories: SearchCategory[];
  filterEnabled: boolean;
  filterMode: SearchFilterMode;
  excludeTags: string;
  results: HvySearchResult[];
  activeResultId?: string | null;
}

export interface HvyDocumentSearchResponseSnapshot extends Omit<HvySearchSnapshot, 'results'> {
  results: HvyDocumentSearchResult[];
}

export interface HvyDocumentSearchSnapshot extends HvySearchSnapshot {
  documentId: string;
  documentTitle?: string;
}

export interface HvySearchSnapshotInput {
  query?: string;
  mode?: HvyDocumentSearchMode | SearchFilterQueryMode;
  caseSensitive?: boolean;
  categories?: SearchCategory[] | Partial<Record<SearchCategory, boolean>>;
  filterEnabled?: boolean;
  filterMode?: SearchFilterMode;
  excludeTags?: string;
  results?: HvySearchResult[];
  activeResultId?: string | null;
}

export interface SearchState {
  open: boolean;
  queryDraft: string;
  submittedQuery: string;
  caseSensitive: boolean;
  categories: Record<SearchCategory, boolean>;
  activeTab: SearchModalTab;
  filterEnabled: boolean;
  filterMode: SearchFilterMode;
  filterQueryMode: SearchFilterQueryMode;
  submittedFilterQueryMode: SearchFilterQueryMode;
  excludeTags?: string;
  submittedExcludeTags?: string;
  resultsCollapsed: boolean;
  activeResultId: string | null;
  isLoading: boolean;
  semanticProgress?: HvySemanticFilterWindowProgress | null;
  error: string | null;
  results: HvySearchResult[];
  navigationResultIds: string[];
  clearedSectionKeys?: string[];
  clearedBlockIds?: string[];
  requestNonce: number;
  abortController: AbortController | null;
}

export interface SearchRenderTarget {
  section: VisualSection;
  block?: VisualBlock;
}
