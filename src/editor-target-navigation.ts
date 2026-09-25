import { state, getActiveStateRuntime, runWithStateRuntime, getRefreshEditorSection } from './state';
import { setEditorSidebarOpen } from './navigation';
import { restoreVirtualizedBlock, restoreVirtualizedSection } from './section-virtualizer';
import { findSectionByKey as findSectionByKeyDeep } from './section-ops';
import { resolveBaseComponentFromMeta } from './component-defs';
import { setCurrentSearchMatch } from './search/current-match';
import type { VisualBlock } from './editor/types';

export interface EditorNavigationTarget {
  sectionKey: string;
  blockId?: string;
  matchedText?: string;
  matchOrdinal?: number;
}

/**
 * Mirrors the reader navigation path: a section scrolled out of view is virtualized to a
 * placeholder, so the target has to be restored and then waited for before it exists in
 * the DOM. Without this, results in virtualized sections silently do nothing.
 */
const EDITOR_SEARCH_TARGET_ATTEMPTS = 8;

export function navigateToEditorTarget(result: EditorNavigationTarget, app: HTMLElement, attempt = 0, onRevealed?: (error?: Error) => void, signal?: AbortSignal): void {
  if (signal?.aborted) return;
  const runtime = getActiveStateRuntime();
  alignEditorSidebarToSearchResult(result, app);
  const sectionPlaceholder = app.querySelector<HTMLElement>(
    `.hvy-section-virtual-placeholder[data-hvy-virtual-kind="editor"][data-section-key="${CSS.escape(result.sectionKey)}"]`
  );
  if (sectionPlaceholder && !getRefreshEditorSection()(result.sectionKey)) {
    restoreVirtualizedSection(app, result.sectionKey);
  }
  if (result.blockId) {
    restoreVirtualizedBlock(app, result.sectionKey, result.blockId);
  }
  const target = findEditorSearchTarget(result, app);
  if (!target) {
    if (attempt < EDITOR_SEARCH_TARGET_ATTEMPTS) {
      window.setTimeout(() => runWithStateRuntime(runtime, () => navigateToEditorTarget(result, app, attempt + 1, onRevealed, signal)), 60);
      return;
    }
    onRevealed?.(new Error('Unable to reveal the requested document target.'));
    console.error('[hvy:search] Unable to find editor target for search result.', {
      sectionKey: result.sectionKey,
      blockId: result.blockId ?? '',
    });
    return;
  }
  pinEditorSearchTarget(target);
  const marker = findEditorSearchMarker(target, result.matchedText, result.matchOrdinal);
  const wantsSearchMarker = state.search.submittedQuery.trim().length > 0 && Boolean(result.matchedText?.trim());
  if (wantsSearchMarker && !marker && attempt < EDITOR_SEARCH_TARGET_ATTEMPTS) {
    window.setTimeout(() => runWithStateRuntime(runtime, () => navigateToEditorTarget(result, app, attempt + 1, onRevealed, signal)), 60);
    return;
  }
  setCurrentSearchMatch(app, marker);
  scrollEditorSearchTargetIntoView(marker ?? target, onRevealed, signal);
}

function pinEditorSearchTarget(target: HTMLElement): void {
  if (target.classList.contains('is-temp-highlighted')) {
    return;
  }
  target.classList.add('is-temp-highlighted');
  window.setTimeout(() => {
    target.classList.remove('is-temp-highlighted');
  }, 1400);
}

function alignEditorSidebarToSearchResult(result: EditorNavigationTarget, app: HTMLElement): void {
  const section = findSectionByKeyDeep(state.document.sections, result.sectionKey);
  if (section?.location === 'sidebar' && !state.editorSidebarOpen) {
    setEditorSidebarOpen(app, true);
    return;
  }
  if (section?.location !== 'sidebar' && state.editorSidebarOpen) {
    setEditorSidebarOpen(app, false);
  }
}

