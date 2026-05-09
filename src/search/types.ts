import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';

export type SearchCategory = 'tags' | 'contents' | 'description';
export type SearchPaletteTab = 'search' | 'filter';
export type SearchFilterMode = 'deprioritize' | 'hide';
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

export interface SearchState {
  open: boolean;
  queryDraft: string;
  submittedQuery: string;
  caseSensitive: boolean;
  categories: Record<SearchCategory, boolean>;
  activeTab: SearchPaletteTab;
  filterEnabled: boolean;
  filterMode: SearchFilterMode;
  resultsCollapsed: boolean;
  activeResultId: string | null;
  isLoading: boolean;
  error: string | null;
  results: HvySearchResult[];
  navigationResultIds: string[];
  requestNonce: number;
  abortController: AbortController | null;
}

export interface SearchRenderTarget {
  section: VisualSection;
  block?: VisualBlock;
}
