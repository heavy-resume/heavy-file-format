import { getReaderRenderer, state } from '../state';
import { escapeAttr, escapeHtml } from '../utils';
import {
  centerSearchResultLenses,
  focusSearchInput,
  renderCollapsedSearchBar,
  renderSearchLauncher,
  renderSearchModal,
  renderSemanticProgress,
} from './render';
import type { SearchSurfaceRefreshOptions } from '../state';

export function renderSearchCollapsedSurface(): string {
  return `<div data-search-surface="collapsed">${renderCollapsedSearchBar(state.search, { escapeHtml })}</div>`;
}

export function renderSearchFloatingSurface(): string {
  return `<div data-search-surface="floating" class="search-floating-surface${state.chat.panelOpen ? ' is-chat-open' : ''}">${renderSearchLauncher(state.search)}${renderSearchModal(state.search, state.document, {
    escapeAttr,
    escapeHtml,
    readerRenderer: getReaderRenderer(),
  })}</div>`;
}

export function refreshSearchSurface(root: ParentNode, options: SearchSurfaceRefreshOptions = {}): boolean {
  if (options.progressOnly) {
    return refreshSemanticProgress(root);
  }
  const collapsedSurface = root.querySelector<HTMLElement>('[data-search-surface="collapsed"]');
  const floatingSurface = root.querySelector<HTMLElement>('[data-search-surface="floating"]');
  if (!collapsedSurface && !floatingSurface) {
    return false;
  }
  if (collapsedSurface) {
    collapsedSurface.innerHTML = renderCollapsedSearchBar(state.search, { escapeHtml });
  }
  if (floatingSurface) {
    floatingSurface.classList.add('search-floating-surface');
    floatingSurface.classList.toggle('is-chat-open', state.chat.panelOpen);
    floatingSurface.innerHTML = `${renderSearchLauncher(state.search)}${renderSearchModal(state.search, state.document, {
      escapeAttr,
      escapeHtml,
      readerRenderer: getReaderRenderer(),
    })}`;
  }
  centerSearchResultLenses(root);
  if (options.focusInput) {
    focusSearchInput(root);
  }
  return true;
}

function refreshSemanticProgress(root: ParentNode): boolean {
  const panel = root.querySelector<HTMLElement>('.search-filter-panel');
  if (!panel) {
    return false;
  }
  const current = panel.querySelector<HTMLElement>('.search-semantic-progress');
  const progress = state.search.semanticProgress ?? null;
  if (!progress) {
    current?.remove();
    return true;
  }
  if (!current) {
    const filterBox = panel.querySelector<HTMLElement>('.search-filter-box');
    if (!filterBox) {
      return false;
    }
    filterBox.insertAdjacentHTML('beforebegin', renderSemanticProgress(progress));
    return true;
  }
  const total = Math.max(1, progress.totalWindows);
  const percent = Math.max(0, Math.min(100, Math.round(progress.completedWindows / total * 100)));
  const track = current.querySelector<HTMLElement>('.search-semantic-progress-track span');
  if (track) {
    track.style.width = `${percent}%`;
  }
  const labels = current.querySelectorAll<HTMLElement>('.search-semantic-progress-meta span');
  if (labels[0]) {
    labels[0].textContent = `${progress.completedWindows}/${progress.totalWindows} windows`;
  }
  if (labels[1]) {
    labels[1].textContent = `${progress.matchedCandidates} match${progress.matchedCandidates === 1 ? '' : 'es'}`;
  }
  return true;
}
