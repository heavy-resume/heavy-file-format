import { builtInSearchProvider } from './search-provider';
import {
  buildSemanticFilterWindowRequest,
  buildSemanticFilterWindows,
  type HvySemanticFilterCandidateWindow,
} from './semantic-candidates';
import { getReferenceAppConfig } from '../reference-config';
import { navigateToReaderTarget, setEditorSidebarOpen } from '../navigation';
import { state, getRenderApp, getRefreshReaderPanels } from '../state';
import type {
  HvySearchResult,
  HvySemanticFilterCandidate,
  HvySemanticFilterMatch,
  HvySemanticFilterProvider,
  SearchCategory,
  SearchFilterQueryMode,
} from './types';
import type { VisualBlock, VisualSection } from '../editor/types';
import { filterTemplateVisibleSections } from '../template-hide';
import { focusSearchInput } from './render';
import { resolveBaseComponentFromMeta } from '../component-defs';

const CATEGORY_ORDER: SearchCategory[] = ['tags', 'contents', 'description'];
const SEMANTIC_FILTER_WINDOW_CONCURRENCY = 3;

export function openSearch(app: HTMLElement): void {
  state.search.open = true;
  state.search.resultsCollapsed = false;
  state.search.error = null;
  getRenderApp()();
  focusSearchInput(app);
}

export function expandSearchResults(app: HTMLElement): void {
  state.search.open = true;
  state.search.resultsCollapsed = false;
  getRenderApp()();
  focusSearchInput(app);
}

export function closeSearch(): void {
  const keepFilter = state.search.filterEnabled && state.search.submittedQuery.trim().length > 0;
  state.search.open = false;
  state.search.resultsCollapsed = false;
  if (!keepFilter) {
    state.search.submittedQuery = '';
    state.search.activeResultId = null;
    state.search.navigationResultIds = [];
    state.search.filterEnabled = false;
    state.search.results = [];
    state.search.clearedSectionKeys = [];
    state.search.clearedBlockIds = [];
  }
  state.search.abortController?.abort();
  state.search.abortController = null;
  state.search.requestNonce += 1;
  state.search.isLoading = false;
  state.search.semanticProgress = null;
  getRenderApp()();
}

export function stopSearch(): void {
  state.search.open = false;
  state.search.resultsCollapsed = false;
  state.search.queryDraft = '';
  state.search.submittedQuery = '';
  state.search.activeResultId = null;
  state.search.navigationResultIds = [];
  state.search.filterEnabled = false;
  state.search.results = [];
  state.search.clearedSectionKeys = [];
  state.search.clearedBlockIds = [];
  state.search.error = null;
  state.search.abortController?.abort();
  state.search.abortController = null;
  state.search.requestNonce += 1;
  state.search.isLoading = false;
  state.search.semanticProgress = null;
  getRefreshReaderPanels()();
  getRenderApp()();
}

