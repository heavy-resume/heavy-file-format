import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import type {
  HvyDocumentSearchResponse,
  HvyDocumentSearchResponseSnapshot,
  HvyDocumentSearchSnapshot,
  HvyDocumentSearchResult,
  HvySearchResult,
  HvySearchSnapshot,
  HvySearchSnapshotInput,
  SearchCategory,
  SearchState,
} from './types';
import { createDefaultSearchState } from './state';

const SEARCH_CATEGORY_ORDER: SearchCategory[] = ['tags', 'contents', 'description'];

export function createEmptySearchSnapshot(): HvySearchSnapshot {
  return {
    query: '',
    mode: 'keyword',
    caseSensitive: false,
    categories: [...SEARCH_CATEGORY_ORDER],
    filterEnabled: false,
    filterMode: 'deprioritize',
    results: [],
    activeResultId: null,
  };
}

export function createSearchSnapshot(options: {
  query: string;
  mode: HvySearchSnapshot['mode'];
  results: HvySearchResult[];
  caseSensitive?: boolean;
  categories?: SearchCategory[];
  filterEnabled?: boolean;
  filterMode?: HvySearchSnapshot['filterMode'];
  activeResultId?: string | null;
}): HvySearchSnapshot {
  return normalizeSearchSnapshotInput(options);
}

export function createDocumentSearchResponseSnapshot(options: {
  query: string;
  mode: HvySearchSnapshot['mode'];
  results: HvyDocumentSearchResult[];
  caseSensitive?: boolean;
  categories?: SearchCategory[];
  filterMode?: HvySearchSnapshot['filterMode'];
}): HvyDocumentSearchResponseSnapshot {
  const snapshot = normalizeSearchSnapshotInput({
    query: options.query,
    mode: options.mode,
    results: options.results,
    caseSensitive: options.caseSensitive,
    categories: options.categories,
    filterMode: options.filterMode,
  });
  return {
    ...snapshot,
    results: options.results.map(normalizeDocumentSearchResult),
  };
}

export function createDocumentSearchSnapshot(
  response: HvyDocumentSearchResponse,
  documentId: string,
  options: { filterEnabled?: boolean; filterMode?: HvySearchSnapshot['filterMode']; activeResultId?: string | null } = {}
): HvyDocumentSearchSnapshot {
  const normalizedDocumentId = documentId.trim();
  const sourceSnapshot = response.snapshot ?? createDocumentSearchResponseSnapshot({
    query: response.query,
    mode: response.mode,
    results: response.results,
  });
  const results = sourceSnapshot.results
    .filter((result) => result.documentId === normalizedDocumentId)
    .map((result) => normalizeSearchResult(stripDocumentResultPrefix(result, normalizedDocumentId)));
  const documentTitle = sourceSnapshot.results.find((result) => result.documentId === normalizedDocumentId)?.documentTitle;
  const snapshot = normalizeSearchSnapshotInput({
    ...sourceSnapshot,
    results,
    filterEnabled: options.filterEnabled ?? sourceSnapshot.filterEnabled,
    filterMode: options.filterMode ?? sourceSnapshot.filterMode,
    activeResultId: normalizeSelectedActiveResultId(options.activeResultId ?? sourceSnapshot.activeResultId ?? null, normalizedDocumentId),
  });
  return {
    ...snapshot,
    documentId: normalizedDocumentId,
    ...(documentTitle ? { documentTitle } : {}),
  };
}

export function normalizeSearchSnapshotInput(input?: HvySearchSnapshotInput | null): HvySearchSnapshot {
  if (!input) {
    return createEmptySearchSnapshot();
  }
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const mode = input.mode === 'semantic' ? 'semantic' : 'keyword';
  const results = (input.results ?? []).map(normalizeSearchResult);
  const filterEnabled = input.filterEnabled === false ? false : Boolean(query && results.length > 0 && (input.filterEnabled ?? true));
  const activeResultId = normalizeActiveResultId(input.activeResultId ?? null, results);
  return {
    query,
    mode,
    caseSensitive: input.caseSensitive ?? false,
    categories: normalizeSnapshotCategories(input.categories),
    filterEnabled,
    filterMode: input.filterMode === 'hide' ? 'hide' : 'deprioritize',
    results,
    activeResultId,
  };
}

export function searchSnapshotToState(input?: HvySearchSnapshotInput | null): SearchState {
  const snapshot = normalizeSearchSnapshotInput(input);
  const state = createDefaultSearchState();
  return {
    ...state,
    queryDraft: snapshot.query,
    submittedQuery: snapshot.query,
    caseSensitive: snapshot.caseSensitive,
    categories: categoriesToState(snapshot.categories),
    activeTab: snapshot.filterEnabled ? 'filter' : 'search',
    filterEnabled: snapshot.filterEnabled,
    filterMode: snapshot.filterMode,
    filterQueryMode: snapshot.mode,
    submittedFilterQueryMode: snapshot.mode,
    activeResultId: snapshot.activeResultId ?? null,
    results: snapshot.results,
    navigationResultIds: snapshot.results.map((result) => result.id),
  };
}

export function searchSnapshotToDocumentState(input: HvySearchSnapshotInput | null | undefined, document: VisualDocument): SearchState {
  return searchSnapshotToState(alignSearchSnapshotToDocument(input, document));
}

export function searchStateToSnapshot(search: SearchState): HvySearchSnapshot {
  return normalizeSearchSnapshotInput({
    query: search.submittedQuery || search.queryDraft,
    mode: search.submittedFilterQueryMode,
    caseSensitive: search.caseSensitive,
    categories: search.categories,
    filterEnabled: search.filterEnabled,
    filterMode: search.filterMode,
    results: search.results,
    activeResultId: search.activeResultId,
  });
}

