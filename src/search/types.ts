import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';

export type SearchCategory = 'tags' | 'contents' | 'description';
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
  category: SearchCategory;
  targetKind: SearchTargetKind;
  sectionKey: string;
  blockId?: string;
  targetId: string;
  targetPath?: string;
  label: string;
  preview: string;
  matchedText: string;
  sourceField: string;
  sourceFile?: string;
  workspaceId?: string;
  score?: number;
}

export type HvySearchProvider = (request: HvySearchRequest) => Promise<HvySearchResult[]> | HvySearchResult[];

export interface SearchState {
  open: boolean;
  queryDraft: string;
  submittedQuery: string;
  caseSensitive: boolean;
  categories: Record<SearchCategory, boolean>;
  filterEnabled: boolean;
  resultsCollapsed: boolean;
  activeResultId: string | null;
  isLoading: boolean;
  error: string | null;
  results: HvySearchResult[];
  requestNonce: number;
  abortController: AbortController | null;
}

export interface SearchRenderTarget {
  section: VisualSection;
  block?: VisualBlock;
}