export async function submitSearch(): Promise<void> {
  const query = state.search.queryDraft.trim();
  state.search.submittedQuery = query;
  state.search.submittedFilterQueryMode = 'keyword';
  state.search.activeResultId = null;
  state.search.resultsCollapsed = false;
  state.search.error = null;
  state.search.semanticProgress = null;
  state.search.abortController?.abort();
  state.search.clearedSectionKeys = [];
  state.search.clearedBlockIds = [];

  if (!query) {
    state.search.results = [];
    state.search.navigationResultIds = [];
    state.search.isLoading = false;
    getRenderApp()();
    return;
  }

  const categories = getEnabledSearchCategories();
  if (categories.length === 0) {
    state.search.results = [];
    state.search.navigationResultIds = [];
    state.search.error = 'Choose at least one category.';
    state.search.isLoading = false;
    getRenderApp()();
    return;
  }

  const requestNonce = state.search.requestNonce + 1;
  const abortController = new AbortController();
  state.search.requestNonce = requestNonce;
  state.search.abortController = abortController;
  state.search.isLoading = true;
  state.search.semanticProgress = null;
  getRenderApp()();

  try {
    const provider = getReferenceAppConfig().searchProvider ?? builtInSearchProvider;
    const searchDocument = state.currentView === 'viewer'
      ? { ...state.document, sections: filterTemplateVisibleSections(state.document.sections) }
      : state.document;
    const results = await provider({
      document: searchDocument,
      query,
      caseSensitive: state.search.caseSensitive,
      categories,
      signal: abortController.signal,
    });
    if (state.search.requestNonce !== requestNonce || abortController.signal.aborted) {
      return;
    }
    state.search.results = normalizeSearchResults(results);
    state.search.navigationResultIds = getDocumentOrderSearchResults(state.search.results).map((result) => result.id);
    if (state.search.filterEnabled && state.currentView === 'editor') {
      state.currentView = 'viewer';
    }
    state.search.error = null;
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }
    state.search.results = [];
    state.search.navigationResultIds = [];
    state.search.error = error instanceof Error ? error.message : 'Search failed.';
  } finally {
    if (state.search.requestNonce !== requestNonce) {
      return;
    }
    state.search.isLoading = false;
    state.search.semanticProgress = null;
    state.search.abortController = null;
    getRenderApp()();
  }
}

export function selectSearchResult(app: HTMLElement, resultId: string): void {
  const result = state.search.results.find((candidate) => candidate.id === resultId);
  if (!result) {
    return;
  }
  state.search.navigationResultIds = getSearchNavigationResults(app).map((candidate) => candidate.id);
  state.search.activeResultId = result.id;
  state.search.open = true;
  state.search.resultsCollapsed = true;
  if (state.currentView === 'editor') {
    revealEditorSearchTargetInState(result);
  }
  getRenderApp()();
  runAfterSearchResultRender(() => {
    if (state.currentView === 'editor') {
      navigateToEditorSearchTarget(result, app);
      return;
    }
    navigateToReaderTarget({
      targetId: result.targetId,
      sectionKey: result.sectionKey,
      blockId: result.blockId,
      matchText: result.matchedText,
    }, app);
  });
}

function runAfterSearchResultRender(callback: () => void): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

function navigateToEditorSearchTarget(result: HvySearchResult, app: HTMLElement): void {
  alignEditorSidebarToSearchResult(result, app);
  const target = findEditorSearchTarget(result, app);
  if (!target) {
    return;
  }
  scrollEditorSearchTargetIntoView(target);
  target.classList.add('is-temp-highlighted');
  window.setTimeout(() => {
    target.classList.remove('is-temp-highlighted');
  }, 1400);
}

function alignEditorSidebarToSearchResult(result: HvySearchResult, app: HTMLElement): void {
  const section = findSectionByKeyDeep(state.document.sections, result.sectionKey);
  if (section?.location === 'sidebar' && !state.editorSidebarOpen) {
    setEditorSidebarOpen(app, true);
    return;
  }
  if (section?.location !== 'sidebar' && state.editorSidebarOpen) {
    setEditorSidebarOpen(app, false);
  }
}

function revealEditorSearchTargetInState(result: HvySearchResult): void {
  const section = findSectionByKeyDeep(state.document.sections, result.sectionKey);
  if (!section) {
    return;
  }
  state.editorSidebarOpen = section.location === 'sidebar';
  if (!result.blockId) {
    return;
  }
  const path = findBlockPathInList(section.blocks, result.blockId);
  if (!path) {
    return;
  }
  for (const block of path.slice(0, -1)) {
    if (resolveBaseComponentFromMeta(block.schema.component, state.document.meta) !== 'expandable') {
      continue;
    }
    const readerStateKey = `${section.key}:${block.id}`;
    state.readerExpandableState[readerStateKey] = true;
    const editorStateKey = `${section.key}:${block.id}`;
    const current = state.expandableEditorPanels[editorStateKey] ?? { stubOpen: false, expandedOpen: false };
    state.expandableEditorPanels[editorStateKey] = {
      ...current,
      stubOpen: true,
      expandedOpen: true,
    };
  }
}