export function revealEditorTargetInState(result: EditorNavigationTarget): boolean {
  const section = findSectionByKeyDeep(state.document.sections, result.sectionKey);
  if (!section) {
    return false;
  }
  if (!result.blockId) {
    return false;
  }
  const path = findBlockPathInList(section.blocks, result.blockId);
  if (!path) {
    return false;
  }
  let requiresFullRender = false;
  for (const block of path.slice(0, -1)) {
    if (resolveBaseComponentFromMeta(block.schema.component, state.document.meta) !== 'expandable') {
      continue;
    }
    const readerStateKey = `${section.key}:${block.id}`;
    state.readerExpandableState[readerStateKey] = true;
    // Editing surfaces ignore reader session state, so the reveal is recorded separately.
    if (!state.searchRevealedAncestors[readerStateKey]) {
      requiresFullRender = true;
    }
    state.searchRevealedAncestors[readerStateKey] = true;
    const editorStateKey = `${section.key}:${block.id}`;
    const current = state.expandableEditorPanels[editorStateKey] ?? { stubOpen: false, expandedOpen: false };
    if (!current.stubOpen || !current.expandedOpen) {
      requiresFullRender = true;
    }
    state.expandableEditorPanels[editorStateKey] = {
      ...current,
      stubOpen: true,
      expandedOpen: true,
    };
  }
  return requiresFullRender;
}

function findEditorSearchTarget(result: EditorNavigationTarget, app: HTMLElement): HTMLElement | null {
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

function scrollEditorSearchTargetIntoView(target: HTMLElement, onRevealed?: (error?: Error) => void, signal?: AbortSignal): void {
  const container = target.closest<HTMLElement>('.editor-tree, .editor-sidebar-panel');
  if (container) {
    scrollEditorSearchTargetAfterLayoutSettles(target, container, 0, 0, '', onRevealed, signal);
    return;
  }
  target.scrollIntoView({ behavior: onRevealed ? 'instant' : 'smooth', block: 'center' });
  onRevealed?.();
}

const EDITOR_SEARCH_LAYOUT_SAMPLE_MS = 50;
const EDITOR_SEARCH_STABLE_SAMPLES = 4;
const EDITOR_SEARCH_MAX_LAYOUT_SAMPLES = 24;

function scrollEditorSearchTargetAfterLayoutSettles(
  target: HTMLElement,
  container: HTMLElement,
  sample = 0,
  stableSamples = 0,
  previousGeometry = '',
  onRevealed?: (error?: Error) => void,
  signal?: AbortSignal
): void {
  if (signal?.aborted) return;
  if (!target.isConnected || !container.isConnected) {
    onRevealed?.(new Error('Document target was removed during navigation.'));
    return;
  }
  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const geometry = `${container.scrollHeight}:${Math.round(targetRect.top - containerRect.top + container.scrollTop)}`;
  const nextStableSamples = geometry === previousGeometry ? stableSamples + 1 : 1;
  if (nextStableSamples < EDITOR_SEARCH_STABLE_SAMPLES && sample < EDITOR_SEARCH_MAX_LAYOUT_SAMPLES) {
    window.setTimeout(() => {
      scrollEditorSearchTargetAfterLayoutSettles(target, container, sample + 1, nextStableSamples, geometry, onRevealed, signal);
    }, EDITOR_SEARCH_LAYOUT_SAMPLE_MS);
    return;
  }
  container.scrollTo({
    top: Math.max(0, container.scrollTop + targetRect.top - (containerRect.top + containerRect.height / 2)),
    behavior: onRevealed ? 'instant' : 'smooth',
  });
  onRevealed?.();
}

function findEditorSearchMarker(target: HTMLElement, matchText?: string, matchOrdinal = 0): HTMLElement | null {
  const markers = [...target.querySelectorAll<HTMLElement>('.search-match-marker')];
  const normalized = matchText?.trim().toLocaleLowerCase();
  if (!normalized) {
    return markers[matchOrdinal] ?? markers[0] ?? null;
  }
  const matchingMarkers = markers.filter((marker) => marker.textContent?.trim().toLocaleLowerCase() === normalized);
  return matchingMarkers[matchOrdinal] ?? matchingMarkers[0] ?? markers[0] ?? null;
}

export function findBlockPath(block: VisualBlock, blockId: string): VisualBlock[] | null {
  if (block.id === blockId) {
    return [block];
  }
  const children = [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
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