export function alignSearchSnapshotToDocument(input: HvySearchSnapshotInput | null | undefined, document: VisualDocument): HvySearchSnapshot {
  const snapshot = normalizeSearchSnapshotInput(input);
  return normalizeSearchSnapshotInput({
    ...snapshot,
    results: snapshot.results.flatMap((result): HvySearchResult[] => {
      const aligned = alignSearchResultToDocument(result, document);
      return aligned ? [aligned] : [];
    }),
  });
}

function alignSearchResultToDocument(result: HvySearchResult, document: VisualDocument): HvySearchResult | null {
  const section = findSnapshotResultSection(result, document.sections);
  if (!section) {
    return null;
  }
  if (result.targetKind === 'section') {
    return {
      ...result,
      sectionKey: section.key,
      targetId: result.targetId || section.customId || section.key,
    };
  }
  const block = findSnapshotResultBlock(result, section);
  if (!block) {
    return null;
  }
  return {
    ...result,
    sectionKey: section.key,
    blockId: block.id,
    targetId: result.targetId || block.id,
  };
}

function findSnapshotResultSection(result: HvySearchResult, sections: VisualSection[]): VisualSection | null {
  const pathSectionId = getPathSectionId(result.targetPath);
  return findSectionByPredicate(sections, (section) =>
    section.key === result.sectionKey
    || section.customId === result.sectionKey
    || Boolean(pathSectionId && section.customId === pathSectionId)
    || (result.targetKind === 'section' && section.customId === result.targetId)
  );
}

function findSnapshotResultBlock(result: HvySearchResult, section: VisualSection): VisualBlock | null {
  const pathBlockId = getPathBlockId(result.targetPath);
  for (const block of section.blocks) {
    const found = findBlockByPredicate(block, (candidate) =>
      candidate.id === result.blockId
      || candidate.id === result.targetId
      || candidate.schema.id === result.targetId
      || Boolean(pathBlockId && candidate.id === pathBlockId)
      || Boolean(pathBlockId && candidate.schema.id === pathBlockId)
    );
    if (found) {
      return found;
    }
  }
  return null;
}

function findSectionByPredicate(sections: VisualSection[], predicate: (section: VisualSection) => boolean): VisualSection | null {
  for (const section of sections) {
    if (predicate(section)) {
      return section;
    }
    const child = findSectionByPredicate(section.children, predicate);
    if (child) {
      return child;
    }
  }
  return null;
}

function findBlockByPredicate(block: VisualBlock, predicate: (block: VisualBlock) => boolean): VisualBlock | null {
  if (predicate(block)) {
    return block;
  }
  for (const child of [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ]) {
    const found = findBlockByPredicate(child, predicate);
    if (found) {
      return found;
    }
  }
  return null;
}

function getPathSectionId(path?: string): string | null {
  const parts = path?.split('/').filter(Boolean) ?? [];
  return parts[0] === 'body' ? parts[1] ?? null : null;
}

function getPathBlockId(path?: string): string | null {
  const parts = path?.split('/').filter(Boolean) ?? [];
  return parts[0] === 'body' ? parts.at(-1) ?? null : null;
}

function normalizeSearchResult(result: HvySearchResult, index = 0): HvySearchResult {
  const id = typeof result.id === 'string' && result.id.trim() ? result.id.trim() : `search-${index + 1}`;
  return {
    ...result,
    id,
  };
}

function normalizeDocumentSearchResult(result: HvyDocumentSearchResult, index = 0): HvyDocumentSearchResult {
  return {
    ...normalizeSearchResult(result, index),
    documentId: result.documentId.trim(),
    ...(result.documentTitle?.trim() ? { documentTitle: result.documentTitle.trim() } : {}),
  };
}

function stripDocumentResultPrefix(result: HvyDocumentSearchResult, documentId: string): HvySearchResult {
  const { documentId: _documentId, documentTitle: _documentTitle, ...localResult } = result;
  const prefix = `${documentId}:`;
  return {
    ...localResult,
    id: localResult.id.startsWith(prefix) ? localResult.id.slice(prefix.length) : localResult.id,
  };
}

function normalizeSelectedActiveResultId(activeResultId: string | null, documentId: string): string | null {
  if (!activeResultId) {
    return null;
  }
  const prefix = `${documentId}:`;
  return activeResultId.startsWith(prefix) ? activeResultId.slice(prefix.length) : activeResultId;
}

function normalizeActiveResultId(activeResultId: string | null, results: HvySearchResult[]): string | null {
  if (!activeResultId) {
    return null;
  }
  return results.some((result) => result.id === activeResultId) ? activeResultId : null;
}

function normalizeSnapshotCategories(categories?: HvySearchSnapshotInput['categories']): SearchCategory[] {
  if (Array.isArray(categories)) {
    const allowed = new Set(SEARCH_CATEGORY_ORDER);
    const seen = new Set<SearchCategory>();
    return categories.filter((category): category is SearchCategory => {
      if (!allowed.has(category) || seen.has(category)) {
        return false;
      }
      seen.add(category);
      return true;
    });
  }
  if (categories && typeof categories === 'object') {
    return SEARCH_CATEGORY_ORDER.filter((category) => categories[category] !== false);
  }
  return [...SEARCH_CATEGORY_ORDER];
}

function categoriesToState(categories: SearchCategory[]): SearchState['categories'] {
  const enabled = new Set(categories);
  return {
    tags: enabled.has('tags'),
    contents: enabled.has('contents'),
    description: enabled.has('description'),
  };
}
