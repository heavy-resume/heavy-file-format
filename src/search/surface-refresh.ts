import { getReaderRenderer, state } from '../state';
import { escapeAttr, escapeHtml } from '../utils';
import {
  centerSearchResultLenses,
  focusSearchInput,
  renderCollapsedSearchBar,
  renderSearchLauncher,
  renderSearchModal,
} from './render';

export function renderSearchCollapsedSurface(): string {
  return `<div data-search-surface="collapsed">${renderCollapsedSearchBar(state.search, { escapeHtml })}</div>`;
}

export function renderSearchFloatingSurface(): string {
  return `<div data-search-surface="floating">${renderSearchLauncher(state.search)}${renderSearchModal(state.search, state.document, {
    escapeAttr,
    escapeHtml,
    readerRenderer: getReaderRenderer(),
  })}</div>`;
}

export function refreshSearchSurface(root: ParentNode, options: { focusInput?: boolean } = {}): boolean {
  const collapsedSurface = root.querySelector<HTMLElement>('[data-search-surface="collapsed"]');
  const floatingSurface = root.querySelector<HTMLElement>('[data-search-surface="floating"]');
  if (!collapsedSurface && !floatingSurface) {
    return false;
  }
  if (collapsedSurface) {
    collapsedSurface.innerHTML = renderCollapsedSearchBar(state.search, { escapeHtml });
  }
  if (floatingSurface) {
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