function findEditorSearchTarget(result: HvySearchResult, app: HTMLElement): HTMLElement | null {
  if (result.blockId) {
    const sectionKey = CSS.escape(result.sectionKey);
    const blockId = CSS.escape(result.blockId);
    return app.querySelector<HTMLElement>(
      `.editor-shell .editor-block-passive[data-section-key="${sectionKey}"][data-block-id="${blockId}"], ` +
      `.editor-shell .editor-block[data-active-block-id="${blockId}"]`
    );
  }
  return app.querySelector<HTMLElement>(`.editor-shell [data-editor-section="${CSS.escape(result.sectionKey)}"]`);
}

function scrollEditorSearchTargetIntoView(target: HTMLElement): void {
  const container = target.closest<HTMLElement>('.editor-tree, .editor-sidebar-panel');
  if (container) {
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    container.scrollTo({
      top: Math.max(0, container.scrollTop + targetRect.top - (containerRect.top + containerRect.height / 2)),
      behavior: 'smooth',
    });
    return;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function selectAdjacentSearchResult(app: HTMLElement, direction: 1 | -1): void {
  if (!state.search.open || state.search.results.length === 0) {
    return;
  }
  const orderedResults = getSearchNavigationResults(app);
  state.search.navigationResultIds = orderedResults.map((result) => result.id);
  const currentIndex = state.search.activeResultId
    ? orderedResults.findIndex((result) => result.id === state.search.activeResultId)
    : -1;
  const nextIndex = currentIndex < 0
    ? direction > 0 ? 0 : orderedResults.length - 1
    : (currentIndex + direction + orderedResults.length) % orderedResults.length;
  selectSearchResult(app, orderedResults[nextIndex]!.id);
}

export function setSearchFilterEnabled(enabled: boolean): void {
  state.search.filterEnabled = enabled;
  if (enabled && state.currentView === 'editor') {
    state.currentView = 'viewer';
  }
  getRefreshReaderPanels()();
  getRenderApp()();
}

export function setSearchCategory(category: SearchCategory, enabled: boolean): void {
  state.search.categories[category] = enabled;
}

export function setSearchTab(tab: typeof state.search.activeTab): void {
  state.search.activeTab = tab;
  getRenderApp()();
}

export function setSearchFilterMode(mode: typeof state.search.filterMode): void {
  state.search.filterMode = mode;
  getRenderApp()();
}

export function setSearchFilterQueryMode(mode: SearchFilterQueryMode): void {
  state.search.filterQueryMode = mode;
  state.search.error = null;
  getRenderApp()();
}

export async function applySearchFilter(options: { enabled?: boolean } = {}): Promise<void> {
  const enabled = options.enabled ?? !state.search.filterEnabled;
  if (!enabled) {
    state.search.filterEnabled = false;
    state.search.submittedQuery = '';
    state.search.activeResultId = null;
    state.search.navigationResultIds = [];
    state.search.open = false;
    state.search.resultsCollapsed = false;
    getRefreshReaderPanels()();
    getRenderApp()();
    return;
  }
  const queryChanged = state.search.queryDraft.trim() !== state.search.submittedQuery.trim()
    || state.search.filterQueryMode !== state.search.submittedFilterQueryMode;
  if (queryChanged) {
    state.search.filterEnabled = false;
    getRefreshReaderPanels()();
  }
  if (state.search.filterQueryMode === 'semantic') {
    await submitSemanticFilter();
  } else if (queryChanged) {
    await submitSearch();
  }
  if (!state.search.submittedQuery.trim() || state.search.error || state.search.results.length === 0) {
    state.search.filterEnabled = false;
    state.search.open = true;
    state.search.resultsCollapsed = false;
    getRefreshReaderPanels()();
    getRenderApp()();
    return;
  }
  state.search.clearedSectionKeys = [];
  state.search.clearedBlockIds = [];
  state.search.filterEnabled = true;
  if (state.currentView === 'editor') {
    state.currentView = 'viewer';
  }
  state.search.open = false;
  state.search.resultsCollapsed = false;
  getRefreshReaderPanels()();
  getRenderApp()();
}

async function submitSemanticFilter(): Promise<void> {
  const prompt = state.search.queryDraft.trim();
  state.search.submittedQuery = prompt;
  state.search.submittedFilterQueryMode = 'semantic';
  state.search.activeResultId = null;
  state.search.resultsCollapsed = false;
  state.search.error = null;
  state.search.semanticProgress = null;
  state.search.abortController?.abort();
  state.search.clearedSectionKeys = [];
  state.search.clearedBlockIds = [];

  if (!prompt) {
    state.search.results = [];
    state.search.navigationResultIds = [];
    state.search.isLoading = false;
    state.search.semanticProgress = null;
    getRenderApp()();
    return;
  }

  const provider = getReferenceAppConfig().semanticFilterProvider;
  if (!provider) {
    state.search.results = [];
    state.search.navigationResultIds = [];
    state.search.error = 'Semantic filtering is not configured.';
    state.search.isLoading = false;
    state.search.semanticProgress = null;
    getRenderApp()();
    return;
  }

  const requestNonce = state.search.requestNonce + 1;
  const abortController = new AbortController();
  state.search.requestNonce = requestNonce;
  state.search.abortController = abortController;
  state.search.isLoading = true;
  state.search.semanticProgress = null;
  getRenderApp()();

  try {
    const searchDocument = state.currentView === 'viewer'
      ? { ...state.document, sections: filterTemplateVisibleSections(state.document.sections) }
      : state.document;
    const packet = buildSemanticFilterWindows({
      document: searchDocument,
      prompt,
      signal: abortController.signal,
    });
    state.search.semanticProgress = {
      completedWindows: 0,
      totalWindows: packet.windows.length,
      matchedCandidates: 0,
      includedCandidates: packet.candidateBudget.includedCandidates,
      totalCandidates: packet.candidateBudget.totalCandidates,
    };
    getRenderApp()();
    const matches = await runSemanticFilterWindows({
      prompt,
      provider,
      windows: packet.windows,
      documentTitle: typeof searchDocument.meta.title === 'string' ? searchDocument.meta.title : undefined,
      signal: abortController.signal,
      onWindowComplete: (progress) => {
        if (state.search.requestNonce !== requestNonce || abortController.signal.aborted) {
          return;
        }
        state.search.semanticProgress = {
          completedWindows: progress.completedWindows,
          totalWindows: packet.windows.length,
          matchedCandidates: progress.matchedCandidates,
          includedCandidates: packet.candidateBudget.includedCandidates,
          totalCandidates: packet.candidateBudget.totalCandidates,
        };
        getRenderApp()();
      },
    });
    if (state.search.requestNonce !== requestNonce || abortController.signal.aborted) {
      return;
    }
    state.search.results = normalizeSearchResults(buildSemanticSearchResults(packet.candidates, matches, prompt));
    state.search.navigationResultIds = getDocumentOrderSearchResults(state.search.results).map((result) => result.id);
    if (state.search.filterEnabled && state.currentView === 'editor') {
      state.currentView = 'viewer';
    }
    state.search.error = null;
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }
    state.search.results = [];
    state.search.navigationResultIds = [];
    state.search.error = error instanceof Error ? error.message : 'Semantic filtering failed.';
  } finally {
    if (state.search.requestNonce !== requestNonce) {
      return;
    }
    state.search.isLoading = false;
    state.search.abortController = null;
    getRenderApp()();
  }
}

async function runSemanticFilterWindows(options: {
  prompt: string;
  provider: HvySemanticFilterProvider;
  windows: HvySemanticFilterCandidateWindow[];
  documentTitle?: string;
  signal?: AbortSignal;
  onWindowComplete?: (progress: { completedWindows: number; matchedCandidates: number }) => void;
}): Promise<HvySemanticFilterMatch[]> {
  const matches: HvySemanticFilterMatch[] = [];
  let nextWindowIndex = 0;
  let completedWindows = 0;
  let matchedCandidates = 0;
  const workerCount = Math.min(SEMANTIC_FILTER_WINDOW_CONCURRENCY, Math.max(1, options.windows.length));

  const runWorker = async (): Promise<void> => {
    while (!options.signal?.aborted) {
      const window = options.windows[nextWindowIndex];
      nextWindowIndex += 1;
      if (!window) {
        return;
      }
      const windowMatches = await options.provider(buildSemanticFilterWindowRequest(options.prompt, window, {
        ...(options.documentTitle ? { documentTitle: options.documentTitle } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      }));
      matches.push(...windowMatches);
      completedWindows += 1;
      matchedCandidates += windowMatches.length;
      options.onWindowComplete?.({ completedWindows, matchedCandidates });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return matches;
}

function buildSemanticSearchResults(
  candidates: HvySemanticFilterCandidate[],
  matches: HvySemanticFilterMatch[],
  prompt: string
): HvySearchResult[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const seen = new Set<string>();
  const results: HvySearchResult[] = [];
  for (const match of matches) {
    const candidate = candidatesById.get(match.candidateId);
    if (!candidate || seen.has(candidate.candidateId)) {
      continue;
    }
    seen.add(candidate.candidateId);
    const reason = typeof match.reason === 'string' && match.reason.trim()
      ? match.reason.trim()
      : candidate.summary;
    results.push({
      id: `semantic-${results.length + 1}`,
      category: 'semantic',
      targetKind: candidate.targetKind,
      sectionKey: candidate.sectionKey,
      ...(candidate.blockId ? { blockId: candidate.blockId } : {}),
      targetId: candidate.targetId,
      ...(candidate.targetRef ? { targetRef: candidate.targetRef } : {}),
      ...(candidate.targetPath ? { targetPath: candidate.targetPath } : {}),
      label: candidate.label,
      ...(candidate.locationLabel ? { locationLabel: candidate.locationLabel } : {}),
      ...(candidate.contextLabel ? { contextLabel: candidate.contextLabel } : {}),
      preview: reason,
      matchedText: prompt,
      sourceField: 'Semantic match',
      matches: [{
        field: 'semantic',
        label: 'Reason',
        preview: reason,
        matchedText: prompt,
      }],
      documentOrder: candidate.documentOrder,
      ...(typeof match.score === 'number' && Number.isFinite(match.score) ? { score: match.score } : {}),
    });
  }
  return results.sort((left, right) => (left.documentOrder ?? 0) - (right.documentOrder ?? 0));
}

export function clearFilteringForTarget(sectionKey: string, blockId?: string): void {
  if (!state.search.filterEnabled || !state.search.submittedQuery.trim()) {
    return;
  }
  const clearBlockId = blockId ? getFilterClearBlockTarget(sectionKey, blockId) : null;
  if (clearBlockId) {
    state.search.clearedBlockIds = [...new Set([...(state.search.clearedBlockIds ?? []), clearBlockId])];
  } else {
    state.search.clearedSectionKeys = [...new Set([...(state.search.clearedSectionKeys ?? []), sectionKey])];
  }
  getRefreshReaderPanels()();
  getRenderApp()();
}

function getFilterClearBlockTarget(sectionKey: string, blockId: string): string | null {
  const section = findSectionByKeyDeep(state.document.sections, sectionKey);
  if (!section) {
    return blockId;
  }
  for (const block of section.blocks) {
    const path = findBlockPath(block, blockId);
    if (!path) {
      continue;
    }
    const semanticAncestor = path.find((candidate) => !isLayoutOnlyBlock(candidate));
    return semanticAncestor?.id ?? blockId;
  }
  return blockId;
}

function findSectionByKeyDeep(sections: VisualSection[], sectionKey: string): VisualSection | null {
  for (const section of sections) {
    if (section.key === sectionKey) {
      return section;
    }
    const child = findSectionByKeyDeep(section.children, sectionKey);
    if (child) {
      return child;
    }
  }
  return null;
}

function findBlockPath(block: VisualBlock, blockId: string): VisualBlock[] | null {
  if (block.id === blockId) {
    return [block];
  }
  const children = [
    ...block.schema.containerBlocks,
    ...block.schema.componentListBlocks,
    ...block.schema.expandableStubBlocks.children,
    ...block.schema.expandableContentBlocks.children,
    ...block.schema.gridItems.map((item) => item.block),
  ];
  for (const child of children) {
    const path = findBlockPath(child, blockId);
    if (path) {
      return [block, ...path];
    }
  }
  return null;
}

function findBlockPathInList(blocks: VisualBlock[], blockId: string): VisualBlock[] | null {
  for (const block of blocks) {
    const path = findBlockPath(block, blockId);
    if (path) {
      return path;
    }
  }
  return null;
}

function isLayoutOnlyBlock(block: VisualBlock): boolean {
  return block.schema.component === 'grid'
    || block.schema.component === 'container'
    || block.schema.component === 'component-list'
    || block.schema.gridItems.length > 0
    || block.schema.containerBlocks.length > 0
    || block.schema.componentListBlocks.length > 0;
}

export function getEnabledSearchCategories(): SearchCategory[] {
  return CATEGORY_ORDER.filter((category) => state.search.categories[category]);
}

function normalizeSearchResults(results: HvySearchResult[]): HvySearchResult[] {
  return results.map((result, index) => ({
    ...result,
    id: result.id.trim() || `search-${index + 1}`,
  }));
}

function getSearchNavigationResults(app: HTMLElement): HvySearchResult[] {
  if (!shouldUseRenderedSearchOrder()) {
    return getDocumentOrderSearchResults(state.search.results);
  }
  const viewOrder = getRenderedSearchTargetOrder(app);
  return [...state.search.results].sort((left, right) => {
    const leftKey = getSearchResultTargetKey(left);
    const rightKey = getSearchResultTargetKey(right);
    const leftViewOrder = viewOrder.get(leftKey);
    const rightViewOrder = viewOrder.get(rightKey);
    if (leftViewOrder !== undefined || rightViewOrder !== undefined) {
      return (leftViewOrder ?? Number.MAX_SAFE_INTEGER) - (rightViewOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return (left.documentOrder ?? 0) - (right.documentOrder ?? 0);
  });
}

function getDocumentOrderSearchResults(results: HvySearchResult[]): HvySearchResult[] {
  return [...results].sort((left, right) => (left.documentOrder ?? 0) - (right.documentOrder ?? 0));
}

function shouldUseRenderedSearchOrder(): boolean {
  return state.search.filterEnabled
    || Object.keys(state.readerView).length > 0
    || Object.keys(state.componentListReaderViews).length > 0;
}

function getRenderedSearchTargetOrder(app: HTMLElement): Map<string, number> {
  const order = new Map<string, number>();
  const selector = [
    '#readerDocument [data-section-key]',
    '#readerSidebarSections [data-section-key]',
    '#aiReaderDocument [data-section-key]',
    '#aiSidebarSections [data-section-key]',
  ].join(', ');
  app.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const sectionKey = element.dataset.sectionKey;
    if (!sectionKey) {
      return;
    }
    const key = element.dataset.blockId
      ? `block:${sectionKey}:${element.dataset.blockId}`
      : `section:${sectionKey}`;
    if (!order.has(key)) {
      order.set(key, order.size);
    }
  });
  return order;
}

function getSearchResultTargetKey(result: HvySearchResult): string {
  return result.blockId ? `block:${result.sectionKey}:${result.blockId}` : `section:${result.sectionKey}`;
}

export function isSearchFilterApplied(): boolean {
  return state.search.filterEnabled
    && state.search.queryDraft.trim() === state.search.submittedQuery.trim()
    && state.search.filterQueryMode === state.search.submittedFilterQueryMode;
}
